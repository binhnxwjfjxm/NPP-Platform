import { createHash } from 'node:crypto';
import { createIdempotencyKey } from '@npp/contracts';
import {
  executeAllocateFulfillmentDemand,
  fulfillmentOperationInternals,
} from './sales-fulfillment-operations.js';
import * as repository from '../db/repositories/sales-fulfillment-order-allocation.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const { parseQuantity, formatQuantity } = fulfillmentOperationInternals;

function failure(code, message, retryable = false, details = {}) {
  return Object.freeze({ ok: false, code, message, retryable, details });
}

function grantedPermissions(requestContext) {
  return new Set([
    ...(Array.isArray(requestContext?.permissions) ? requestContext.permissions : []),
    ...(Array.isArray(requestContext?.grantedPermissions) ? requestContext.grantedPermissions : []),
  ]);
}

function hasPermission(requestContext, permission) {
  return grantedPermissions(requestContext).has(permission);
}

function warehouseAllowed(requestContext, warehouseId) {
  return Array.isArray(requestContext?.scopes?.warehouseIds)
    && requestContext.scopes.warehouseIds.includes(warehouseId);
}

function positiveDifference(left, right) {
  const difference = left - right;
  return difference > 0n ? difference : 0n;
}

function deterministicUuid(value) {
  const bytes = Buffer.from(createHash('sha256').update(value).digest().subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function orderDemandIdempotencyKey(operationKey, demandId) {
  return createIdempotencyKey(
    'sales-fulfillment-order',
    deterministicUuid(`${operationKey}|${demandId}`),
  );
}

function lineMessage(outcome, reasonCode) {
  if (outcome === 'READY') {
    return 'Đã phân bổ đủ số lượng đơn cần.';
  }
  if (outcome === 'SHORTAGE') {
    return 'Kho hiện chưa đủ để phân bổ hết số lượng đơn cần.';
  }
  if (reasonCode === 'NO_ALLOCATABLE_STOCK') {
    return 'Hiện chưa có thêm hàng phù hợp để phân bổ.';
  }
  return 'Dòng hàng vẫn còn số lượng chưa phân bổ.';
}

function buildOrderAllocationLine(demand, {
  allocatedBaseQuantity = demand.allocated_base_quantity,
  reasonCode = null,
} = {}) {
  const ordered = parseQuantity(demand.ordered_base_quantity) ?? 0n;
  const allocated = parseQuantity(allocatedBaseQuantity) ?? 0n;
  const backordered = parseQuantity(demand.backordered_base_quantity) ?? 0n;
  const remaining = positiveDifference(ordered, allocated);
  const outcome = remaining === 0n
    ? 'READY'
    : backordered > 0n || reasonCode === 'NO_ALLOCATABLE_STOCK'
      ? 'SHORTAGE'
      : 'NEEDS_ATTENTION';

  return Object.freeze({
    fulfillmentDemandId: demand.id,
    salesOrderLineId: demand.sales_order_line_id,
    lineNumber: Number(demand.line_number),
    sku: demand.sku_snapshot,
    itemName: demand.item_name_snapshot,
    unitCode: demand.unit_code_snapshot,
    orderedBaseQuantity: formatQuantity(ordered),
    reservedBaseQuantity: formatQuantity(parseQuantity(demand.reserved_base_quantity) ?? 0n),
    allocatedBaseQuantity: formatQuantity(allocated),
    remainingToAllocateBaseQuantity: formatQuantity(remaining),
    shortageBaseQuantity: formatQuantity(backordered),
    outcome,
    reasonCode,
    message: lineMessage(outcome, reasonCode),
  });
}

function summarize(lines) {
  return Object.freeze({
    totalLines: lines.length,
    readyLines: lines.filter((line) => line.outcome === 'READY').length,
    shortageLines: lines.filter((line) => line.outcome === 'SHORTAGE').length,
    needsAttentionLines: lines.filter((line) => line.outcome === 'NEEDS_ATTENTION').length,
  });
}

export async function executeAllocateFulfillmentOrder({
  adapter,
  requestContext,
  salesOrderId,
  idempotencyKey,
  payload = {},
  dependencies = {},
}) {
  if (!hasPermission(requestContext, 'core.fulfillment.allocate')) {
    return failure('PERMISSION_DENIED', 'Không có quyền phân bổ hàng cho đơn.');
  }
  if (typeof salesOrderId !== 'string' || !UUID_PATTERN.test(salesOrderId)) {
    return failure('INVALID_IDENTITY', 'Mã đơn bán hàng không hợp lệ.', false, { field: 'salesOrderId' });
  }
  const mode = String(payload?.mode ?? 'AUTO').trim().toUpperCase();
  if (mode !== 'AUTO') {
    return failure(
      'INVALID_ALLOCATION_MODE',
      'Phân bổ toàn đơn chỉ dùng chính sách tự động hiện hành của kho.',
    );
  }

  const listDemands = dependencies.listDemands ?? repository.listActiveOrderAllocationDemands;
  const getDemand = dependencies.getDemand ?? repository.getActiveOrderAllocationDemand;
  const allocateDemand = dependencies.allocateDemand ?? executeAllocateFulfillmentDemand;

  const demands = await listDemands(adapter, {
    installationId: requestContext.installationId,
    salesOrderId,
  });
  if (!Array.isArray(demands) || demands.length === 0) {
    return failure('FULFILLMENT_ORDER_NOT_FOUND', 'Không tìm thấy đơn đang ở trạng thái chuẩn bị hàng.');
  }
  if (demands.some((demand) => !warehouseAllowed(requestContext, demand.warehouse_id))) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Đơn có hàng nằm ngoài phạm vi kho được cấp.');
  }

  const lines = [];
  let attempted = false;
  let replayed = true;

  for (const demand of demands) {
    const initial = buildOrderAllocationLine(demand);
    if (parseQuantity(initial.remainingToAllocateBaseQuantity) <= 0n) {
      lines.push(initial);
      continue;
    }

    attempted = true;
    const childKey = orderDemandIdempotencyKey(idempotencyKey, demand.id);
    const result = await allocateDemand({
      adapter,
      requestContext,
      demandId: demand.id,
      idempotencyKey: childKey,
      payload: { mode: 'AUTO' },
    });

    if (result.ok) {
      replayed = replayed && result.replayed === true;
      const refreshed = await getDemand(adapter, {
        installationId: requestContext.installationId,
        salesOrderId,
        demandId: demand.id,
      });
      lines.push(buildOrderAllocationLine(refreshed ?? demand, {
        allocatedBaseQuantity: result.allocation.allocatedBaseQuantity,
      }));
      continue;
    }

    if (result.code === 'NO_ALLOCATABLE_STOCK') {
      replayed = false;
      const refreshed = await getDemand(adapter, {
        installationId: requestContext.installationId,
        salesOrderId,
        demandId: demand.id,
      });
      lines.push(buildOrderAllocationLine(refreshed ?? demand, { reasonCode: result.code }));
      continue;
    }

    if (result.code === 'FULFILLMENT_DEMAND_ALREADY_ALLOCATED') {
      const refreshed = await getDemand(adapter, {
        installationId: requestContext.installationId,
        salesOrderId,
        demandId: demand.id,
      });
      if (!refreshed) {
        return failure(
          'FULFILLMENT_DEMAND_NOT_FOUND',
          'Dòng hàng đã thay đổi trong lúc phân bổ; vui lòng tải lại đơn.',
          true,
        );
      }
      lines.push(buildOrderAllocationLine(refreshed));
      continue;
    }

    return result;
  }

  const orderedLines = Object.freeze([...lines].sort((left, right) => (
    left.lineNumber - right.lineNumber
      || left.fulfillmentDemandId.localeCompare(right.fulfillmentDemandId)
  )));

  return Object.freeze({
    ok: true,
    replayed: attempted ? replayed : true,
    salesOrderId,
    summary: summarize(orderedLines),
    lines: orderedLines,
  });
}

export const fulfillmentOrderAllocationInternals = Object.freeze({
  orderDemandIdempotencyKey,
  buildOrderAllocationLine,
  summarize,
});

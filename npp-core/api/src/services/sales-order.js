import * as base from './sales-order-base.js';
import * as deliveryExecutionRepository from '../db/repositories/sales-order-delivery-execution.js';

export * from './sales-order-base.js';

const DELIVERY_EXECUTION_MODES = new Set(['TRIP', 'MANUAL']);

function failure(code, message, retryable = false, details = {}) {
  return Object.freeze({ ok: false, code, message, retryable, details });
}

function normalizeDeliveryExecution(payload) {
  const deliveryMode = String(payload?.deliveryMode ?? 'DELIVERY').trim().toUpperCase();
  const rawExecutionMode = payload?.deliveryExecutionMode;
  const supplied = rawExecutionMode !== undefined
    && rawExecutionMode !== null
    && String(rawExecutionMode).trim() !== '';

  if (deliveryMode === 'DELIVERY') {
    const deliveryExecutionMode = supplied
      ? String(rawExecutionMode).trim().toUpperCase()
      : 'TRIP';
    if (!DELIVERY_EXECUTION_MODES.has(deliveryExecutionMode)) {
      return failure('INVALID_DELIVERY_EXECUTION_MODE', 'Hình thức giao nhận không hợp lệ.');
    }
    return Object.freeze({ ok: true, deliveryExecutionMode });
  }

  if (deliveryMode === 'PICKUP') {
    if (supplied) {
      return failure(
        'DELIVERY_EXECUTION_MODE_NOT_APPLICABLE',
        'Khách nhận tại kho không dùng hình thức giao theo chuyến hoặc giao thủ công.',
      );
    }
    return Object.freeze({ ok: true, deliveryExecutionMode: null });
  }

  // Let the existing Sales Order validation own invalid broad delivery modes.
  return Object.freeze({ ok: true, deliveryExecutionMode: null });
}

function fallbackExecutionMode(deliveryMode, deliveryExecutionMode) {
  if (deliveryMode === 'PICKUP') return null;
  return deliveryExecutionMode ?? 'TRIP';
}

function mergeDetailedOrder(order, rows) {
  const facts = new Map(rows.map((row) => [
    String(row.version_number),
    fallbackExecutionMode(row.delivery_mode, row.delivery_execution_mode),
  ]));
  const versions = Array.isArray(order?.versions)
    ? order.versions.map((version) => Object.freeze({
        ...version,
        deliveryExecutionMode: facts.has(String(version.versionNumber))
          ? facts.get(String(version.versionNumber))
          : fallbackExecutionMode(version.deliveryMode, null),
      }))
    : order?.versions;
  const current = Array.isArray(versions)
    ? versions.find((version) => String(version.versionNumber) === String(order.currentVersionNumber))
      ?? versions.at(-1)
    : null;
  return Object.freeze({
    ...order,
    deliveryExecutionMode: current?.deliveryExecutionMode
      ?? fallbackExecutionMode(order?.deliveryMode, null),
    versions: versions ? Object.freeze(versions) : versions,
  });
}

async function enrichDetailedResult(client, requestContext, result) {
  if (!result?.ok || !result.salesOrder?.id) return result;
  const rows = await deliveryExecutionRepository.listVersionDeliveryExecutionModes(client, {
    installationId: requestContext.installationId,
    salesOrderId: result.salesOrder.id,
  });
  return Object.freeze({
    ...result,
    salesOrder: mergeDetailedOrder(result.salesOrder, rows),
  });
}

export async function listSalesOrders(client, input) {
  const result = await base.listSalesOrders(client, input);
  if (!result?.ok || !Array.isArray(result.salesOrders) || result.salesOrders.length === 0) return result;
  const rows = await deliveryExecutionRepository.listCurrentDeliveryExecutionModes(client, {
    installationId: input.requestContext.installationId,
    salesOrderIds: result.salesOrders.map((order) => order.id),
  });
  const facts = new Map(rows.map((row) => [
    row.sales_order_id,
    fallbackExecutionMode(row.delivery_mode, row.delivery_execution_mode),
  ]));
  return Object.freeze({
    ...result,
    salesOrders: Object.freeze(result.salesOrders.map((order) => Object.freeze({
      ...order,
      deliveryExecutionMode: facts.has(order.id)
        ? facts.get(order.id)
        : fallbackExecutionMode(order.deliveryMode, null),
    }))),
  });
}

export async function getSalesOrder(client, input) {
  return enrichDetailedResult(client, input.requestContext, await base.getSalesOrder(client, input));
}

export async function createSalesOrder(client, { requestContext, payload }) {
  const normalized = normalizeDeliveryExecution(payload);
  if (!normalized.ok) return normalized;
  const result = await base.createSalesOrder(client, { requestContext, payload });
  if (!result.ok) return result;
  const applied = await deliveryExecutionRepository.setVersionDeliveryExecutionMode(client, {
    installationId: requestContext.installationId,
    salesOrderId: result.salesOrder.id,
    versionNumber: 1,
    deliveryExecutionMode: normalized.deliveryExecutionMode,
  });
  if (!applied) {
    return failure('SALES_ORDER_DELIVERY_EXECUTION_SNAPSHOT_FAILED', 'Không thể lưu hình thức giao nhận của đơn.', true);
  }
  return enrichDetailedResult(client, requestContext, result);
}

export async function updateSalesOrderDraft(client, {
  requestContext,
  id,
  versionNumber,
  payload,
}) {
  const normalized = normalizeDeliveryExecution(payload);
  if (!normalized.ok) return normalized;
  const result = await base.updateSalesOrderDraft(client, {
    requestContext,
    id,
    versionNumber,
    payload,
  });
  if (!result.ok) return result;
  const draft = result.salesOrder.versions?.find((version) => version.status === 'draft');
  const resolvedVersion = Number(versionNumber ?? draft?.versionNumber);
  if (!Number.isInteger(resolvedVersion) || resolvedVersion < 1) {
    return failure('SALES_ORDER_DRAFT_NOT_FOUND', 'Không tìm thấy bản nháp của đơn bán hàng.');
  }
  const applied = await deliveryExecutionRepository.setVersionDeliveryExecutionMode(client, {
    installationId: requestContext.installationId,
    salesOrderId: id,
    versionNumber: resolvedVersion,
    deliveryExecutionMode: normalized.deliveryExecutionMode,
  });
  if (!applied) {
    return failure('SALES_ORDER_DELIVERY_EXECUTION_SNAPSHOT_FAILED', 'Không thể lưu hình thức giao nhận của đơn.', true);
  }
  return enrichDetailedResult(client, requestContext, result);
}

export async function createSalesOrderAmendment(client, { requestContext, id, payload }) {
  const before = await getSalesOrder(client, { requestContext, id });
  if (!before.ok) return before;
  const sourceExecutionMode = before.salesOrder.deliveryExecutionMode;
  const result = await base.createSalesOrderAmendment(client, { requestContext, id, payload });
  if (!result.ok) return result;
  const draft = result.salesOrder.versions?.find((version) => version.status === 'draft');
  if (!draft) return failure('SALES_ORDER_DRAFT_NOT_FOUND', 'Không tìm thấy bản nháp điều chỉnh.');
  const applied = await deliveryExecutionRepository.setVersionDeliveryExecutionMode(client, {
    installationId: requestContext.installationId,
    salesOrderId: id,
    versionNumber: Number(draft.versionNumber),
    deliveryExecutionMode: fallbackExecutionMode(draft.deliveryMode, sourceExecutionMode),
  });
  if (!applied) {
    return failure('SALES_ORDER_DELIVERY_EXECUTION_SNAPSHOT_FAILED', 'Không thể sao chép hình thức giao nhận sang bản điều chỉnh.', true);
  }
  return enrichDetailedResult(client, requestContext, result);
}

export async function confirmSalesOrder(client, input) {
  return enrichDetailedResult(client, input.requestContext, await base.confirmSalesOrder(client, input));
}

export async function cancelSalesOrder(client, input) {
  return enrichDetailedResult(client, input.requestContext, await base.cancelSalesOrder(client, input));
}

export const salesOrderDeliveryExecutionInternals = Object.freeze({
  normalizeDeliveryExecution,
  fallbackExecutionMode,
  mergeDetailedOrder,
});

import * as repository from '../db/repositories/sales-fulfillment.js';

const QUANTITY_PATTERN = /^(0|[1-9]\d{0,17})(?:\.(\d{1,12}))?$/;
const SCALE = 1_000_000_000_000n;

function failure(code, message, retryable = false, details = {}) {
  return Object.freeze({ ok: false, code, message, retryable, details });
}

function parseQuantity(value) {
  const normalized = String(value ?? '').trim();
  const match = QUANTITY_PATTERN.exec(normalized);
  if (!match) return null;
  return BigInt(match[1]) * SCALE + BigInt((match[2] ?? '').padEnd(12, '0'));
}

function formatQuantity(value) {
  const whole = value / SCALE;
  const fraction = (value % SCALE).toString().padStart(12, '0');
  return `${whole}.${fraction}`;
}

function warehouseAllowed(requestContext, warehouseId) {
  return Array.isArray(requestContext?.scopes?.warehouseIds)
    && requestContext.scopes.warehouseIds.includes(warehouseId);
}

function canReadFulfillment(requestContext) {
  return Array.isArray(requestContext?.permissions)
    && requestContext.permissions.includes('core.fulfillment.read');
}

function allocationTransitionBlocked(error) {
  return error?.code === 'P0001'
    && error?.message === 'sales_fulfillment_transition_blocked_by_allocation';
}

async function lockActiveSalesOrderDemands(client, installationId, salesOrderId) {
  await client.query(
    `SELECT id
       FROM sales.sales_order_fulfillment_demands
      WHERE installation_id = $1
        AND sales_order_id = $2
        AND state = 'ACTIVE'
      ORDER BY id ASC
      FOR UPDATE`,
    [installationId, salesOrderId],
  );
}

function mapProjection(projection) {
  const lines = projection.lines.map((line) => Object.freeze({
    id: line.id,
    salesOrderVersionId: line.sales_order_version_id,
    salesOrderLineId: line.sales_order_line_id,
    lineNumber: Number(line.line_number),
    warehouseId: line.warehouse_id,
    salesVariantId: line.sales_variant_id,
    baseVariantId: line.base_variant_id,
    sku: line.sku_snapshot,
    orderedBaseQuantity: String(line.ordered_base_quantity),
    reservedBaseQuantity: String(line.reserved_base_quantity),
    backorderedBaseQuantity: String(line.backordered_base_quantity),
    allocatedBaseQuantity: String(line.allocated_base_quantity),
    pickedBaseQuantity: String(line.picked_base_quantity),
    packedBaseQuantity: String(line.packed_base_quantity),
    issuedBaseQuantity: String(line.issued_base_quantity),
    cancelledBaseQuantity: String(line.cancelled_base_quantity),
    state: line.state,
    createdAt: line.created_at,
    updatedAt: line.updated_at,
  }));

  const totals = lines.reduce((sum, line) => ({
    ordered: sum.ordered + parseQuantity(line.orderedBaseQuantity),
    reserved: sum.reserved + parseQuantity(line.reservedBaseQuantity),
    backordered: sum.backordered + parseQuantity(line.backorderedBaseQuantity),
    allocated: sum.allocated + parseQuantity(line.allocatedBaseQuantity),
    picked: sum.picked + parseQuantity(line.pickedBaseQuantity),
    packed: sum.packed + parseQuantity(line.packedBaseQuantity),
    issued: sum.issued + parseQuantity(line.issuedBaseQuantity),
    cancelled: sum.cancelled + parseQuantity(line.cancelledBaseQuantity),
  }), {
    ordered: 0n,
    reserved: 0n,
    backordered: 0n,
    allocated: 0n,
    picked: 0n,
    packed: 0n,
    issued: 0n,
    cancelled: 0n,
  });

  return Object.freeze({
    status: projection.status,
    allowBackorder: projection.allowBackorder,
    totals: Object.freeze({
      orderedBaseQuantity: formatQuantity(totals.ordered),
      reservedBaseQuantity: formatQuantity(totals.reserved),
      backorderedBaseQuantity: formatQuantity(totals.backordered),
      allocatedBaseQuantity: formatQuantity(totals.allocated),
      pickedBaseQuantity: formatQuantity(totals.picked),
      packedBaseQuantity: formatQuantity(totals.packed),
      issuedBaseQuantity: formatQuantity(totals.issued),
      cancelledBaseQuantity: formatQuantity(totals.cancelled),
    }),
    lines: Object.freeze(lines),
  });
}

function normalizeInputRows(rows, requestContext) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return failure(
      'FULFILLMENT_INPUT_NOT_FOUND',
      'Confirmed Sales Order lines were not found for fulfillment',
    );
  }

  const normalized = [];
  for (const row of rows) {
    if (!warehouseAllowed(requestContext, row.warehouse_id)) {
      return failure(
        'WAREHOUSE_SCOPE_DENIED',
        'Sales Order warehouse is outside the authorized scope',
      );
    }
    if (!Array.isArray(row.base_variant_ids) || row.base_variant_ids.length !== 1) {
      return failure(
        'INVENTORY_BASE_VARIANT_REQUIRED',
        'Each Sales SKU must resolve to exactly one active inventory-base variant',
        false,
        { line: Number(row.line_number), salesVariantId: row.sales_variant_id },
      );
    }
    const ordered = parseQuantity(row.ordered_base_quantity);
    if (ordered === null || ordered <= 0n) {
      return failure(
        'INVALID_FULFILLMENT_QUANTITY',
        'Sales Order base quantity is invalid',
        false,
        { line: Number(row.line_number) },
      );
    }
    normalized.push(Object.freeze({
      salesOrderId: row.sales_order_id,
      salesOrderVersionId: row.sales_order_version_id,
      salesOrderLineId: row.sales_order_line_id,
      lineNumber: Number(row.line_number),
      warehouseId: row.warehouse_id,
      salesVariantId: row.sales_variant_id,
      baseVariantId: row.base_variant_ids[0],
      sku: row.sku_snapshot,
      ordered,
    }));
  }
  return Object.freeze({ ok: true, lines: Object.freeze(normalized) });
}

export function allocateWarehouseDemand(lines, availableQuantity, allowBackorder) {
  let remaining = availableQuantity;
  const required = lines.reduce((sum, line) => sum + line.ordered, 0n);
  if (!allowBackorder && required > availableQuantity) {
    return failure(
      'SALES_ORDER_INSUFFICIENT_STOCK',
      'Available stock is insufficient and backorder is disabled',
      false,
      {
        requiredBaseQuantity: formatQuantity(required),
        availableBaseQuantity: formatQuantity(availableQuantity),
      },
    );
  }

  return Object.freeze({
    ok: true,
    allocations: Object.freeze(lines.map((line) => {
      const reserved = line.ordered < remaining ? line.ordered : remaining;
      remaining -= reserved;
      return Object.freeze({
        ...line,
        reserved,
        backordered: line.ordered - reserved,
      });
    })),
  });
}

function fulfillmentStatus({ reserved, backordered }) {
  if (backordered === 0n) return 'reserved';
  if (reserved === 0n) return 'backordered';
  return 'partially_reserved';
}

export async function loadSalesOrderFulfillment(client, {
  requestContext,
  salesOrderId,
}) {
  if (!canReadFulfillment(requestContext)) return null;
  const projection = await repository.loadFulfillmentProjection(client, {
    installationId: requestContext.installationId,
    salesOrderId,
  });
  return mapProjection(projection);
}

export async function replaceSalesOrderFulfillmentDemand(client, {
  requestContext,
  salesOrderId,
  versionNumber,
}) {
  const rows = await repository.getConfirmedFulfillmentInput(client, {
    installationId: requestContext.installationId,
    salesOrderId,
    versionNumber,
  });
  const normalized = normalizeInputRows(rows, requestContext);
  if (!normalized.ok) return normalized;

  // Allocation operations lock the active demand row before taking fulfillment-scope locks.
  // Keep the same lock order here so confirm/amendment cannot race an allocation or deadlock it.
  await lockActiveSalesOrderDemands(client, requestContext.installationId, salesOrderId);
  if (await repository.hasActiveAllocationFacts(client, {
    installationId: requestContext.installationId,
    salesOrderId,
  })) {
    return failure(
      'SALES_ORDER_HAS_EXECUTION_FACTS',
      'Đơn bán hàng đã có phân bổ/soạn hàng; không thể xác nhận phiên bản mới trực tiếp.',
      false,
    );
  }

  const settings = await repository.getFulfillmentSettings(client, {
    installationId: requestContext.installationId,
  });

  const groups = new Map();
  for (const line of normalized.lines) {
    const key = `${line.warehouseId}:${line.baseVariantId}`;
    const group = groups.get(key) ?? [];
    group.push(line);
    groups.set(key, group);
  }

  const orderedGroups = [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
  for (const [, lines] of orderedGroups) {
    await repository.lockFulfillmentScope(client, {
      installationId: requestContext.installationId,
      warehouseId: lines[0].warehouseId,
      baseVariantId: lines[0].baseVariantId,
    });
  }

  await repository.setFulfillmentWriteContext(client);
  try {
    await repository.supersedeActiveDemands(client, {
      installationId: requestContext.installationId,
      salesOrderId,
      actorId: requestContext.actorId,
    });
  } catch (error) {
    // The DB trigger is the authoritative last guard if an older/nonstandard writer
    // manages to create execution facts outside the normal demand-row lock protocol.
    if (!allocationTransitionBlocked(error)) throw error;
    return failure(
      'SALES_ORDER_HAS_EXECUTION_FACTS',
      'Đơn bán hàng đã có phân bổ/soạn hàng; không thể xác nhận phiên bản mới trực tiếp.',
      false,
    );
  }

  const allAllocations = [];
  for (const [, lines] of orderedGroups) {
    const available = parseQuantity(await repository.getWarehouseAvailableQuantity(client, {
      installationId: requestContext.installationId,
      warehouseId: lines[0].warehouseId,
      baseVariantId: lines[0].baseVariantId,
      excludingSalesOrderId: salesOrderId,
    }));
    if (available === null) {
      return failure(
        'FULFILLMENT_AVAILABILITY_INVALID',
        'Warehouse availability could not be calculated',
        true,
      );
    }
    const allocated = allocateWarehouseDemand(lines, available, settings.allowBackorder);
    if (!allocated.ok) {
      return Object.freeze({
        ...allocated,
        details: Object.freeze({
          ...allocated.details,
          warehouseId: lines[0].warehouseId,
          baseVariantId: lines[0].baseVariantId,
          lines: Object.freeze(lines.map((line) => line.lineNumber)),
        }),
      });
    }
    allAllocations.push(...allocated.allocations);
  }

  let totalReserved = 0n;
  let totalBackordered = 0n;
  for (const line of allAllocations) {
    const inserted = await repository.insertFulfillmentDemand(client, {
      installationId: requestContext.installationId,
      salesOrderId,
      salesOrderVersionId: line.salesOrderVersionId,
      salesOrderLineId: line.salesOrderLineId,
      lineNumber: line.lineNumber,
      warehouseId: line.warehouseId,
      salesVariantId: line.salesVariantId,
      baseVariantId: line.baseVariantId,
      sku: line.sku,
      orderedBaseQuantity: formatQuantity(line.ordered),
      reservedBaseQuantity: formatQuantity(line.reserved),
      backorderedBaseQuantity: formatQuantity(line.backordered),
      actorId: requestContext.actorId,
    });
    if (!inserted) {
      return failure(
        'FULFILLMENT_DEMAND_CONFLICT',
        'Fulfillment demand could not be recorded',
        true,
        { line: line.lineNumber },
      );
    }
    totalReserved += line.reserved;
    totalBackordered += line.backordered;
  }

  const status = fulfillmentStatus({
    reserved: totalReserved,
    backordered: totalBackordered,
  });
  const updated = await repository.updateSalesOrderFulfillmentStatus(client, {
    installationId: requestContext.installationId,
    salesOrderId,
    status,
    actorId: requestContext.actorId,
  });
  if (!updated) {
    return failure(
      'FULFILLMENT_STATUS_CONFLICT',
      'Sales Order fulfillment status could not be updated',
      true,
    );
  }

  return Object.freeze({
    ok: true,
    fulfillment: await loadSalesOrderFulfillment(client, {
      requestContext,
      salesOrderId,
    }),
  });
}

export async function cancelSalesOrderFulfillmentDemand(client, {
  requestContext,
  salesOrderId,
}) {
  await repository.setFulfillmentWriteContext(client);
  await repository.cancelActiveDemands(client, {
    installationId: requestContext.installationId,
    salesOrderId,
    actorId: requestContext.actorId,
  });
  return Object.freeze({
    ok: true,
    fulfillment: await loadSalesOrderFulfillment(client, {
      requestContext,
      salesOrderId,
    }),
  });
}

export const salesFulfillmentInternals = Object.freeze({
  parseQuantity,
  formatQuantity,
  normalizeInputRows,
  fulfillmentStatus,
  allocateWarehouseDemand,
  canReadFulfillment,
});
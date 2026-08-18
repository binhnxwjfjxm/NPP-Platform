import { createHash } from 'node:crypto';
import { createIdempotencyKey, IDEMPOTENCY_KEY_PATTERN } from '@npp/contracts';
import { postServerOwnedSalesMovement } from './sales-inventory-ledger.js';
import { getSalesOrder } from './sales-order.js';
import { reconcileDemandHold } from './sales-fulfillment-hold.js';

const SCALE = 1_000_000_000_000n;

function failure(code, message, retryable = false, details = {}) {
  return Object.freeze({ ok: false, code, message, retryable, details });
}

function parseQuantity(value) {
  const normalized = String(value ?? '').trim();
  const match = /^(0|[1-9]\d{0,17})(?:\.(\d{1,12}))?$/.exec(normalized);
  if (!match) return null;
  return BigInt(match[1]) * SCALE + BigInt((match[2] ?? '').padEnd(12, '0'));
}

function formatQuantity(value) {
  const whole = value / SCALE;
  const fraction = String(value % SCALE).padStart(12, '0');
  return `${whole}.${fraction}`;
}

function deterministicUuid(value) {
  const bytes = Buffer.from(createHash('sha256').update(value).digest().subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function warehouseScopeAllows(requestContext, warehouseId) {
  return Array.isArray(requestContext?.scopes?.warehouseIds)
    && requestContext.scopes.warehouseIds.includes(warehouseId);
}

async function lockSource(client, { installationId, salesOrderId }) {
  const result = await client.query(
    `SELECT orders.id,
            orders.order_number,
            orders.status,
            version.delivery_mode,
            version.delivery_execution_mode,
            orders.current_version_number,
            version.warehouse_id,
            version.id AS sales_order_version_id,
            version.revision AS version_revision
       FROM sales.sales_orders orders
       JOIN sales.sales_order_versions version
         ON version.installation_id = orders.installation_id
        AND version.sales_order_id = orders.id
        AND version.version_number = orders.current_version_number
      WHERE orders.installation_id = $1
        AND orders.id = $2
      FOR UPDATE OF orders, version`,
    [installationId, salesOrderId],
  );
  return result.rows?.[0] ?? null;
}

async function lockDemands(client, { installationId, salesOrderId }) {
  const result = await client.query(
    `SELECT demand.*,
            line.id AS source_sales_order_line_id,
            line.item_name_snapshot,
            base.sku AS base_sku,
            base.unit_id AS base_unit_id,
            unit.code AS base_unit_code,
            COALESCE(policy.lot_tracking_mode, 'NONE') AS lot_tracking_mode,
            COALESCE(policy.expiry_tracking_mode, 'NONE') AS expiry_tracking_mode,
            COALESCE(policy.location_required, false) AS location_required
       FROM sales.sales_order_fulfillment_demands demand
       JOIN sales.sales_order_version_lines line
         ON line.installation_id = demand.installation_id
        AND line.id = demand.sales_order_line_id
       JOIN shared.product_variants base
         ON base.installation_id = demand.installation_id
        AND base.id = demand.base_variant_id
       JOIN shared.units_of_measure unit
         ON unit.installation_id = base.installation_id
        AND unit.id = base.unit_id
       LEFT JOIN inventory.product_tracking_policies policy
         ON policy.installation_id = demand.installation_id
        AND policy.base_variant_id = demand.base_variant_id
      WHERE demand.installation_id = $1
        AND demand.sales_order_id = $2
        AND demand.state = 'ACTIVE'
      ORDER BY demand.line_number ASC
      FOR UPDATE OF demand`,
    [installationId, salesOrderId],
  );
  return result.rows ?? [];
}

async function listCandidates(client, { installationId, warehouseId, baseVariantId }) {
  const result = await client.query(
    `SELECT balance.warehouse_id,
            balance.location_id,
            location.code AS location_code,
            balance.base_variant_id,
            balance.lot_id,
            lot.lot_code,
            lot.expiry_date,
            balance.available_quantity
       FROM inventory.inventory_balances balance
       LEFT JOIN shared.warehouse_locations location
         ON location.installation_id = balance.installation_id
        AND location.warehouse_id = balance.warehouse_id
        AND location.id = balance.location_id
       LEFT JOIN inventory.inventory_lots lot
         ON lot.installation_id = balance.installation_id
        AND lot.id = balance.lot_id
       LEFT JOIN inventory.product_tracking_policies policy
         ON policy.installation_id = balance.installation_id
        AND policy.base_variant_id = balance.base_variant_id
       LEFT JOIN LATERAL (
         SELECT min(movement.posted_at) AS first_received_at
           FROM inventory.inventory_movement_lines movement_line
           JOIN inventory.inventory_movements movement
             ON movement.installation_id = movement_line.installation_id
            AND movement.id = movement_line.movement_id
          WHERE movement_line.installation_id = balance.installation_id
            AND movement_line.warehouse_id = balance.warehouse_id
            AND movement_line.location_id IS NOT DISTINCT FROM balance.location_id
            AND movement_line.base_variant_id = balance.base_variant_id
            AND movement_line.lot_id IS NOT DISTINCT FROM balance.lot_id
            AND movement_line.direction = 'IN'
       ) receipt ON true
      WHERE balance.installation_id = $1
        AND balance.warehouse_id = $2
        AND balance.base_variant_id = $3
        AND balance.available_quantity > 0
        AND (
          (balance.location_id IS NULL AND COALESCE(policy.location_required, false) = false)
          OR (
            balance.location_id IS NOT NULL
            AND location.is_active = true
            AND location.location_type = 'storage'
          )
        )
        AND (
          COALESCE(policy.lot_tracking_mode, 'NONE') = 'NONE'
          OR balance.lot_id IS NOT NULL
        )
        AND (
          COALESCE(policy.expiry_tracking_mode, 'NONE') <> 'REQUIRED'
          OR lot.expiry_date IS NOT NULL
        )
        AND (lot.expiry_date IS NULL OR lot.expiry_date >= CURRENT_DATE)
        AND (
          COALESCE(policy.location_required, false) = false
          OR balance.location_id IS NOT NULL
        )
      ORDER BY
        CASE WHEN lot.expiry_date IS NOT NULL THEN lot.expiry_date END ASC NULLS LAST,
        CASE WHEN lot.expiry_date IS NULL THEN receipt.first_received_at END ASC NULLS LAST,
        location.code ASC NULLS LAST,
        lot.lot_code ASC NULLS LAST,
        balance.location_id ASC NULLS LAST,
        balance.lot_id ASC NULLS LAST
      FOR UPDATE OF balance`,
    [installationId, warehouseId, baseVariantId],
  );
  return result.rows ?? [];
}

async function setProjectionWriteContext(client) {
  await client.query(
    "SELECT set_config('npp.sales_fulfillment_write_context', 'fulfillment_service', true)",
  );
}

async function prepareDemandsForIssue(client, { installationId, salesOrderId, actorId }) {
  await setProjectionWriteContext(client);
  const result = await client.query(
    `UPDATE sales.sales_order_fulfillment_demands
        SET allocated_base_quantity = reserved_base_quantity,
            updated_at = now(),
            updated_by = $3
      WHERE installation_id = $1
        AND sales_order_id = $2
        AND state = 'ACTIVE'
      RETURNING id`,
    [installationId, salesOrderId, actorId],
  );
  return result.rows ?? [];
}

async function markDemandsIssued(client, { installationId, salesOrderId, actorId }) {
  await setProjectionWriteContext(client);
  const result = await client.query(
    `UPDATE sales.sales_order_fulfillment_demands
        SET picked_base_quantity = reserved_base_quantity,
            packed_base_quantity = reserved_base_quantity,
            issued_base_quantity = reserved_base_quantity,
            updated_at = now(),
            updated_by = $3
      WHERE installation_id = $1
        AND sales_order_id = $2
        AND state = 'ACTIVE'
      RETURNING id`,
    [installationId, salesOrderId, actorId],
  );
  await client.query(
    `UPDATE sales.sales_orders
        SET fulfillment_status = 'issued',
            updated_at = now(),
            updated_by = $3
      WHERE installation_id = $1
        AND id = $2
        AND status = 'confirmed'`,
    [installationId, salesOrderId, actorId],
  );
  return result.rows ?? [];
}

function exactScopeKey(row) {
  return [
    row.warehouse_id,
    row.location_id ?? '<null>',
    row.base_variant_id,
    row.lot_id ?? '<null>',
  ].join('|');
}

export async function issueManualSalesOrderStock(client, {
  requestContext,
  id,
  expectedRevision,
  idempotencyKey,
}) {
  if (!IDEMPOTENCY_KEY_PATTERN.test(String(idempotencyKey ?? ''))) {
    return failure('INVALID_IDEMPOTENCY_KEY', 'Khóa chống ghi trùng không hợp lệ');
  }

  const source = await lockSource(client, {
    installationId: requestContext.installationId,
    salesOrderId: id,
  });
  if (!source) return failure('SALES_ORDER_NOT_FOUND', 'Không tìm thấy đơn bán hàng');
  if (source.status !== 'confirmed'
      || source.delivery_mode !== 'DELIVERY'
      || source.delivery_execution_mode !== 'MANUAL') {
    return failure(
      'MANUAL_STOCK_ISSUE_NOT_AVAILABLE',
      'Chỉ có thể Xuất kho cho đơn Giao thủ công đã Chốt',
    );
  }
  if (!warehouseScopeAllows(requestContext, source.warehouse_id)) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Đơn nằm ngoài phạm vi kho được cấp quyền');
  }
  if (String(source.version_revision) !== String(expectedRevision ?? '')) {
    return failure(
      'MANUAL_STOCK_ISSUE_CONFLICT',
      'Đơn đã thay đổi. Hãy tải lại trước khi Xuất kho',
      false,
      { currentRevision: String(source.version_revision) },
    );
  }

  let demands = await lockDemands(client, {
    installationId: requestContext.installationId,
    salesOrderId: id,
  });
  if (demands.length === 0) {
    return failure('MANUAL_STOCK_ISSUE_NO_LINES', 'Đơn chưa có nhu cầu giữ hàng để Xuất kho');
  }

  const fullyIssued = demands.every((demand) => {
    const reserved = parseQuantity(demand.reserved_base_quantity) ?? 0n;
    const issued = parseQuantity(demand.issued_base_quantity) ?? 0n;
    return reserved > 0n && issued >= reserved;
  });
  if (fullyIssued) {
    return failure(
      'MANUAL_STOCK_ISSUE_CONFLICT',
      'Đơn đã Xuất kho, không thể xuất lại',
    );
  }

  const hasExecutionFacts = demands.some((demand) => {
    const issued = parseQuantity(demand.issued_base_quantity) ?? 0n;
    const allocated = parseQuantity(demand.allocated_base_quantity) ?? 0n;
    const picked = parseQuantity(demand.picked_base_quantity) ?? 0n;
    const packed = parseQuantity(demand.packed_base_quantity) ?? 0n;
    return issued > 0n || allocated > 0n || picked > 0n || packed > 0n;
  });
  if (hasExecutionFacts) {
    return failure(
      'MANUAL_STOCK_ISSUE_CONFLICT',
      'Đơn đã có dữ liệu xử lý kho khác, không thể Xuất kho theo luồng Giao thủ công',
    );
  }

  const refreshedDemands = [];
  for (const demand of demands) {
    const hold = await reconcileDemandHold(client, {
      installationId: requestContext.installationId,
      demandId: demand.id,
      actorId: requestContext.actorId,
      targetBaseQuantity: demand.ordered_base_quantity,
    });
    if (!hold.ok) return hold;
    refreshedDemands.push({ ...demand, ...hold.demand });
  }
  demands = refreshedDemands;

  for (const demand of demands) {
    const ordered = parseQuantity(demand.ordered_base_quantity);
    const reserved = parseQuantity(demand.reserved_base_quantity);
    const backordered = parseQuantity(demand.backordered_base_quantity);
    if (ordered === null || reserved === null || backordered === null
        || ordered <= 0n || reserved !== ordered || backordered !== 0n) {
      return failure(
        'MANUAL_STOCK_ISSUE_SHORTAGE',
        `Chưa đủ hàng để Xuất kho dòng ${demand.line_number} (${demand.sku_snapshot})`,
        false,
        {
          lineNumber: demand.line_number,
          sku: demand.sku_snapshot,
          orderedBaseQuantity: demand.ordered_base_quantity,
          reservedBaseQuantity: demand.reserved_base_quantity,
          backorderedBaseQuantity: demand.backordered_base_quantity,
        },
      );
    }
  }

  const candidatesByScope = new Map();
  for (const demand of demands) {
    const scope = `${demand.warehouse_id}|${demand.base_variant_id}`;
    if (!candidatesByScope.has(scope)) {
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`sales-fulfillment-scope:${requestContext.installationId}:${demand.warehouse_id}:${demand.base_variant_id}`],
      );
      candidatesByScope.set(scope, await listCandidates(client, {
        installationId: requestContext.installationId,
        warehouseId: demand.warehouse_id,
        baseVariantId: demand.base_variant_id,
      }));
    }
  }

  const consumed = new Map();
  const movementLines = [];
  for (const demand of demands) {
    let remaining = parseQuantity(demand.reserved_base_quantity) ?? 0n;
    const candidates = candidatesByScope.get(`${demand.warehouse_id}|${demand.base_variant_id}`) ?? [];
    let chunk = 0;
    for (const candidate of candidates) {
      if (remaining <= 0n) break;
      const scopeKey = exactScopeKey(candidate);
      const available = parseQuantity(candidate.available_quantity) ?? 0n;
      const alreadyConsumed = consumed.get(scopeKey) ?? 0n;
      const free = available > alreadyConsumed ? available - alreadyConsumed : 0n;
      if (free <= 0n) continue;
      const quantity = free < remaining ? free : remaining;
      consumed.set(scopeKey, alreadyConsumed + quantity);
      const sourceLineId = chunk === 0
        ? demand.source_sales_order_line_id
        : deterministicUuid(`${demand.id}|${scopeKey}|${chunk}`);
      movementLines.push({
        sourceLineId,
        warehouseId: demand.warehouse_id,
        locationId: candidate.location_id ?? null,
        baseVariantId: demand.base_variant_id,
        baseSku: demand.base_sku,
        baseUnitId: demand.base_unit_id,
        baseUnitCode: demand.base_unit_code,
        lotId: candidate.lot_id ?? null,
        lotCode: candidate.lot_code ?? null,
        expiryDate: candidate.expiry_date ?? null,
        quantity: formatQuantity(quantity),
        metadata: {
          salesOrderId: id,
          salesOrderVersionId: demand.sales_order_version_id,
          salesOrderLineId: demand.sales_order_line_id,
          fulfillmentDemandId: demand.id,
          lineNumber: demand.line_number,
          sku: demand.sku_snapshot,
          manualStockIssue: true,
        },
      });
      remaining -= quantity;
      chunk += 1;
    }
    if (remaining > 0n) {
      return failure(
        'MANUAL_STOCK_ISSUE_SHORTAGE',
        `Tồn kho thực tế không đủ để Xuất kho dòng ${demand.line_number} (${demand.sku_snapshot})`,
        false,
        {
          lineNumber: demand.line_number,
          sku: demand.sku_snapshot,
          missingBaseQuantity: formatQuantity(remaining),
        },
      );
    }
  }

  const prepared = await prepareDemandsForIssue(client, {
    installationId: requestContext.installationId,
    salesOrderId: id,
    actorId: requestContext.actorId,
  });
  if (prepared.length !== demands.length) {
    throw Object.assign(new Error('manual_stock_issue_prepare_failed'), {
      code: 'MANUAL_STOCK_ISSUE_PROJECTION_FAILED',
    });
  }

  const movementKey = createIdempotencyKey(
    'sales-manual-stock-issue-movement',
    deterministicUuid(`${id}|${idempotencyKey}`),
  );
  const movementResult = await postServerOwnedSalesMovement(client, {
    requestContext,
    idempotencyKey: movementKey,
    payload: {
      movementType: 'SALES_DELIVERY_ISSUE',
      direction: 'OUT',
      sourceDocumentType: 'SALES_ORDER',
      sourceDocumentId: id,
      sourceDocumentNumber: source.order_number,
      documentDate: String(requestContext.receivedAt ?? new Date().toISOString()).slice(0, 10),
      reasonCode: 'MANUAL_SALES_ORDER_STOCK_ISSUE',
      reasonNote: 'Xuất kho cho đơn Giao thủ công',
      metadata: {
        salesOrderId: id,
        salesOrderVersionId: source.sales_order_version_id,
        manualStockIssue: true,
      },
      lines: movementLines,
    },
  });
  if (!movementResult.ok) return movementResult;

  const updated = await markDemandsIssued(client, {
    installationId: requestContext.installationId,
    salesOrderId: id,
    actorId: requestContext.actorId,
  });
  if (updated.length !== demands.length) {
    throw Object.assign(new Error('manual_stock_issue_projection_failed'), {
      code: 'MANUAL_STOCK_ISSUE_PROJECTION_FAILED',
    });
  }

  const result = await getSalesOrder(client, { requestContext, id });
  if (!result.ok) return result;
  return Object.freeze({
    ...result,
    movementId: movementResult.movement.id,
    replayed: movementResult.replayed === true,
  });
}

export const manualStockIssueInternals = Object.freeze({
  parseQuantity,
  formatQuantity,
  deterministicUuid,
  exactScopeKey,
});

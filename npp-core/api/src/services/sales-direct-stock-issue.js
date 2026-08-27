import { createHash } from 'node:crypto';
import { createIdempotencyKey, IDEMPOTENCY_KEY_PATTERN } from '@npp/contracts';
import { postServerOwnedSalesMovement } from './sales-inventory-ledger.js';
import { getSalesOrder } from './sales-order.js';
import { reconcileDemandHold } from './sales-fulfillment-hold.js';
import {
  authorizeControlledNegativeStock,
  negativeStockScopeSupported,
} from './inventory-negative-stock-policy.js';

const SCALE = 1_000_000_000_000n;

const DIRECT_MODES = Object.freeze({
  MANUAL: Object.freeze({
    key: 'MANUAL',
    deliveryMode: 'DELIVERY',
    deliveryExecutionMode: 'MANUAL',
    errorPrefix: 'MANUAL_STOCK_ISSUE',
    label: 'Giao thủ công',
    movementKeyNamespace: 'sales-manual-stock-issue-movement',
    reasonCode: 'MANUAL_SALES_ORDER_STOCK_ISSUE',
    reasonNote: 'Xuất kho cho đơn Giao thủ công',
    metadataFlag: 'manualStockIssue',
  }),
  PICKUP: Object.freeze({
    key: 'PICKUP',
    deliveryMode: 'PICKUP',
    deliveryExecutionMode: null,
    errorPrefix: 'PICKUP_STOCK_ISSUE',
    label: 'Giao tại quầy',
    movementKeyNamespace: 'sales-pickup-stock-issue-movement',
    reasonCode: 'PICKUP_SALES_ORDER_STOCK_ISSUE',
    reasonNote: 'Xuất kho cho đơn Giao tại quầy',
    metadataFlag: 'pickupStockIssue',
  }),
});

function directMode(mode) {
  return DIRECT_MODES[String(mode ?? '').toUpperCase()] ?? null;
}

function failure(contract, suffix, message, retryable = false, details = {}) {
  const code = suffix ? `${contract.errorPrefix}_${suffix}` : contract.errorPrefix;
  const effectiveRetryable = suffix === 'SHORTAGE' ? true : retryable;
  return Object.freeze({ ok: false, code, message, retryable: effectiveRetryable, details });
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
            orders.fulfillment_status,
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

async function setProjectionWriteContext(client, context = 'fulfillment_service') {
  await client.query(
    "SELECT set_config('npp.sales_fulfillment_write_context', $1, true)",
    [context],
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
  await setProjectionWriteContext(client, 'negative_stock_issue_service');
  const result = await client.query(
    `UPDATE sales.sales_order_fulfillment_demands
        SET picked_base_quantity = reserved_base_quantity,
            packed_base_quantity = reserved_base_quantity,
            issued_base_quantity = reserved_base_quantity,
            negative_issued_base_quantity = backordered_base_quantity,
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

function sourceMatches(contract, source) {
  return source?.status === 'confirmed'
    && source.delivery_mode === contract.deliveryMode
    && source.delivery_execution_mode === contract.deliveryExecutionMode;
}

function baseLineMetadata({ id, demand, contract }) {
  return {
    salesOrderId: id,
    salesOrderVersionId: demand.sales_order_version_id,
    salesOrderLineId: demand.sales_order_line_id,
    fulfillmentDemandId: demand.id,
    lineNumber: demand.line_number,
    sku: demand.sku_snapshot,
    [contract.metadataFlag]: true,
  };
}

export async function issueDirectSalesOrderStock(client, {
  requestContext,
  id,
  expectedRevision,
  idempotencyKey,
  mode,
}) {
  const contract = directMode(mode);
  if (!contract) {
    return Object.freeze({ ok: false, code: 'DIRECT_STOCK_ISSUE_MODE_INVALID', message: 'Hình thức xuất kho trực tiếp không hợp lệ', retryable: false, details: {} });
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(String(idempotencyKey ?? ''))) {
    return Object.freeze({ ok: false, code: 'INVALID_IDEMPOTENCY_KEY', message: 'Khóa chống ghi trùng không hợp lệ', retryable: false, details: {} });
  }

  const visible = await getSalesOrder(client, { requestContext, id });
  if (!visible.ok) return visible;

  const source = await lockSource(client, {
    installationId: requestContext.installationId,
    salesOrderId: id,
  });
  if (!source) return Object.freeze({ ok: false, code: 'SALES_ORDER_NOT_FOUND', message: 'Không tìm thấy đơn bán hàng', retryable: false, details: {} });
  if (!sourceMatches(contract, source)) {
    return failure(contract, 'NOT_AVAILABLE', `Chỉ có thể Xuất kho cho đơn ${contract.label} đã Chốt`);
  }
  if (!warehouseScopeAllows(requestContext, source.warehouse_id)) {
    return Object.freeze({ ok: false, code: 'WAREHOUSE_SCOPE_DENIED', message: 'Đơn nằm ngoài phạm vi kho được cấp quyền', retryable: false, details: {} });
  }
  if (String(source.version_revision) !== String(expectedRevision ?? '')) {
    return failure(
      contract,
      'CONFLICT',
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
    if (source.fulfillment_status === 'fulfilled') {
      const result = await getSalesOrder(client, { requestContext, id });
      if (!result.ok) return result;
      return Object.freeze({ ...result, movementId: null, replayed: false, inventoryMovementRequired: false });
    }
    return failure(contract, 'NO_LINES', 'Đơn chưa có nhu cầu giữ hàng để Xuất kho');
  }

  const fullyIssued = demands.every((demand) => {
    const ordered = parseQuantity(demand.ordered_base_quantity) ?? 0n;
    const issued = parseQuantity(demand.issued_base_quantity) ?? 0n;
    const negativeIssued = parseQuantity(demand.negative_issued_base_quantity) ?? 0n;
    return ordered > 0n && issued + negativeIssued >= ordered;
  });
  if (fullyIssued) {
    return failure(contract, 'CONFLICT', 'Đơn đã Xuất kho, không thể xuất lại');
  }

  const hasExecutionFacts = demands.some((demand) => {
    const issued = parseQuantity(demand.issued_base_quantity) ?? 0n;
    const negativeIssued = parseQuantity(demand.negative_issued_base_quantity) ?? 0n;
    const allocated = parseQuantity(demand.allocated_base_quantity) ?? 0n;
    const picked = parseQuantity(demand.picked_base_quantity) ?? 0n;
    const packed = parseQuantity(demand.packed_base_quantity) ?? 0n;
    return issued > 0n || negativeIssued > 0n || allocated > 0n || picked > 0n || packed > 0n;
  });
  if (hasExecutionFacts) {
    return failure(
      contract,
      'CONFLICT',
      `Đơn đã có dữ liệu xử lý kho khác, không thể Xuất kho theo luồng ${contract.label}`,
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

  const negativeAuthorizationByDemand = new Map();
  for (const demand of demands) {
    const ordered = parseQuantity(demand.ordered_base_quantity);
    const reserved = parseQuantity(demand.reserved_base_quantity);
    const backordered = parseQuantity(demand.backordered_base_quantity);
    if (ordered === null || reserved === null || backordered === null
        || ordered <= 0n || reserved + backordered !== ordered) {
      return failure(
        contract,
        'PROJECTION_INVALID',
        `Số lượng giữ hàng của dòng ${demand.line_number} (${demand.sku_snapshot}) không khớp đơn. Hãy tải lại trước khi Xuất kho.`,
        true,
        { lineNumber: demand.line_number, sku: demand.sku_snapshot },
      );
    }
    if (backordered <= 0n) continue;
    if (!negativeStockScopeSupported({
      locationRequired: demand.location_required,
      lotTrackingMode: demand.lot_tracking_mode,
      expiryTrackingMode: demand.expiry_tracking_mode,
    })) {
      return failure(
        contract,
        'NEGATIVE_STOCK_SCOPE_REQUIRED',
        `Dòng ${demand.line_number} (${demand.sku_snapshot}) đang quản lý vị trí/lô nên không thể xuất vượt tồn khi chưa có vị trí hoặc lô chính xác.`,
        false,
        { lineNumber: demand.line_number, sku: demand.sku_snapshot },
      );
    }
    const authorization = await authorizeControlledNegativeStock(client, {
      requestContext,
      warehouseId: demand.warehouse_id,
    });
    if (!authorization.ok) {
      return failure(
        contract,
        'NEGATIVE_STOCK_NOT_ALLOWED',
        authorization.message,
        false,
        { lineNumber: demand.line_number, sku: demand.sku_snapshot, reason: authorization.code },
      );
    }
    negativeAuthorizationByDemand.set(demand.id, authorization.evidence);
  }

  const candidatesByScope = new Map();
  for (const demand of demands) {
    const reserved = parseQuantity(demand.reserved_base_quantity) ?? 0n;
    if (reserved <= 0n) continue;
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
        metadata: baseLineMetadata({ id, demand, contract }),
      });
      remaining -= quantity;
      chunk += 1;
    }
    if (remaining > 0n) {
      return failure(
        contract,
        'SHORTAGE',
        `Phần hàng đã giữ cho dòng ${demand.line_number} (${demand.sku_snapshot}) không còn đủ theo vị trí/lô đã ghi nhận. Hãy tải lại trước khi Xuất kho.`,
        true,
        { lineNumber: demand.line_number, sku: demand.sku_snapshot, missingBaseQuantity: formatQuantity(remaining) },
      );
    }

    const negativeQuantity = parseQuantity(demand.backordered_base_quantity) ?? 0n;
    if (negativeQuantity > 0n) {
      const evidence = negativeAuthorizationByDemand.get(demand.id);
      if (!evidence) {
        return failure(contract, 'NEGATIVE_STOCK_NOT_ALLOWED', 'Chưa có quyền hợp lệ để xuất vượt tồn khả dụng.');
      }
      const sourceLineId = chunk === 0
        ? demand.source_sales_order_line_id
        : deterministicUuid(`${demand.id}|negative-stock|${chunk}`);
      movementLines.push({
        sourceLineId,
        warehouseId: demand.warehouse_id,
        locationId: null,
        baseVariantId: demand.base_variant_id,
        baseSku: demand.base_sku,
        baseUnitId: demand.base_unit_id,
        baseUnitCode: demand.base_unit_code,
        lotId: null,
        lotCode: null,
        expiryDate: null,
        quantity: formatQuantity(negativeQuantity),
        metadata: {
          ...baseLineMetadata({ id, demand, contract }),
          negativeStock: true,
          negativeStockQuantity: formatQuantity(negativeQuantity),
          negativeStockAuthorization: evidence,
        },
      });
    }
  }

  const prepared = await prepareDemandsForIssue(client, {
    installationId: requestContext.installationId,
    salesOrderId: id,
    actorId: requestContext.actorId,
  });
  if (prepared.length !== demands.length) {
    throw Object.assign(new Error(`${contract.key.toLowerCase()}_stock_issue_prepare_failed`), {
      code: `${contract.errorPrefix}_PROJECTION_FAILED`,
    });
  }

  const movementKey = createIdempotencyKey(
    contract.movementKeyNamespace,
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
      reasonCode: contract.reasonCode,
      reasonNote: contract.reasonNote,
      metadata: {
        salesOrderId: id,
        salesOrderVersionId: source.sales_order_version_id,
        controlledNegativeStock: negativeAuthorizationByDemand.size > 0,
        [contract.metadataFlag]: true,
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
    throw Object.assign(new Error(`${contract.key.toLowerCase()}_stock_issue_projection_failed`), {
      code: `${contract.errorPrefix}_PROJECTION_FAILED`,
    });
  }

  const result = await getSalesOrder(client, { requestContext, id });
  if (!result.ok) return result;
  return Object.freeze({
    ...result,
    movementId: movementResult.movement.id,
    replayed: movementResult.replayed === true,
    inventoryMovementRequired: true,
  });
}

export const directStockIssueInternals = Object.freeze({
  parseQuantity,
  formatQuantity,
  deterministicUuid,
  exactScopeKey,
  directMode,
  sourceMatches,
  baseLineMetadata,
});

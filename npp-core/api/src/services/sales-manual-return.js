import { randomUUID } from 'node:crypto';
import { IDEMPOTENCY_KEY_PATTERN } from '@npp/contracts';
import { deriveIdempotencyKey } from '../idempotency-derived.js';
import { postServerOwnedSalesMovement } from './sales-inventory-ledger.js';
import { getSalesOrder } from './sales-order.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const QUANTITY = /^(0|[1-9][0-9]{0,17})(?:\.([0-9]{1,12}))?$/;
const SCALE = 1000000000000n;
const failure = (code, message, retryable = false) => Object.freeze({ ok: false, code, message, retryable });

export function parseManualReturnQuantity(raw) {
  const match = QUANTITY.exec(String(raw ?? '').trim());
  if (!match) return null;
  return BigInt(match[1]) * SCALE + BigInt((match[2] ?? '').padEnd(12, '0'));
}
export function formatManualReturnQuantity(n) {
  return String(n / SCALE) + '.' + String(n % SCALE).padStart(12, '0');
}

async function readOrder(client, context, id, lock) {
  const sql = [
    "SELECT orders.id, orders.order_number, orders.status, orders.fulfillment_status,",
    "orders.revision, orders.delivery_status, version.id AS version_id,",
    "version.warehouse_id, version.delivery_mode, version.delivery_execution_mode",
    "FROM sales.sales_orders orders",
    "JOIN sales.sales_order_versions version ON version.installation_id = orders.installation_id",
    "AND version.sales_order_id = orders.id AND version.version_number = orders.current_version_number",
    "WHERE orders.installation_id = $1 AND orders.id = $2::uuid",
    lock ? "FOR UPDATE OF orders" : "",
  ].join(' ');
  const result = await client.query(sql, [context.installationId, id]);
  return result.rows?.[0] ?? null;
}

async function returnable(client, context, order) {
  const origin = await client.query([
    "SELECT issue_line.id AS issue_line_id, issue_line.metadata ->> 'salesOrderLineId' AS sales_line_id,",
    "issue_line.warehouse_id, issue_line.location_id, issue_line.base_variant_id, issue_line.base_sku,",
    "issue_line.source_unit_id AS base_unit_id, issue_line.source_unit_code AS base_unit_code,",
    "issue_line.lot_id, issue_line.lot_code, issue_line.expiry_date,",
    "(-issue_line.base_quantity_delta)::text AS issued,",
    "version_line.line_number, version_line.sku_snapshot, version_line.item_name_snapshot",
    "FROM inventory.inventory_movements movement",
    "JOIN inventory.inventory_movement_lines issue_line",
    "ON issue_line.installation_id = movement.installation_id AND issue_line.movement_id = movement.id",
    "JOIN sales.sales_order_version_lines version_line",
    "ON version_line.installation_id = issue_line.installation_id",
    "AND version_line.id::text = issue_line.metadata ->> 'salesOrderLineId'",
    "AND version_line.sales_order_version_id = $3::uuid",
    "WHERE movement.installation_id = $1 AND movement.source_document_type = 'SALES_ORDER'",
    "AND movement.source_document_id = $2::text",
    "AND movement.reason_code = 'MANUAL_SALES_ORDER_STOCK_ISSUE'",
    "AND issue_line.direction = 'OUT'",
    "AND NOT EXISTS (SELECT 1 FROM inventory.inventory_movements reversal",
    "WHERE reversal.installation_id = movement.installation_id",
    "AND reversal.reversal_of_movement_id = movement.id)",
    "ORDER BY version_line.line_number, issue_line.line_number, issue_line.id",
  ].join(' '), [context.installationId, order.id, order.version_id]);
  const returned = await client.query([
    "SELECT lines.issue_movement_line_id, SUM(lines.returned_base_quantity)::text AS quantity",
    "FROM sales.manual_delivery_return_lines lines",
    "JOIN sales.manual_delivery_return_receipts receipt",
    "ON receipt.installation_id = lines.installation_id AND receipt.id = lines.receipt_id",
    "WHERE receipt.installation_id = $1 AND receipt.sales_order_id = $2::uuid",
    "GROUP BY lines.issue_movement_line_id",
  ].join(' '), [context.installationId, order.id]);
  const prior = new Map(returned.rows.map(row => [
    row.issue_movement_line_id, parseManualReturnQuantity(row.quantity),
  ]));
  const groups = new Map();
  for (const row of origin.rows) {
    const issued = parseManualReturnQuantity(row.issued);
    const previous = prior.get(row.issue_line_id) ?? 0n;
    if (issued === null || issued <= 0n || previous === null || previous > issued
        || row.warehouse_id !== order.warehouse_id) {
      return failure('MANUAL_RETURN_SOURCE_CONFLICT', 'Dữ liệu xuất kho không khớp, cần kiểm tra trước khi nhập trả');
    }
    if (!groups.has(row.sales_line_id)) {
      groups.set(row.sales_line_id, {
        salesOrderLineId: row.sales_line_id, lineNumber: row.line_number,
        sku: row.sku_snapshot, itemName: row.item_name_snapshot,
        unitCode: row.base_unit_code, issued: 0n, returned: 0n, remaining: 0n, sources: [],
      });
    }
    const group = groups.get(row.sales_line_id);
    const source = { ...row, issued, previous, remaining: issued - previous };
    group.sources.push(source);
    group.issued += issued;
    group.returned += previous;
    group.remaining += source.remaining;
  }
  const orderLines = await client.query(
    'SELECT COUNT(*)::integer AS count FROM sales.sales_order_version_lines WHERE installation_id = $1 AND sales_order_version_id = $2::uuid',
    [context.installationId, order.version_id],
  );
  return { ok: true, groups: [...groups.values()], allStockManaged: Number(orderLines.rows[0].count) === groups.size };
}

function allowed(context, warehouseId) {
  return Array.isArray(context.scopes?.warehouseIds) && context.scopes.warehouseIds.includes(warehouseId);
}

export async function getManualReturnEligibility(client, { requestContext, id }) {
  if (!UUID.test(String(id))) return failure('INVALID_SALES_ORDER_ID', 'Đơn không hợp lệ');
  const order = await readOrder(client, requestContext, id, false);
  if (!order) return failure('SALES_ORDER_NOT_FOUND', 'Không tìm thấy đơn');
  if (!allowed(requestContext, order.warehouse_id)) return failure('WAREHOUSE_SCOPE_DENIED', 'Ngoài phạm vi kho');
  if (order.delivery_mode !== 'DELIVERY' || order.delivery_execution_mode !== 'MANUAL') {
    return failure('MANUAL_RETURN_MODE_INVALID', 'Chỉ áp dụng với Giao thủ công');
  }
  const eligible = await returnable(client, requestContext, order);
  if (!eligible.ok) return eligible;
  return {
    ok: true, orderRevision: String(order.revision),
    canReceive: order.status === 'confirmed' && ['issued', 'fulfilled'].includes(order.fulfillment_status),
    canReturnAll: eligible.allStockManaged,
    lines: eligible.groups.map(group => ({
      salesOrderLineId: group.salesOrderLineId,
      lineNumber: group.lineNumber, sku: group.sku, itemName: group.itemName,
      unitCode: group.unitCode, issuedBaseQuantity: formatManualReturnQuantity(group.issued),
      returnedBaseQuantity: formatManualReturnQuantity(group.returned),
      remainingBaseQuantity: formatManualReturnQuantity(group.remaining),
    })),
  };
}

export async function receiveManualOrderReturn(client, {
  requestContext, id, payload, expectedRevision, idempotencyKey,
}) {
  if (!UUID.test(String(id))) return failure('INVALID_SALES_ORDER_ID', 'Đơn không hợp lệ');
  if (!IDEMPOTENCY_KEY_PATTERN.test(String(idempotencyKey ?? ''))) {
    return failure('INVALID_IDEMPOTENCY_KEY', 'Mã chống ghi trùng không hợp lệ');
  }
  const mode = String(payload?.mode ?? '').toUpperCase();
  if (!['ALL', 'PARTIAL'].includes(mode)) return failure('MANUAL_RETURN_MODE_INVALID', 'Hình thức nhập trả không hợp lệ');
  if (mode === 'PARTIAL' && (!Array.isArray(payload?.lines) || payload.lines.length < 1 || payload.lines.length > 200)) {
    return failure('MANUAL_RETURN_LINES_REQUIRED', 'Chưa chọn sản phẩm trả');
  }
  const note = String(payload?.note ?? '').trim() || 'Hàng chưa giao, kho đã nhận lại';
  if (note.length > 2000) return failure('MANUAL_RETURN_NOTE_TOO_LONG', 'Ghi chú quá dài');
  const order = await readOrder(client, requestContext, id, true);
  if (!order) return failure('SALES_ORDER_NOT_FOUND', 'Không tìm thấy đơn');
  if (!allowed(requestContext, order.warehouse_id)) return failure('WAREHOUSE_SCOPE_DENIED', 'Ngoài phạm vi kho');
  if (order.delivery_mode !== 'DELIVERY' || order.delivery_execution_mode !== 'MANUAL'
      || order.status !== 'confirmed' || !['issued', 'fulfilled'].includes(order.fulfillment_status)) {
    return failure('MANUAL_RETURN_NOT_AVAILABLE', 'Chỉ nhập trả sau Xuất kho và trước Hoàn thành đơn');
  }
  if (String(order.revision) !== String(expectedRevision ?? '')) {
    return failure('MANUAL_RETURN_CONFLICT', 'Đơn đã thay đổi. Hãy tải lại', true);
  }
  const eligible = await returnable(client, requestContext, order);
  if (!eligible.ok) return eligible;
  const byLine = new Map(eligible.groups.map(group => [group.salesOrderLineId, group]));
  let requests = [];
  if (mode === 'ALL') {
    if (!eligible.allStockManaged) {
      return failure('MANUAL_RETURN_ALL_MIXED', 'Đơn có sản phẩm không quản lý kho, hãy chọn trả từng mã');
    }
    requests = eligible.groups.filter(g => g.remaining > 0n).map(group => ({ group, quantity: group.remaining }));
  } else {
    const seen = new Set();
    for (const row of payload.lines) {
      const idOfLine = String(row?.salesOrderLineId ?? '');
      const quantity = parseManualReturnQuantity(row?.quantity);
      if (seen.has(idOfLine) || !byLine.has(idOfLine) || quantity === null || quantity <= 0n
          || !/^(0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/.test(String(row?.quantity ?? ''))) {
        return failure('MANUAL_RETURN_LINE_INVALID', 'Mã hàng hoặc số lượng trả không hợp lệ');
      }
      seen.add(idOfLine);
      requests.push({ group: byLine.get(idOfLine), quantity });
    }
  }
  if (requests.length === 0) return failure('MANUAL_RETURN_EMPTY', 'Không còn hàng để nhập trả');
  const portions = [];
  for (const request of requests) {
    if (request.quantity > request.group.remaining) {
      return failure('MANUAL_RETURN_EXCEEDS_ISSUED', 'Số lượng trả vượt số đã xuất còn lại');
    }
    let rest = request.quantity;
    for (const source of request.group.sources) {
      if (rest === 0n) break;
      const received = source.remaining < rest ? source.remaining : rest;
      if (received > 0n) portions.push({ source, quantity: received });
      rest -= received;
    }
    if (rest !== 0n) return failure('MANUAL_RETURN_SOURCE_CONFLICT', 'Không đối soát được dòng xuất kho gốc');
  }
  const receiptId = randomUUID();
  const movement = await postServerOwnedSalesMovement(client, {
    requestContext,
    idempotencyKey: deriveIdempotencyKey('manual-return-stock', idempotencyKey),
    payload: {
      movementType: 'SALES_MANUAL_UNDELIVERED_RETURN',
      direction: 'IN',
      sourceDocumentType: 'MANUAL_DELIVERY_RETURN',
      sourceDocumentId: receiptId,
      sourceDocumentNumber: String(order.order_number),
      documentDate: String(requestContext.receivedAt ?? new Date().toISOString()).slice(0, 10),
      reasonCode: 'MANUAL_UNDELIVERED_RETURN', reasonNote: note,
      metadata: { salesOrderId: id, receiptId, undeliveredGoods: true },
      lines: portions.map(({ source, quantity }) => ({
        sourceLineId: source.issue_line_id,
        warehouseId: source.warehouse_id, locationId: source.location_id,
        baseVariantId: source.base_variant_id, baseSku: source.base_sku,
        baseUnitId: source.base_unit_id, baseUnitCode: source.base_unit_code,
        lotId: source.lot_id, lotCode: source.lot_code, expiryDate: source.expiry_date,
        quantity: formatManualReturnQuantity(quantity),
        metadata: { salesOrderLineId: source.sales_line_id, originalIssueLineId: source.issue_line_id, originalInventoryMovementLineId: source.issue_line_id },
      })),
    },
  });
  if (!movement.ok) return movement;
  await client.query("SELECT set_config('npp.manual_return_posting', 'yes', true)");
  await client.query([
    "INSERT INTO sales.manual_delivery_return_receipts",
    "(id, installation_id, sales_order_id, warehouse_id, inventory_movement_id,",
    "idempotency_key, note, posted_at, posted_by, request_id, source_app)",
    "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
  ].join(' '), [receiptId, requestContext.installationId, id, order.warehouse_id,
    movement.movement.id, idempotencyKey, note,
    requestContext.receivedAt ?? new Date().toISOString(),
    requestContext.actorId, requestContext.requestId, requestContext.sourceApp]);
  for (const portion of portions) {
    await client.query([
      "INSERT INTO sales.manual_delivery_return_lines",
      "(id, installation_id, receipt_id, issue_movement_line_id, sales_order_line_id, returned_base_quantity)",
      "VALUES ($1,$2,$3,$4,$5,$6)",
    ].join(' '), [randomUUID(), requestContext.installationId, receiptId,
      portion.source.issue_line_id, portion.source.sales_line_id,
      formatManualReturnQuantity(portion.quantity)]);
  }
  const portionsBySource = new Map(portions.map(p => [p.source.issue_line_id, p.quantity]));
  const allReturned = eligible.allStockManaged && eligible.groups.length > 0
    && eligible.groups.every(group => group.sources.every(source =>
      source.previous + (portionsBySource.get(source.issue_line_id) ?? 0n) === source.issued));
  await client.query([
    "UPDATE sales.sales_orders SET",
    "status = CASE WHEN $3 THEN 'closed' ELSE status END,",
    "delivery_status = CASE WHEN $3 THEN 'returned' ELSE delivery_status END,",
    "settlement_status = CASE WHEN $3 THEN 'paid' ELSE settlement_status END,",
    "revision = revision + 1, updated_at = now(), updated_by = $4",
    "WHERE installation_id = $1 AND id = $2::uuid",
  ].join(' '), [requestContext.installationId, id, allReturned, requestContext.actorId]);
  return getSalesOrder(client, { requestContext, id });
}

export const manualSalesReturnInternals = Object.freeze({
  parseManualReturnQuantity, formatManualReturnQuantity,
});

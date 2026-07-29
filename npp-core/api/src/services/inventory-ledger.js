import * as core from './inventory-ledger-core.js';

const SNAPSHOT_FIELDS = Object.freeze([
  'sourceSku',
  'sourceUnitId',
  'sourceUnitCode',
  'conversionToBase',
  'baseVariantId',
  'baseSku',
]);
const SUPPLIER_RETURN_TYPES = new Set(['SUPPLIER_RETURN', 'SUPPLIER_RETURN_ISSUE']);

function failure(code, message, retryable = false) {
  return Object.freeze({ ok: false, code, message, retryable });
}

function text(value, maxLength = 0) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  if (!normalized || (maxLength > 0 && normalized.length > maxLength)) return null;
  return normalized;
}

function upper(value, maxLength) {
  return text(value, maxLength)?.toUpperCase() ?? null;
}

function snapshotInputPresent(line) {
  return SNAPSHOT_FIELDS.some((field) => line?.[field] !== undefined && line?.[field] !== null && line?.[field] !== '');
}

function payloadContainsSnapshotInput(payload) {
  return Array.isArray(payload?.lines) && payload.lines.some(snapshotInputPresent);
}

function uniqueIds(lines, metadataKey) {
  const ids = lines.map((line) => text(line?.metadata?.[metadataKey], 64));
  if (ids.some((id) => !id)) return null;
  if (new Set(ids).size !== ids.length) return null;
  return ids;
}

async function buildSupplierReturnPayload(client, requestContext, payload) {
  const sourceDocumentId = text(payload?.sourceDocumentId, 160);
  const lines = Array.isArray(payload?.lines) ? payload.lines : [];
  const lineIds = uniqueIds(lines, 'supplierReturnLineId');
  if (!sourceDocumentId || !lineIds || lineIds.length === 0) {
    return failure('TRUSTED_SNAPSHOT_NOT_ALLOWED', 'Supplier Return inventory lines must come from one stored server-owned document');
  }

  const result = await client.query(
    `SELECT sr.status,
            srl.id,
            srl.source_warehouse_id,
            srl.location_id,
            srl.source_variant_id,
            srl.source_sku_snapshot,
            srl.source_unit_id,
            srl.source_unit_code_snapshot,
            srl.return_quantity,
            srl.conversion_to_base,
            srl.base_variant_id,
            srl.base_sku_snapshot,
            srl.lot_id,
            srl.lot_code_snapshot,
            srl.manufactured_date,
            srl.expiry_date,
            srl.supplier_lot_reference,
            srl.source_goods_receipt_id,
            srl.source_goods_receipt_line_id,
            srl.source_purchase_order_line_id,
            srl.reason_code,
            srl.reason_note,
            srl.source_goods_receipt_number,
            srl.source_goods_receipt_line_number
       FROM purchasing.supplier_return_lines srl
       JOIN purchasing.supplier_returns sr
         ON sr.installation_id = srl.installation_id
        AND sr.id = srl.supplier_return_id
      WHERE srl.installation_id = $1
        AND srl.supplier_return_id = $2::uuid
        AND srl.id = ANY($3::uuid[])`,
    [requestContext.installationId, sourceDocumentId, lineIds],
  );
  const rows = result.rows ?? [];
  if (rows.length !== lineIds.length || rows.some((row) => row.status !== 'approved')) {
    return failure('TRUSTED_SNAPSHOT_NOT_ALLOWED', 'Supplier Return snapshot source is missing or is not approved');
  }
  const byId = new Map(rows.map((row) => [row.id, row]));

  return Object.freeze({
    ok: true,
    value: Object.freeze({
      ...payload,
      movementType: 'SUPPLIER_RETURN',
      reasonCode: upper(payload.reasonCode, 64) === 'SUPPLIER_RETURN'
        ? 'SUPPLIER_RETURN_ISSUE'
        : payload.reasonCode,
      lines: Object.freeze(lineIds.map((id, index) => {
        const row = byId.get(id);
        const input = lines[index] ?? {};
        return Object.freeze({
          warehouseId: row.source_warehouse_id,
          locationId: row.location_id,
          sourceVariantId: row.source_variant_id,
          sourceSku: row.source_sku_snapshot,
          sourceUnitId: row.source_unit_id,
          sourceUnitCode: row.source_unit_code_snapshot,
          sourceQuantity: String(row.return_quantity),
          conversionToBase: String(row.conversion_to_base),
          baseVariantId: row.base_variant_id,
          baseSku: row.base_sku_snapshot,
          direction: 'OUT',
          sourceLineReference: `${row.source_goods_receipt_number}#${row.source_goods_receipt_line_number}`,
          lotId: row.lot_id,
          lotCode: row.lot_code_snapshot,
          manufacturedDate: row.manufactured_date,
          expiryDate: row.expiry_date,
          supplierLotReference: row.supplier_lot_reference,
          metadata: {
            ...(input.metadata ?? {}),
            supplierReturnId: sourceDocumentId,
            supplierReturnLineId: row.id,
            sourceGoodsReceiptId: row.source_goods_receipt_id,
            sourceGoodsReceiptLineId: row.source_goods_receipt_line_id,
            sourcePurchaseOrderLineId: row.source_purchase_order_line_id,
            reasonCode: row.reason_code,
            reasonNote: row.reason_note,
          },
        });
      })),
    }),
  });
}

async function buildPurchaseReceiptPayload(client, requestContext, payload) {
  const sourceDocumentId = text(payload?.sourceDocumentId, 160);
  const lines = Array.isArray(payload?.lines) ? payload.lines : [];
  const lineIds = uniqueIds(lines, 'goodsReceiptLineId');
  if (!sourceDocumentId || !lineIds || lineIds.length === 0) {
    return failure('TRUSTED_SNAPSHOT_NOT_ALLOWED', 'Purchase Receipt inventory lines must come from one stored server-owned document');
  }

  const result = await client.query(
    `SELECT grl.id,
            grl.warehouse_id,
            grl.location_id,
            grl.variant_id,
            grl.sku_snapshot,
            grl.unit_id,
            grl.unit_code_snapshot,
            grl.accepted_quantity,
            grl.conversion_to_base,
            base.id AS base_variant_id,
            base.sku AS base_sku,
            grl.lot_id,
            grl.lot_code_snapshot,
            grl.manufactured_date,
            grl.expiry_date,
            grl.supplier_lot_reference,
            grl.purchase_order_line_id,
            grl.line_number
       FROM purchasing.goods_receipt_lines grl
       JOIN purchasing.goods_receipts gr
         ON gr.installation_id = grl.installation_id
        AND gr.id = grl.goods_receipt_id
       JOIN shared.product_variants source
         ON source.installation_id = grl.installation_id
        AND source.id = grl.variant_id
       JOIN shared.product_variants base
         ON base.installation_id = source.installation_id
        AND base.product_id = source.product_id
        AND base.is_inventory_base = true
      WHERE grl.installation_id = $1
        AND grl.goods_receipt_id = $2::uuid
        AND grl.id = ANY($3::uuid[])`,
    [requestContext.installationId, sourceDocumentId, lineIds],
  );
  const rows = result.rows ?? [];
  if (rows.length !== lineIds.length) {
    return failure('TRUSTED_SNAPSHOT_NOT_ALLOWED', 'Purchase Receipt snapshot source is missing');
  }
  const byId = new Map(rows.map((row) => [row.id, row]));

  return Object.freeze({
    ok: true,
    value: Object.freeze({
      ...payload,
      lines: Object.freeze(lineIds.map((id, index) => {
        const row = byId.get(id);
        const input = lines[index] ?? {};
        return Object.freeze({
          warehouseId: row.warehouse_id,
          locationId: row.location_id,
          sourceVariantId: row.variant_id,
          sourceSku: row.sku_snapshot,
          sourceUnitId: row.unit_id,
          sourceUnitCode: row.unit_code_snapshot,
          sourceQuantity: String(row.accepted_quantity),
          conversionToBase: String(row.conversion_to_base),
          baseVariantId: row.base_variant_id,
          baseSku: row.base_sku,
          direction: 'IN',
          sourceLineReference: input.sourceLineReference ?? `GR-LINE-${row.line_number}`,
          lotId: row.lot_id,
          lotCode: row.lot_code_snapshot,
          manufacturedDate: row.manufactured_date,
          expiryDate: row.expiry_date,
          supplierLotReference: row.supplier_lot_reference,
          metadata: {
            ...(input.metadata ?? {}),
            goodsReceiptId: sourceDocumentId,
            goodsReceiptLineId: row.id,
            purchaseOrderLineId: row.purchase_order_line_id,
          },
        });
      })),
    }),
  });
}

async function prepareInternalPostingPayload(client, requestContext, payload) {
  const movementType = upper(payload?.movementType, 64);
  const sourceDomain = upper(payload?.sourceDomain, 64);
  const sourceDocumentType = upper(payload?.sourceDocumentType, 64);

  if (sourceDomain === 'PURCHASING' && sourceDocumentType === 'SUPPLIER_RETURN' && SUPPLIER_RETURN_TYPES.has(movementType)) {
    return buildSupplierReturnPayload(client, requestContext, payload);
  }
  if (sourceDomain === 'PURCHASING' && sourceDocumentType === 'PURCHASE_RECEIPT' && movementType === 'PURCHASE_RECEIPT') {
    return buildPurchaseReceiptPayload(client, requestContext, payload);
  }
  if (payloadContainsSnapshotInput(payload)) {
    return failure('TRUSTED_SNAPSHOT_NOT_ALLOWED', 'Historical snapshots are accepted only after validation against a server-owned purchasing document');
  }
  return Object.freeze({ ok: true, value: payload });
}

export async function postInventoryMovement(client, { requestContext, idempotencyKey, payload }) {
  const prepared = await prepareInternalPostingPayload(client, requestContext, payload);
  if (!prepared.ok) return prepared;
  return core.postInventoryMovement(client, {
    requestContext,
    idempotencyKey,
    payload: prepared.value,
  });
}

export function executeInventoryPost({ adapter, requestContext, idempotencyKey, payload }) {
  const movementType = upper(payload?.movementType, 64);
  const sourceDocumentType = upper(payload?.sourceDocumentType, 64);
  if (payloadContainsSnapshotInput(payload)
    || SUPPLIER_RETURN_TYPES.has(movementType)
    || sourceDocumentType === 'SUPPLIER_RETURN'
    || sourceDocumentType === 'PURCHASE_RECEIPT') {
    return Promise.resolve(failure(
      'INTERNAL_DOCUMENT_POSTING_REQUIRED',
      'Purchasing document movements must use their server-owned posting service',
    ));
  }
  return core.executeInventoryPost({ adapter, requestContext, idempotencyKey, payload });
}

export const reverseInventoryMovement = core.reverseInventoryMovement;
export const executeInventoryReversal = core.executeInventoryReversal;
export const inventoryLedgerInternals = core.inventoryLedgerInternals;
export const inventoryDocumentBoundaryInternals = Object.freeze({
  payloadContainsSnapshotInput,
  prepareInternalPostingPayload,
});

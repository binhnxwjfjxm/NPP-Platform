import { randomUUID } from 'node:crypto';
import * as repository from '../db/repositories/supplier-return.js';
import * as documentNumberRepository from '../db/repositories/document-numbering.js';
import * as goodsReceiptRepository from '../db/repositories/goods-receipt.js';
import * as purchaseOrderRepository from '../db/repositories/purchase-order.js';
import { allocateDocumentNumber } from './document-numbering.js';
import { postInventoryMovement, reverseInventoryMovement } from './inventory-ledger.js';
import { PERMISSIONS } from '../request-context.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DECIMAL_PATTERN = /^(0|[1-9]\d{0,13})(?:\.(\d{1,6}))?$/;
const INTEGER_PATTERN = /^[1-9]\d{0,18}$/;
const RETURN_STATUSES = new Set(['draft', 'pending_approval', 'approved', 'posted', 'reversed', 'cancelled']);
const SUPPLIER_RETURN_SERIES_CODE = 'SUPPLIER_RETURN';
const SCALE = 1_000_000n;

function failure(code, message, retryable = false, details = {}) {
  return Object.freeze({ ok: false, code, message, retryable, details });
}

function isUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value.trim());
}

function text(value, maxLength = 0) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  if (maxLength > 0 && normalized.length > maxLength) return null;
  return normalized;
}

function normalizeDate(value, required = false) {
  const normalized = text(value, 10);
  if (!normalized) return required ? null : null;
  const match = DATE_PATTERN.exec(normalized);
  if (!match) return null;
  const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (parsed.getUTCFullYear() !== Number(match[1])
    || parsed.getUTCMonth() !== Number(match[2]) - 1
    || parsed.getUTCDate() !== Number(match[3])) return null;
  return normalized;
}

function dateOnly(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function decimalToScaled(value, { allowZero }) {
  const normalized = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  const match = DECIMAL_PATTERN.exec(normalized);
  if (!match) return null;
  const scaled = BigInt(match[1]) * SCALE + BigInt((match[2] ?? '').padEnd(6, '0'));
  if (!allowZero && scaled <= 0n) return null;
  return scaled;
}

function scaledToDecimal(value) {
  const integer = value / SCALE;
  const fraction = (value % SCALE).toString().padStart(6, '0').replace(/0+$/, '');
  return fraction ? `${integer}.${fraction}` : integer.toString();
}

function scaledToDecimalFixed(value) {
  const integer = value / SCALE;
  const fraction = (value % SCALE).toString().padStart(6, '0');
  return `${integer}.${fraction}`;
}

function multiplyScaled(left, right) {
  return (left * right + SCALE / 2n) / SCALE;
}

function normalizeRevision(value) {
  const textValue = String(value ?? '').trim();
  return INTEGER_PATTERN.test(textValue) ? textValue : null;
}

function warehouseScopeIds(requestContext) {
  return Array.isArray(requestContext?.scopes?.warehouseIds)
    ? [...new Set(requestContext.scopes.warehouseIds.filter(isUuid).map((value) => value.trim()))]
    : [];
}

function warehouseAllowed(requestContext, warehouseId) {
  return warehouseScopeIds(requestContext).includes(warehouseId);
}

function normalizeReasonCode(value) {
  const normalized = text(value, 64)?.toUpperCase() ?? null;
  return normalized && /^[A-Z0-9_.-]{1,64}$/.test(normalized) ? normalized : null;
}

function mapLine(line) {
  return Object.freeze({
    id: line.id,
    lineNumber: Number(line.line_number),
    sourceGoodsReceiptId: line.source_goods_receipt_id,
    sourceGoodsReceiptNumber: line.source_goods_receipt_number,
    sourceGoodsReceiptStatus: line.source_goods_receipt_status,
    sourceGoodsReceiptLineId: line.source_goods_receipt_line_id,
    sourceGoodsReceiptLineNumber: Number(line.source_goods_receipt_line_number),
    sourcePurchaseOrderId: line.source_purchase_order_id,
    sourcePurchaseOrderNumber: line.source_purchase_order_number,
    sourcePurchaseOrderLineId: line.source_purchase_order_line_id,
    sourcePurchaseOrderLineNumber: Number(line.source_purchase_order_line_number),
    sourceSupplierId: line.source_supplier_id,
    sourceSupplierCode: line.source_supplier_code,
    sourceSupplierName: line.source_supplier_name,
    sourceWarehouseId: line.source_warehouse_id,
    sourceWarehouseCode: line.source_warehouse_code,
    sourceWarehouseName: line.source_warehouse_name,
    sourceVariantId: line.source_variant_id,
    sourceSku: line.source_sku_snapshot,
    sourceItemName: line.source_item_name_snapshot,
    sourceUnitId: line.source_unit_id,
    sourceUnitCode: line.source_unit_code_snapshot,
    baseVariantId: line.base_variant_id,
    baseSku: line.base_sku_snapshot,
    conversionToBase: String(line.conversion_to_base),
    sourceAcceptedQuantity: String(line.source_accepted_quantity),
    returnQuantity: String(line.return_quantity),
    baseQuantity: String(line.base_quantity),
    reasonCode: line.reason_code,
    reasonNote: line.reason_note,
    locationId: line.location_id ?? null,
    lotId: line.lot_id ?? null,
    lotCode: line.lot_code_snapshot ?? null,
    manufacturedDate: line.manufactured_date ?? null,
    expiryDate: line.expiry_date ?? null,
    supplierLotReference: line.supplier_lot_reference ?? null,
    note: line.note ?? null,
    postedReturnQuantity: String(line.posted_return_quantity ?? 0),
    returnableQuantity: String(line.returnable_quantity ?? 0),
  });
}

function mapReturn(doc) {
  return Object.freeze({
    id: doc.id,
    supplierId: doc.supplier_id,
    supplierCode: doc.supplier_code,
    supplierName: doc.supplier_name,
    warehouseId: doc.warehouse_id,
    warehouseCode: doc.warehouse_code,
    warehouseName: doc.warehouse_name,
    status: doc.status,
    documentNumber: doc.document_number ?? null,
    returnDate: dateOnly(doc.return_date),
    note: doc.note ?? null,
    revision: String(doc.revision),
    submittedAt: doc.submitted_at ?? null,
    submittedBy: doc.submitted_by ?? null,
    approvedAt: doc.approved_at ?? null,
    approvedBy: doc.approved_by ?? null,
    cancelledAt: doc.cancelled_at ?? null,
    cancelledBy: doc.cancelled_by ?? null,
    cancellationReason: doc.cancellation_reason ?? null,
    postedAt: doc.posted_at ?? null,
    postedBy: doc.posted_by ?? null,
    reversedAt: doc.reversed_at ?? null,
    reversedBy: doc.reversed_by ?? null,
    reversalReason: doc.reversal_reason ?? null,
    inventoryMovementId: doc.inventory_movement_id ?? null,
    inventoryReversalMovementId: doc.inventory_reversal_movement_id ?? null,
    lineCount: Number(doc.line_count ?? doc.lines?.length ?? 0),
    returnQuantityTotal: doc.return_quantity_total === undefined || doc.return_quantity_total === null
      ? '0'
      : String(doc.return_quantity_total),
    baseQuantityTotal: doc.base_quantity_total === undefined || doc.base_quantity_total === null
      ? '0'
      : String(doc.base_quantity_total),
    createdAt: doc.created_at,
    updatedAt: doc.updated_at,
    createdBy: doc.created_by,
    updatedBy: doc.updated_by,
    lines: Array.isArray(doc.lines) ? Object.freeze(doc.lines.map(mapLine)) : undefined,
  });
}

function validateListInput(input) {
  const search = input.search ? text(input.search, 256) : null;
  if (input.search && search === null) return failure('INVALID_SEARCH', 'Search must not exceed 256 characters');
  if (input.status && !RETURN_STATUSES.has(input.status)) return failure('INVALID_STATUS', 'Supplier return status is invalid');
  if (input.supplierId && !isUuid(input.supplierId)) return failure('INVALID_SUPPLIER_ID', 'Supplier ID is invalid');
  if (input.warehouseId && !isUuid(input.warehouseId)) return failure('INVALID_WAREHOUSE_ID', 'Warehouse ID is invalid');
  if (input.warehouseId && !warehouseAllowed(input.requestContext, input.warehouseId)) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Warehouse is outside the authorized scope');
  }
  return { ok: true, search };
}

async function ensureSupplierReturnSeries(client, { installationId, actorId }) {
  let series = await documentNumberRepository.getDocumentNumberSeriesByCode(client, {
    installationId,
    code: SUPPLIER_RETURN_SERIES_CODE,
  });
  if (series) return series;
  series = await documentNumberRepository.insertDocumentNumberSeries(client, {
    installationId,
    code: SUPPLIER_RETURN_SERIES_CODE,
    documentType: 'SUPPLIER_RETURN',
    name: 'Phieu tra nha cung cap',
    prefix: 'SR-',
    numberTemplate: '{PREFIX}{YYYY}{MM}-{SEQ}',
    resetPolicy: 'MONTHLY',
    sequenceWidth: 6,
    startCounter: '1',
    timezoneName: 'Asia/Ho_Chi_Minh',
    description: 'Series mac dinh cho phieu tra nha cung cap.',
    isActive: true,
    createdBy: actorId,
  });
  if (series) return series;
  return documentNumberRepository.getDocumentNumberSeriesByCode(client, {
    installationId,
    code: SUPPLIER_RETURN_SERIES_CODE,
  });
}

async function loadReturn(client, { requestContext, id, forUpdate = false }) {
  const doc = await repository.getSupplierReturnById(client, {
    installationId: requestContext.installationId,
    id,
    warehouseIds: warehouseScopeIds(requestContext),
    forUpdate,
  });
  return doc
    ? Object.freeze({ ok: true, raw: doc, supplierReturn: mapReturn(doc) })
    : failure('SUPPLIER_RETURN_NOT_FOUND', 'Supplier return was not found');
}

function normalizeInputLine(line, index) {
  if (!line || typeof line !== 'object' || Array.isArray(line)) {
    return failure('INVALID_LINE', `Line ${index + 1} is invalid`);
  }
  const sourceGoodsReceiptLineId = text(line.sourceGoodsReceiptLineId ?? line.source_goods_receipt_line_id, 64);
  if (!isUuid(sourceGoodsReceiptLineId)) {
    return failure('INVALID_SOURCE_GOODS_RECEIPT_LINE_ID', `Line ${index + 1} sourceGoodsReceiptLineId is invalid`);
  }
  const returnQuantity = decimalToScaled(line.returnQuantity ?? line.return_quantity, { allowZero: false });
  if (returnQuantity === null) {
    return failure('INVALID_RETURN_QUANTITY', `Line ${index + 1} returnQuantity must be a positive decimal`);
  }
  const reasonCode = normalizeReasonCode(line.reasonCode ?? line.reason_code);
  if (!reasonCode) {
    return failure('INVALID_REASON_CODE', `Line ${index + 1} reasonCode is invalid`);
  }
  const reasonNote = text(line.reasonNote ?? line.reason_note, 2000);
  if (!reasonNote) {
    return failure('INVALID_REASON_NOTE', `Line ${index + 1} reasonNote is required`);
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      sourceGoodsReceiptLineId,
      returnQuantity: scaledToDecimal(returnQuantity),
      returnQuantityScaled: returnQuantity,
      reasonCode,
      reasonNote,
      note: text(line.note, 2000),
      id: typeof line.id === 'string' && isUuid(line.id) ? line.id.trim() : randomUUID(),
    }),
  });
}

async function validateLines(client, { requestContext, payload, strictReceiptStatus = false }) {
  if (!Array.isArray(payload.lines) || payload.lines.length < 1 || payload.lines.length > 500) {
    return failure('INVALID_LINES', 'Supplier return must contain between 1 and 500 lines');
  }
  const seen = new Set();
  const normalized = [];
  for (let index = 0; index < payload.lines.length; index += 1) {
    const input = normalizeInputLine(payload.lines[index], index);
    if (!input.ok) return input;
    if (seen.has(input.value.sourceGoodsReceiptLineId)) {
      return failure('DUPLICATE_SOURCE_GOODS_RECEIPT_LINE', `Line ${index + 1} references the same goods receipt line twice`);
    }
    seen.add(input.value.sourceGoodsReceiptLineId);
    normalized.push(input.value);
  }

  const sourceRows = await repository.getSourceGoodsReceiptLines(client, {
    installationId: requestContext.installationId,
    lineIds: normalized.map((line) => line.sourceGoodsReceiptLineId),
  });
  if (sourceRows.length !== normalized.length) {
    return failure('SOURCE_GOODS_RECEIPT_LINE_NOT_FOUND', 'One or more source goods receipt lines were not found');
  }
  const sourceMap = new Map(sourceRows.map((row) => [row.source_goods_receipt_line_id, row]));

  const postedTotals = new Map();
  if (normalized.length > 0) {
    const result = await client.query(
      `SELECT line.source_goods_receipt_line_id,
              COALESCE(SUM(line.return_quantity), 0::numeric) AS posted_return_quantity
         FROM purchasing.supplier_return_lines line
         JOIN purchasing.supplier_returns sr
           ON sr.installation_id = line.installation_id
          AND sr.id = line.supplier_return_id
        WHERE line.installation_id = $1
          AND line.source_goods_receipt_line_id = ANY($2::uuid[])
          AND sr.status = 'posted'
        GROUP BY line.source_goods_receipt_line_id`,
      [requestContext.installationId, normalized.map((line) => line.sourceGoodsReceiptLineId)],
    );
    for (const row of result.rows ?? []) {
      postedTotals.set(row.source_goods_receipt_line_id, String(row.posted_return_quantity));
    }
  }

  const headerSupplierId = text(payload.supplierId, 64);
  const headerWarehouseId = text(payload.warehouseId, 64);
  if (!isUuid(headerSupplierId)) return failure('INVALID_SUPPLIER_ID', 'supplierId must be a valid UUID');
  if (!isUuid(headerWarehouseId)) return failure('INVALID_WAREHOUSE_ID', 'warehouseId must be a valid UUID');
  if (!warehouseAllowed(requestContext, headerWarehouseId)) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Warehouse is outside the authorized scope');
  }

  const returnDate = normalizeDate(payload.returnDate, true);
  if (!returnDate) return failure('INVALID_RETURN_DATE', 'returnDate must be a valid YYYY-MM-DD date');
  const note = text(payload.note, 4000);
  if (payload.note && note === null) return failure('INVALID_NOTE', 'Note must not exceed 4000 characters');

  const lines = [];
  for (let index = 0; index < normalized.length; index += 1) {
    const line = normalized[index];
    const source = sourceMap.get(line.sourceGoodsReceiptLineId);
    if (!source) return failure('SOURCE_GOODS_RECEIPT_LINE_NOT_FOUND', `Line ${index + 1} source goods receipt line was not found`);
    if (source.source_supplier_id !== headerSupplierId) {
      return failure('SUPPLIER_MISMATCH', `Line ${index + 1} source line supplier does not match the document header`);
    }
    if (source.source_warehouse_id !== headerWarehouseId) {
      return failure('WAREHOUSE_MISMATCH', `Line ${index + 1} source line warehouse does not match the document header`);
    }
    const acceptedQuantity = decimalToScaled(String(source.source_accepted_quantity), { allowZero: false });
    if (acceptedQuantity === null || acceptedQuantity <= 0n) {
      return failure('SOURCE_LINE_NOT_RETURNABLE', `Line ${index + 1} source goods receipt line is not returnable`);
    }
    const postedReturnQuantity = decimalToScaled(postedTotals.get(source.source_goods_receipt_line_id) ?? '0', { allowZero: true }) ?? 0n;
    const returnableQuantity = acceptedQuantity - postedReturnQuantity;
    if (returnableQuantity <= 0n) {
      return failure('SOURCE_LINE_NOT_RETURNABLE', `Line ${index + 1} source goods receipt line has no remaining returnable quantity`);
    }
    if (line.returnQuantityScaled > returnableQuantity) {
      return failure('RETURN_QUANTITY_EXCEEDS_RETURNABLE', `Line ${index + 1} return quantity exceeds the remaining returnable quantity`);
    }
    if (line.reasonCode === 'OTHER' && !line.reasonNote) {
      return failure('INVALID_REASON_NOTE', `Line ${index + 1} reasonNote is required for OTHER`);
    }
    lines.push(Object.freeze({
      ...line,
      sourceGoodsReceiptId: source.source_goods_receipt_id,
      sourceGoodsReceiptNumber: source.source_goods_receipt_number,
      sourceGoodsReceiptStatus: source.source_goods_receipt_status,
      sourceGoodsReceiptLineNumber: Number(source.source_goods_receipt_line_number),
      sourcePurchaseOrderId: source.source_purchase_order_id,
      sourcePurchaseOrderNumber: source.source_purchase_order_number,
      sourcePurchaseOrderLineId: source.source_purchase_order_line_id,
      sourcePurchaseOrderLineNumber: Number(source.source_purchase_order_line_number),
      sourceSupplierId: source.source_supplier_id,
      sourceSupplierCode: source.source_supplier_code,
      sourceSupplierName: source.source_supplier_name,
      sourceWarehouseId: source.source_warehouse_id,
      sourceWarehouseCode: source.source_warehouse_code,
      sourceWarehouseName: source.source_warehouse_name,
      sourceVariantId: source.source_variant_id,
      sourceSkuSnapshot: source.source_sku_snapshot,
      sourceItemNameSnapshot: source.source_item_name_snapshot,
      sourceUnitId: source.source_unit_id,
      sourceUnitCodeSnapshot: source.source_unit_code_snapshot,
      baseVariantId: source.base_variant_id,
      baseSkuSnapshot: source.base_sku_snapshot,
      conversionToBase: String(source.conversion_to_base),
      sourceAcceptedQuantity: String(source.source_accepted_quantity),
      returnQuantity: line.returnQuantity,
      baseQuantity: scaledToDecimal(multiplyScaled(line.returnQuantityScaled, decimalToScaled(String(source.conversion_to_base), { allowZero: false }))),
      locationId: source.location_id ?? null,
      lotId: source.lot_id ?? null,
      lotCodeSnapshot: source.lot_code_snapshot ?? null,
      manufacturedDate: source.manufactured_date ?? null,
      expiryDate: source.expiry_date ?? null,
      supplierLotReference: source.supplier_lot_reference ?? null,
    }));
  }

  if (strictReceiptStatus && lines.some((line) => line.sourceGoodsReceiptStatus !== 'posted')) {
    return failure('SOURCE_RECEIPT_NOT_POSTED', 'One or more source goods receipts are no longer posted');
  }

  return Object.freeze({
    ok: true,
    value: Object.freeze({
      supplierId: headerSupplierId,
      warehouseId: headerWarehouseId,
      returnDate,
      note,
      lines: Object.freeze(lines),
    }),
  });
}

export async function listSupplierReturns(client, input) {
  const validation = validateListInput(input);
  if (!validation.ok) return validation;
  const supplierReturns = await repository.listSupplierReturns(client, {
    installationId: input.requestContext.installationId,
    warehouseIds: warehouseScopeIds(input.requestContext),
    supplierId: input.supplierId || null,
    status: input.status || null,
    search: validation.search,
    limit: input.limit,
    offset: input.offset,
  });
  return Object.freeze({ ok: true, supplierReturns: Object.freeze(supplierReturns.map(mapReturn)) });
}

export async function listSupplierReturnSourceLines(client, { requestContext, goodsReceiptId }) {
  if (!isUuid(goodsReceiptId)) return failure('INVALID_GOODS_RECEIPT_ID', 'goodsReceiptId is invalid');
  const receipt = await goodsReceiptRepository.getGoodsReceiptById(client, {
    installationId: requestContext.installationId,
    id: goodsReceiptId.trim(),
    warehouseIds: warehouseScopeIds(requestContext),
  });
  if (!receipt) return failure('GOODS_RECEIPT_NOT_FOUND', 'Goods receipt was not found');
  if (receipt.status !== 'posted') return failure('SOURCE_RECEIPT_NOT_POSTED', 'Only posted goods receipts can be returned to supplier');
  const purchaseOrder = await purchaseOrderRepository.getPurchaseOrderById(client, {
    installationId: requestContext.installationId,
    id: receipt.purchase_order_id,
    warehouseIds: warehouseScopeIds(requestContext),
  });
  if (!purchaseOrder) return failure('PURCHASE_ORDER_NOT_FOUND', 'Purchase order was not found');

  const lines = (receipt.lines ?? []).filter((line) => decimalToScaled(String(line.accepted_quantity ?? 0), { allowZero: true }) > 0n);
  if (lines.length === 0) {
    return Object.freeze({ ok: true, sourceLines: Object.freeze([]) });
  }
  const result = await client.query(
    `SELECT line.source_goods_receipt_line_id,
            COALESCE(SUM(line.return_quantity), 0::numeric) AS posted_return_quantity
       FROM purchasing.supplier_return_lines line
       JOIN purchasing.supplier_returns sr
         ON sr.installation_id = line.installation_id
        AND sr.id = line.supplier_return_id
      WHERE line.installation_id = $1
        AND line.source_goods_receipt_line_id = ANY($2::uuid[])
        AND sr.status = 'posted'
      GROUP BY line.source_goods_receipt_line_id`,
    [requestContext.installationId, lines.map((line) => line.id)],
  );
  const postedMap = new Map((result.rows ?? []).map((row) => [row.source_goods_receipt_line_id, String(row.posted_return_quantity)]));
  const sourceLines = lines.map((line) => {
    const accepted = decimalToScaled(String(line.accepted_quantity ?? '0'), { allowZero: true }) ?? 0n;
    const posted = decimalToScaled(postedMap.get(line.id) ?? '0', { allowZero: true }) ?? 0n;
    const returnable = accepted - posted;
    return Object.freeze({
      sourceGoodsReceiptId: receipt.id,
      sourceGoodsReceiptNumber: receipt.document_number ?? null,
      sourceGoodsReceiptStatus: receipt.status,
      sourceGoodsReceiptLineId: line.id,
      sourceGoodsReceiptLineNumber: line.line_number,
      sourcePurchaseOrderId: purchaseOrder.id,
      sourcePurchaseOrderNumber: purchaseOrder.document_number,
      sourcePurchaseOrderLineId: line.purchase_order_line_id,
      sourcePurchaseOrderLineNumber: line.purchase_order_line_number,
      sourceSupplierId: purchaseOrder.supplier_id,
      sourceSupplierCode: purchaseOrder.supplier_code,
      sourceSupplierName: purchaseOrder.supplier_name,
      sourceWarehouseId: receipt.warehouse_id,
      sourceWarehouseCode: receipt.warehouse_code ?? null,
      sourceWarehouseName: receipt.warehouse_name ?? null,
      sourceVariantId: line.variant_id,
      sourceSku: line.sku_snapshot,
      sourceItemName: line.item_name_snapshot,
      sourceUnitId: line.unit_id,
      sourceUnitCode: line.unit_code_snapshot,
      baseVariantId: null,
      baseSku: null,
      conversionToBase: line.conversion_to_base,
      sourceAcceptedQuantity: scaledToDecimal(accepted),
      returnableQuantity: scaledToDecimalFixed(returnable > 0n ? returnable : 0n),
      postedReturnQuantity: scaledToDecimalFixed(posted),
      locationId: line.location_id ?? null,
      lotId: line.lot_id ?? null,
      lotCode: line.lot_code_snapshot ?? null,
      manufacturedDate: line.manufactured_date ?? null,
      expiryDate: line.expiry_date ?? null,
      supplierLotReference: line.supplier_lot_reference ?? null,
    });
  });
  return Object.freeze({ ok: true, sourceLines: Object.freeze(sourceLines) });
}

export async function getSupplierReturn(client, { requestContext, id, forUpdate = false }) {
  if (!isUuid(id)) return failure('SUPPLIER_RETURN_NOT_FOUND', 'Supplier return was not found');
  const doc = await repository.getSupplierReturnById(client, {
    installationId: requestContext.installationId,
    id: id.trim(),
    warehouseIds: warehouseScopeIds(requestContext),
    forUpdate,
  });
  return doc
    ? Object.freeze({ ok: true, supplierReturn: mapReturn(doc), raw: doc })
    : failure('SUPPLIER_RETURN_NOT_FOUND', 'Supplier return was not found');
}

export async function createSupplierReturn(client, { requestContext, payload }) {
  const validation = await validateLines(client, { requestContext, payload, strictReceiptStatus: true });
  if (!validation.ok) return validation;
  const created = await repository.insertSupplierReturnDraft(client, {
    installationId: requestContext.installationId,
    supplierId: validation.value.supplierId,
    warehouseId: validation.value.warehouseId,
    returnDate: validation.value.returnDate,
    note: validation.value.note,
    actorId: requestContext.actorId,
    lines: validation.value.lines,
  });
  return Object.freeze({ ok: true, supplierReturn: mapReturn(created) });
}

export async function updateSupplierReturn(client, { requestContext, id, payload }) {
  const current = await getSupplierReturn(client, { requestContext, id, forUpdate: true });
  if (!current.ok) return current;
  if (current.raw.status !== 'draft') return failure('SUPPLIER_RETURN_LOCKED', 'Only draft supplier returns can be edited');
  const expectedRevision = normalizeRevision(payload?.expectedRevision);
  if (!expectedRevision) return failure('EXPECTED_REVISION_REQUIRED', 'expectedRevision is required');
  if (String(current.raw.revision) !== expectedRevision) return failure('CONFLICT', 'Supplier return was changed by another request', true);
  const validation = await validateLines(client, { requestContext, payload, strictReceiptStatus: true });
  if (!validation.ok) return validation;
  const updated = await repository.updateSupplierReturnDraft(client, {
    installationId: requestContext.installationId,
    id: current.raw.id,
    supplierId: validation.value.supplierId,
    warehouseId: validation.value.warehouseId,
    returnDate: validation.value.returnDate,
    note: validation.value.note,
    actorId: requestContext.actorId,
    expectedRevision,
    lines: validation.value.lines,
  });
  if (!updated) return failure('CONFLICT', 'Supplier return was changed by another request', true);
  return Object.freeze({ ok: true, supplierReturn: mapReturn(updated), beforeData: current.supplierReturn });
}

export async function submitSupplierReturn(client, { requestContext, id, payload }) {
  const current = await getSupplierReturn(client, { requestContext, id, forUpdate: true });
  if (!current.ok) return current;
  if (current.raw.status !== 'draft') return failure('SUPPLIER_RETURN_LOCKED', 'Only draft supplier returns can be submitted');
  const expectedRevision = normalizeRevision(payload?.expectedRevision);
  if (!expectedRevision) return failure('EXPECTED_REVISION_REQUIRED', 'expectedRevision is required');
  if (String(current.raw.revision) !== expectedRevision) return failure('CONFLICT', 'Supplier return was changed by another request', true);
  const validation = await validateLines(client, {
    requestContext,
    payload: {
      supplierId: current.raw.supplier_id,
      warehouseId: current.raw.warehouse_id,
      returnDate: dateOnly(current.raw.return_date),
      note: current.raw.note,
      lines: current.raw.lines ?? [],
    },
    strictReceiptStatus: true,
  });
  if (!validation.ok) return validation;
  const submitted = await repository.submitSupplierReturn(client, {
    installationId: requestContext.installationId,
    id: current.raw.id,
    actorId: requestContext.actorId,
    expectedRevision,
  });
  if (!submitted) return failure('CONFLICT', 'Supplier return was changed by another request', true);
  return Object.freeze({ ok: true, supplierReturn: mapReturn(submitted), beforeData: current.supplierReturn });
}

export async function approveSupplierReturn(client, { requestContext, id, payload }) {
  const current = await getSupplierReturn(client, { requestContext, id, forUpdate: true });
  if (!current.ok) return current;
  if (current.raw.status !== 'pending_approval') return failure('SUPPLIER_RETURN_LOCKED', 'Only pending approval supplier returns can be approved');
  const expectedRevision = normalizeRevision(payload?.expectedRevision);
  if (!expectedRevision) return failure('EXPECTED_REVISION_REQUIRED', 'expectedRevision is required');
  if (String(current.raw.revision) !== expectedRevision) return failure('CONFLICT', 'Supplier return was changed by another request', true);
  const approved = await repository.approveSupplierReturn(client, {
    installationId: requestContext.installationId,
    id: current.raw.id,
    actorId: requestContext.actorId,
    expectedRevision,
  });
  if (!approved) return failure('CONFLICT', 'Supplier return was changed by another request', true);
  return Object.freeze({ ok: true, supplierReturn: mapReturn(approved), beforeData: current.supplierReturn });
}

export async function cancelSupplierReturn(client, { requestContext, id, payload }) {
  const current = await getSupplierReturn(client, { requestContext, id, forUpdate: true });
  if (!current.ok) return current;
  if (!['draft', 'pending_approval', 'approved'].includes(current.raw.status)) {
    return failure('SUPPLIER_RETURN_LOCKED', 'Only draft, pending approval or approved supplier returns can be cancelled');
  }
  const expectedRevision = normalizeRevision(payload?.expectedRevision);
  if (!expectedRevision) return failure('EXPECTED_REVISION_REQUIRED', 'expectedRevision is required');
  if (String(current.raw.revision) !== expectedRevision) return failure('CONFLICT', 'Supplier return was changed by another request', true);
  const cancellationReason = text(payload?.reason ?? payload?.cancellationReason, 1000);
  if (!cancellationReason) return failure('CANCELLATION_REASON_REQUIRED', 'Cancellation reason is required');
  const cancelled = await repository.cancelSupplierReturn(client, {
    installationId: requestContext.installationId,
    id: current.raw.id,
    actorId: requestContext.actorId,
    cancellationReason,
    expectedRevision,
  });
  if (!cancelled) return failure('CONFLICT', 'Supplier return was changed by another request', true);
  return Object.freeze({ ok: true, supplierReturn: mapReturn(cancelled), beforeData: current.supplierReturn });
}

async function lockSourceLines(client, { installationId, sourceLineIds }) {
  if (sourceLineIds.length === 0) return [];
  const result = await client.query(
    `SELECT grl.id AS source_goods_receipt_line_id
       FROM purchasing.goods_receipt_lines grl
       JOIN purchasing.goods_receipts gr
         ON gr.installation_id = grl.installation_id AND gr.id = grl.goods_receipt_id
      WHERE grl.installation_id = $1
        AND grl.id = ANY($2::uuid[])
      FOR UPDATE OF grl, gr`,
    [installationId, sourceLineIds],
  );
  return result.rows ?? [];
}

async function lockSourceReceiptLines(client, requestContext, lines) {
  const sourceLineIds = lines
    .map((line) => text(line.sourceGoodsReceiptLineId ?? line.source_goods_receipt_line_id, 64))
    .filter((value) => isUuid(value));
  const locked = await lockSourceLines(client, {
    installationId: requestContext.installationId,
    sourceLineIds,
  });
  if (locked.length !== sourceLineIds.length) {
    return failure('SOURCE_GOODS_RECEIPT_LINE_NOT_FOUND', 'One or more source goods receipt lines were not found');
  }
  return Object.freeze({ ok: true });
}

export async function postSupplierReturn(client, { requestContext, id, payload, idempotencyKey }) {
  const current = await getSupplierReturn(client, { requestContext, id, forUpdate: true });
  if (!current.ok) return current;
  if (current.raw.status !== 'approved') return failure('SUPPLIER_RETURN_LOCKED', 'Only approved supplier returns can be posted');
  const expectedRevision = normalizeRevision(payload?.expectedRevision);
  if (!expectedRevision) return failure('EXPECTED_REVISION_REQUIRED', 'expectedRevision is required');
  if (String(current.raw.revision) !== expectedRevision) return failure('CONFLICT', 'Supplier return was changed by another request', true);

  const lockResult = await lockSourceReceiptLines(client, requestContext, current.raw.lines ?? []);
  if (!lockResult.ok) return lockResult;
  const validation = await validateLines(client, {
    requestContext,
    payload: {
      supplierId: current.raw.supplier_id,
      warehouseId: current.raw.warehouse_id,
      returnDate: dateOnly(current.raw.return_date),
      note: current.raw.note,
      lines: current.raw.lines ?? [],
    },
    strictReceiptStatus: true,
  });
  if (!validation.ok) return validation;

  const lineRows = current.raw.lines ?? [];
  const series = await ensureSupplierReturnSeries(client, {
    installationId: requestContext.installationId,
    actorId: requestContext.actorId,
  });
  if (!series) return failure('DOCUMENT_NUMBER_SERIES_UNAVAILABLE', 'Supplier return number series is unavailable', true);

  const returnDate = dateOnly(current.raw.return_date);
  if (!returnDate) return failure('INVALID_RETURN_DATE', 'Stored return date is invalid');
  const allocation = await allocateDocumentNumber(client, {
    installationId: requestContext.installationId,
    seriesId: series.id,
    idempotencyKey,
    payload: {
      documentDate: returnDate,
      metadata: {
        supplierReturnId: current.raw.id,
        supplierId: current.raw.supplier_id,
        warehouseId: current.raw.warehouse_id,
      },
    },
    actorId: requestContext.actorId,
    requestId: requestContext.requestId,
    sourceApp: requestContext.sourceApp,
  });
  if (!allocation.ok) return allocation;

  const movementLines = lineRows.map((line) => ({
    warehouseId: line.source_warehouse_id,
    locationId: line.location_id,
    sourceVariantId: line.source_variant_id,
    sourceSku: line.source_sku_snapshot,
    sourceUnitId: line.source_unit_id,
    sourceUnitCode: line.source_unit_code_snapshot,
    sourceQuantity: line.return_quantity,
    conversionToBase: line.conversion_to_base,
    baseVariantId: line.base_variant_id,
    baseSku: line.base_sku_snapshot,
    direction: 'OUT',
    sourceLineReference: `${line.source_goods_receipt_number}#${line.source_goods_receipt_line_number}`,
    lotId: line.lot_id,
    lotCode: line.lot_code_snapshot,
    manufacturedDate: line.manufactured_date,
    expiryDate: line.expiry_date,
    supplierLotReference: line.supplier_lot_reference,
    metadata: {
      supplierReturnId: current.raw.id,
      supplierReturnLineId: line.id,
      sourceGoodsReceiptId: line.source_goods_receipt_id,
      sourceGoodsReceiptLineId: line.source_goods_receipt_line_id,
      sourcePurchaseOrderLineId: line.source_purchase_order_line_id,
      reasonCode: line.reason_code,
      reasonNote: line.reason_note,
    },
  }));

  const movementResult = await postInventoryMovement(client, {
    requestContext,
    idempotencyKey,
    payload: {
      movementType: 'SUPPLIER_RETURN',
      sourceDomain: 'PURCHASING',
      sourceDocumentType: 'SUPPLIER_RETURN',
      sourceDocumentId: current.raw.id,
      sourceDocumentNumber: allocation.allocation.document_number,
      documentDate: returnDate,
      reasonCode: 'SUPPLIER_RETURN',
      reasonNote: current.raw.note ?? 'Supplier return posted',
      metadata: {
        supplierReturnId: current.raw.id,
        supplierId: current.raw.supplier_id,
        warehouseId: current.raw.warehouse_id,
      },
      lines: movementLines,
    },
  });
  if (!movementResult.ok) return movementResult;

  const posted = await repository.postSupplierReturn(client, {
    installationId: requestContext.installationId,
    id: current.raw.id,
    documentNumber: allocation.allocation.document_number,
    documentNumberAllocationId: allocation.allocation.id,
    inventoryMovementId: movementResult.movement.id,
    actorId: requestContext.actorId,
    expectedRevision,
  });
  if (!posted) return failure('CONFLICT', 'Supplier return was changed by another request', true);
  return Object.freeze({ ok: true, supplierReturn: mapReturn(posted), beforeData: current.supplierReturn });
}

export async function reverseSupplierReturn(client, { requestContext, id, payload, idempotencyKey }) {
  const current = await getSupplierReturn(client, { requestContext, id, forUpdate: true });
  if (!current.ok) return current;
  if (current.raw.status !== 'posted') return failure('SUPPLIER_RETURN_LOCKED', 'Only posted supplier returns can be reversed');
  const expectedRevision = normalizeRevision(payload?.expectedRevision);
  if (!expectedRevision) return failure('EXPECTED_REVISION_REQUIRED', 'expectedRevision is required');
  if (String(current.raw.revision) !== expectedRevision) return failure('CONFLICT', 'Supplier return was changed by another request', true);
  const documentDate = normalizeDate(payload?.documentDate, true);
  if (!documentDate) return failure('INVALID_DOCUMENT_DATE', 'documentDate must be a valid YYYY-MM-DD date');
  const reasonCode = normalizeReasonCode(payload?.reasonCode) ?? 'SUPPLIER_RETURN_REVERSAL';
  const reasonNote = text(payload?.reasonNote ?? payload?.reversalReason, 2000);
  if (!reasonNote) return failure('REVERSAL_REASON_REQUIRED', 'reasonNote or reversalReason is required');

  const reversalResult = await reverseInventoryMovement(client, {
    requestContext,
    idempotencyKey,
    movementId: current.raw.inventory_movement_id,
    payload: {
      documentDate,
      reasonCode,
      reasonNote,
    },
  });
  if (!reversalResult.ok) return reversalResult;

  const reversed = await repository.reverseSupplierReturn(client, {
    installationId: requestContext.installationId,
    id: current.raw.id,
    inventoryReversalMovementId: reversalResult.movement.id,
    actorId: requestContext.actorId,
    reversalReason: reasonNote,
    expectedRevision,
  });
  if (!reversed) return failure('CONFLICT', 'Supplier return was changed by another request', true);
  return Object.freeze({ ok: true, supplierReturn: mapReturn(reversed), beforeData: current.supplierReturn });
}

export async function sourceGoodsReceiptBlockingSupplierReturns(client, { requestContext, goodsReceiptId }) {
  return repository.hasBlockingSupplierReturnsForGoodsReceipt(client, {
    installationId: requestContext.installationId,
    goodsReceiptId,
  });
}

export const supplierReturnInternals = Object.freeze({
  decimalToScaled,
  scaledToDecimal,
  multiplyScaled,
  dateOnly,
  normalizeDate,
  normalizeReasonCode,
  normalizeRevision,
});

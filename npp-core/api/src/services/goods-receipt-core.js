import { randomUUID } from 'node:crypto';
import * as repository from '../db/repositories/goods-receipt.js';
import * as purchaseOrderRepository from '../db/repositories/purchase-order.js';
import * as supplierReturnRepository from '../db/repositories/supplier-return.js';
import * as documentNumberRepository from '../db/repositories/document-numbering.js';
import { allocateDocumentNumber } from './document-numbering.js';
import { postInventoryMovement, reverseInventoryMovement } from './inventory-ledger.js';
import { PERMISSIONS } from '../request-context.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DECIMAL_PATTERN = /^(0|[1-9]\d{0,13})(?:\.(\d{1,6}))?$/;
const INTEGER_PATTERN = /^[1-9]\d{0,18}$/;
const LOT_CODE_PATTERN = /^[A-Z0-9_.-]{1,100}$/i;
const QUALITY_REASON_PATTERN = /^[A-Z0-9_.-]{1,64}$/i;
const GOODS_RECEIPT_SERIES_CODE = 'PURCHASE_RECEIPT';
const SCALE = 1_000_000n;
const STATUSES = new Set(['draft', 'posted', 'reversed']);
const RECEIPT_PURCHASE_ORDER_STATUSES = new Set(['approved', 'partially_received']);

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

function multiplyScaled(left, right) {
  return (left * right + SCALE / 2n) / SCALE;
}

function normalizeRevision(value) {
  const textValue = String(value ?? '').trim();
  return INTEGER_PATTERN.test(textValue) ? textValue : null;
}

function normalizeLotCode(value) {
  const normalized = text(value, 100)?.toUpperCase() ?? null;
  return normalized && LOT_CODE_PATTERN.test(normalized) ? normalized : null;
}

function normalizeQualityReasonCode(value) {
  const normalized = text(value, 64)?.toUpperCase() ?? null;
  return normalized && QUALITY_REASON_PATTERN.test(normalized) ? normalized : null;
}

function parseBoolean(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function hasVariancePermission(requestContext) {
  return Array.isArray(requestContext?.permissions)
    && requestContext.permissions.includes(PERMISSIONS.coreGoodsReceiptVariance);
}

function warehouseScopeIds(requestContext) {
  return Array.isArray(requestContext?.scopes?.warehouseIds)
    ? [...new Set(requestContext.scopes.warehouseIds.filter(isUuid).map((value) => value.trim()))]
    : [];
}

function warehouseAllowed(requestContext, warehouseId) {
  return warehouseScopeIds(requestContext).includes(warehouseId);
}

function mapLine(line) {
  return Object.freeze({
    id: line.id,
    lineNumber: Number(line.line_number),
    purchaseOrderLineId: line.purchase_order_line_id,
    purchaseOrderLineNumber: Number(line.purchase_order_line_number ?? line.line_number),
    warehouseId: line.warehouse_id,
    variantId: line.variant_id,
    skuCode: line.sku_snapshot,
    itemName: line.item_name_snapshot,
    unitId: line.unit_id,
    unitCode: line.unit_code_snapshot,
    conversionToBase: String(line.conversion_to_base),
    orderedQuantity: String(line.ordered_quantity),
    receivedQuantityBefore: String(line.received_quantity_before),
    remainingQuantityBefore: String(line.remaining_quantity_before),
    receivedQuantity: String(line.received_quantity),
    acceptedQuantity: String(line.accepted_quantity),
    rejectedQuantity: String(line.rejected_quantity),
    shortageClosedQuantity: String(line.shortage_closed_quantity),
    finalizeLine: Boolean(line.finalize_line),
    qualityReasonCode: line.quality_reason_code ?? null,
    qualityNote: line.quality_note ?? null,
    baseQuantity: String(line.base_quantity),
    remainingQuantityAfter: String(line.remaining_quantity_after),
    locationId: line.location_id ?? null,
    lotId: line.lot_id ?? null,
    lotCode: line.lot_code_snapshot ?? null,
    manufacturedDate: line.manufactured_date ?? null,
    expiryDate: line.expiry_date ?? null,
    supplierLotReference: line.supplier_lot_reference ?? null,
    note: line.note ?? null,
  });
}

function mapReceipt(receipt) {
  return Object.freeze({
    id: receipt.id,
    purchaseOrderId: receipt.purchase_order_id,
    purchaseOrderNumber: receipt.purchase_order_number ?? null,
    purchaseOrderStatus: receipt.purchase_order_status,
    status: receipt.status,
    warehouseId: receipt.warehouse_id,
    warehouseCode: receipt.warehouse_code,
    warehouseName: receipt.warehouse_name,
    supplierCode: receipt.supplier_code,
    supplierName: receipt.supplier_name,
    documentNumber: receipt.document_number ?? null,
    receiptDate: dateOnly(receipt.receipt_date),
    supplierDeliveryReference: receipt.supplier_delivery_reference ?? null,
    note: receipt.note ?? null,
    revision: String(receipt.revision),
    postedAt: receipt.posted_at ?? null,
    postedBy: receipt.posted_by ?? null,
    reversedAt: receipt.reversed_at ?? null,
    reversedBy: receipt.reversed_by ?? null,
    reversalReason: receipt.reversal_reason ?? null,
    inventoryMovementId: receipt.inventory_movement_id ?? null,
    inventoryReversalMovementId: receipt.inventory_reversal_movement_id ?? null,
    lineCount: Number(receipt.line_count ?? receipt.lines?.length ?? 0),
    receivedQuantityTotal: receipt.received_quantity_total === undefined || receipt.received_quantity_total === null
      ? '0'
      : String(receipt.received_quantity_total),
    acceptedQuantityTotal: receipt.accepted_quantity_total === undefined || receipt.accepted_quantity_total === null
      ? '0'
      : String(receipt.accepted_quantity_total),
    rejectedQuantityTotal: receipt.rejected_quantity_total === undefined || receipt.rejected_quantity_total === null
      ? '0'
      : String(receipt.rejected_quantity_total),
    shortageClosedQuantityTotal: receipt.shortage_closed_quantity_total === undefined || receipt.shortage_closed_quantity_total === null
      ? '0'
      : String(receipt.shortage_closed_quantity_total),
    baseQuantityTotal: receipt.base_quantity_total === undefined || receipt.base_quantity_total === null
      ? '0'
      : String(receipt.base_quantity_total),
    createdAt: receipt.created_at,
    updatedAt: receipt.updated_at,
    createdBy: receipt.created_by,
    updatedBy: receipt.updated_by,
    lines: Array.isArray(receipt.lines) ? Object.freeze(receipt.lines.map(mapLine)) : undefined,
  });
}

function normalizeListInput(input) {
  const search = input.search ? text(input.search, 256) : null;
  if (input.search && search === null) return failure('INVALID_SEARCH', 'Search must not exceed 256 characters');
  if (input.status && !STATUSES.has(input.status)) return failure('INVALID_STATUS', 'Goods receipt status is invalid');
  if (input.purchaseOrderId && !isUuid(input.purchaseOrderId)) return failure('INVALID_PURCHASE_ORDER_ID', 'Purchase order ID is invalid');
  if (input.warehouseId && !isUuid(input.warehouseId)) return failure('INVALID_WAREHOUSE_ID', 'Warehouse ID is invalid');
  if (input.warehouseId && !warehouseAllowed(input.requestContext, input.warehouseId)) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Warehouse is outside the authorized scope');
  }
  return { ok: true, search };
}

function normalizeInputLine(line, index) {
  if (!line || typeof line !== 'object' || Array.isArray(line)) {
    return failure('INVALID_LINE', `Line ${index + 1} is invalid`);
  }
  const purchaseOrderLineId = typeof line.purchaseOrderLineId === 'string'
    ? line.purchaseOrderLineId.trim()
    : typeof line.purchase_order_line_id === 'string'
      ? line.purchase_order_line_id.trim()
      : '';
  if (!isUuid(purchaseOrderLineId)) {
    return failure('INVALID_PURCHASE_ORDER_LINE_ID', `Line ${index + 1} purchaseOrderLineId is invalid`);
  }
  const receivedQuantityRaw = line.receivedQuantity ?? line.received_quantity;
  const acceptedQuantityRaw = line.acceptedQuantity ?? line.accepted_quantity;
  const rejectedQuantityRaw = line.rejectedQuantity ?? line.rejected_quantity;
  const receivedQuantity = receivedQuantityRaw === undefined || receivedQuantityRaw === null || String(receivedQuantityRaw).trim() === ''
    ? null
    : decimalToScaled(receivedQuantityRaw, { allowZero: false });
  const acceptedQuantity = acceptedQuantityRaw === undefined || acceptedQuantityRaw === null || String(acceptedQuantityRaw).trim() === ''
    ? null
    : decimalToScaled(acceptedQuantityRaw, { allowZero: true });
  const rejectedQuantity = rejectedQuantityRaw === undefined || rejectedQuantityRaw === null || String(rejectedQuantityRaw).trim() === ''
    ? null
    : decimalToScaled(rejectedQuantityRaw, { allowZero: true });
  if (receivedQuantity === null && acceptedQuantity === null && rejectedQuantity === null) {
    return failure('INVALID_RECEIVED_QUANTITY', `Line ${index + 1} receivedQuantity must be a positive decimal`);
  }
  let normalizedReceivedQuantity = receivedQuantity;
  let normalizedAcceptedQuantity = acceptedQuantity;
  let normalizedRejectedQuantity = rejectedQuantity;
  if (normalizedReceivedQuantity === null) {
    if (normalizedAcceptedQuantity !== null && normalizedRejectedQuantity !== null) {
      normalizedReceivedQuantity = normalizedAcceptedQuantity + normalizedRejectedQuantity;
    } else if (normalizedAcceptedQuantity !== null) {
      normalizedReceivedQuantity = normalizedAcceptedQuantity;
    } else if (normalizedRejectedQuantity !== null) {
      normalizedReceivedQuantity = normalizedRejectedQuantity;
    }
  }
  if (normalizedAcceptedQuantity === null && normalizedRejectedQuantity === null) {
    normalizedAcceptedQuantity = normalizedReceivedQuantity;
    normalizedRejectedQuantity = 0n;
  } else if (normalizedAcceptedQuantity === null) {
    normalizedAcceptedQuantity = normalizedReceivedQuantity - normalizedRejectedQuantity;
  } else if (normalizedRejectedQuantity === null) {
    normalizedRejectedQuantity = normalizedReceivedQuantity - normalizedAcceptedQuantity;
  }
  if (normalizedReceivedQuantity === null || normalizedAcceptedQuantity === null || normalizedRejectedQuantity === null) {
    return failure('INVALID_RECEIVED_QUANTITY', `Line ${index + 1} receivedQuantity must be a positive decimal`);
  }
  if (normalizedAcceptedQuantity < 0n || normalizedRejectedQuantity < 0n) {
    return failure('INVALID_RECEIVED_QUANTITY', `Line ${index + 1} receivedQuantity must be a positive decimal`);
  }
  if (normalizedAcceptedQuantity + normalizedRejectedQuantity !== normalizedReceivedQuantity) {
    return failure('INVALID_RECEIVED_QUANTITY', `Line ${index + 1} receivedQuantity must equal acceptedQuantity + rejectedQuantity`);
  }
  const rawLocationId = line.locationId ?? line.location_id;
  const locationId = rawLocationId === undefined || rawLocationId === null || rawLocationId === ''
    ? null
    : String(rawLocationId).trim();
  if (locationId && !isUuid(locationId)) {
    return failure('INVALID_LOCATION_ID', `Line ${index + 1} locationId is invalid`);
  }
  const rawLotId = line.lotId ?? line.lot_id;
  const lotId = rawLotId === undefined || rawLotId === null || rawLotId === ''
    ? null
    : String(rawLotId).trim();
  if (lotId && !isUuid(lotId)) {
    return failure('INVALID_LOT_ID', `Line ${index + 1} lotId is invalid`);
  }
  const lotCodeSnapshot = line.lotCode ?? line.lot_code_snapshot ?? null;
  if (lotCodeSnapshot && !normalizeLotCode(lotCodeSnapshot)) {
    return failure('INVALID_LOT_CODE', `Line ${index + 1} lotCode is invalid`);
  }
  const manufacturedDate = normalizeDate(line.manufacturedDate ?? line.manufactured_date);
  if ((line.manufacturedDate ?? line.manufactured_date) && !manufacturedDate) {
    return failure('INVALID_MANUFACTURED_DATE', `Line ${index + 1} manufacturedDate is invalid`);
  }
  const expiryDate = normalizeDate(line.expiryDate ?? line.expiry_date);
  if ((line.expiryDate ?? line.expiry_date) && !expiryDate) {
    return failure('INVALID_EXPIRY_DATE', `Line ${index + 1} expiryDate is invalid`);
  }
  const finalizeLine = parseBoolean(line.finalizeLine ?? line.finalize_line);
  const qualityReasonCodeInput = line.qualityReasonCode ?? line.quality_reason_code ?? null;
  const qualityNote = text(line.qualityNote ?? line.quality_note, 2000);
  const varianceReasonRequired = normalizedRejectedQuantity > 0n || finalizeLine;
  let qualityReasonCode = null;
  if (varianceReasonRequired) {
    qualityReasonCode = normalizeQualityReasonCode(qualityReasonCodeInput);
    if (!qualityReasonCode) {
      return failure('INVALID_VARIANCE_REASON_CODE', `Line ${index + 1} variance reason code is required for rejected quantity or shortage closure`);
    }
    if (!qualityNote) {
      return failure('INVALID_VARIANCE_REASON_NOTE', `Line ${index + 1} variance reason note is required for rejected quantity or shortage closure`);
    }
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      purchaseOrderLineId,
      receivedQuantity: scaledToDecimal(normalizedReceivedQuantity),
      receivedQuantityScaled: normalizedReceivedQuantity,
      acceptedQuantity: scaledToDecimal(normalizedAcceptedQuantity),
      acceptedQuantityScaled: normalizedAcceptedQuantity,
      rejectedQuantity: scaledToDecimal(normalizedRejectedQuantity),
      rejectedQuantityScaled: normalizedRejectedQuantity,
      finalizeLine,
      qualityReasonCode,
      qualityNote: varianceReasonRequired ? qualityNote : null,
      locationId,
      lotId,
      lotCode: lotCodeSnapshot ? normalizeLotCode(lotCodeSnapshot) : null,
      manufacturedDate,
      expiryDate,
      supplierLotReference: text(line.supplierLotReference ?? line.supplier_lot_reference, 160),
      note: text(line.note, 2000),
      id: typeof line.id === 'string' && isUuid(line.id) ? line.id.trim() : randomUUID(),
    }),
  });
}

function buildReceiptLines(order, inputLines, requestContext) {
  const orderLines = new Map(order.lines.map((line) => [line.id, line]));
  const receiptLines = [];
  let varianceUsed = false;
  for (let index = 0; index < inputLines.length; index += 1) {
    const input = normalizeInputLine(inputLines[index], index);
    if (!input.ok) return input;
    const orderLine = orderLines.get(input.value.purchaseOrderLineId);
    if (!orderLine) {
      return failure('PURCHASE_ORDER_LINE_NOT_FOUND', `Line ${index + 1} purchase order line was not found`);
    }
    const orderedQuantity = decimalToScaled(String(orderLine.ordered_quantity), { allowZero: false });
    const receivedBefore = decimalToScaled(String(orderLine.received_quantity ?? '0'), { allowZero: true }) ?? 0n;
    const remainingBefore = decimalToScaled(String(orderLine.remaining_quantity ?? orderLine.ordered_quantity), { allowZero: true }) ?? orderedQuantity;
    if (input.value.acceptedQuantityScaled > remainingBefore) {
      return failure('RECEIPT_QUANTITY_EXCEEDS_REMAINING', `Line ${index + 1} accepted quantity exceeds the remaining purchase order quantity`);
    }
    const conversion = decimalToScaled(String(orderLine.conversion_to_base), { allowZero: false });
    if (conversion === null) return failure('INVALID_CONVERSION', `Line ${index + 1} conversion snapshot is invalid`);
    const shortageClosedQuantityScaled = input.value.finalizeLine ? remainingBefore - input.value.acceptedQuantityScaled : 0n;
    if (shortageClosedQuantityScaled < 0n) {
      return failure('RECEIPT_QUANTITY_EXCEEDS_REMAINING', `Line ${index + 1} quantity exceeds the remaining purchase order quantity`);
    }
    const remainingAfter = remainingBefore - input.value.acceptedQuantityScaled - shortageClosedQuantityScaled;
    if (remainingAfter < 0n) {
      return failure('RECEIPT_QUANTITY_EXCEEDS_REMAINING', `Line ${index + 1} quantity exceeds the remaining purchase order quantity`);
    }
    if (input.value.rejectedQuantityScaled > 0n || input.value.finalizeLine) varianceUsed = true;
    receiptLines.push(Object.freeze({
      id: input.value.id,
      installationId: order.installation_id,
      goodsReceiptId: order.goodsReceiptId ?? null,
      purchaseOrderLineId: orderLine.id,
      warehouseId: order.warehouse_id,
      lineNumber: index + 1,
      variantId: orderLine.variant_id,
      skuSnapshot: orderLine.sku_snapshot,
      itemNameSnapshot: orderLine.item_name_snapshot,
      unitId: orderLine.unit_id,
      unitCodeSnapshot: orderLine.unit_code_snapshot,
      conversionToBase: scaledToDecimal(conversion),
      orderedQuantity: scaledToDecimal(orderedQuantity),
      receivedQuantityBefore: scaledToDecimal(receivedBefore),
      remainingQuantityBefore: scaledToDecimal(remainingBefore),
      receivedQuantity: input.value.receivedQuantity,
      acceptedQuantity: input.value.acceptedQuantity,
      rejectedQuantity: input.value.rejectedQuantity,
      shortageClosedQuantity: scaledToDecimal(shortageClosedQuantityScaled),
      finalizeLine: input.value.finalizeLine,
      qualityReasonCode: input.value.qualityReasonCode,
      qualityNote: input.value.qualityNote,
      baseQuantity: scaledToDecimal(multiplyScaled(input.value.acceptedQuantityScaled, conversion)),
      remainingQuantityAfter: scaledToDecimal(remainingAfter),
      locationId: input.value.locationId,
      lotId: input.value.lotId,
      lotCodeSnapshot: input.value.lotCode,
      manufacturedDate: input.value.manufacturedDate,
      expiryDate: input.value.expiryDate,
      supplierLotReference: input.value.supplierLotReference,
      note: input.value.note,
    }));
  }
  if (varianceUsed && !hasVariancePermission(requestContext)) {
    return failure('GOODS_RECEIPT_VARIANCE_PERMISSION_REQUIRED', 'Variance-sensitive receipts require the variance permission');
  }
  return Object.freeze({ ok: true, value: Object.freeze(receiptLines) });
}

async function ensureGoodsReceiptSeries(client, { installationId, actorId }) {
  let series = await documentNumberRepository.getDocumentNumberSeriesByCode(client, {
    installationId,
    code: GOODS_RECEIPT_SERIES_CODE,
  });
  if (series) return series;
  series = await documentNumberRepository.insertDocumentNumberSeries(client, {
    installationId,
    code: GOODS_RECEIPT_SERIES_CODE,
    documentType: 'PURCHASE_RECEIPT',
    name: 'Phieu nhan hang',
    prefix: 'GR-',
    numberTemplate: '{PREFIX}{YYYY}{MM}-{SEQ}',
    resetPolicy: 'MONTHLY',
    sequenceWidth: 6,
    startCounter: '1',
    timezoneName: 'Asia/Ho_Chi_Minh',
    description: 'Series mac dinh cho phieu nhan hang mua vao.',
    isActive: true,
    createdBy: actorId,
  });
  if (series) return series;
  return documentNumberRepository.getDocumentNumberSeriesByCode(client, {
    installationId,
    code: GOODS_RECEIPT_SERIES_CODE,
  });
}

async function loadPurchaseOrderForReceipt(client, { requestContext, purchaseOrderId, forUpdate = false }) {
  const order = await purchaseOrderRepository.getPurchaseOrderById(client, {
    installationId: requestContext.installationId,
    id: purchaseOrderId,
    warehouseIds: warehouseScopeIds(requestContext),
    forUpdate,
  });
  return order ? { ok: true, raw: order } : failure('PURCHASE_ORDER_NOT_FOUND', 'Purchase order was not found');
}

async function loadReceipt(client, { requestContext, id, forUpdate = false }) {
  const receipt = await repository.getGoodsReceiptById(client, {
    installationId: requestContext.installationId,
    id,
    warehouseIds: warehouseScopeIds(requestContext),
    forUpdate,
  });
  return receipt ? { ok: true, raw: receipt, goodsReceipt: mapReceipt(receipt) } : failure('GOODS_RECEIPT_NOT_FOUND', 'Goods receipt was not found');
}

function normalizeOrderAndLines(orderResult, payloadLines, requestContext) {
  const built = buildReceiptLines(orderResult.raw, payloadLines, requestContext);
  if (!built.ok) return built;
  return Object.freeze({ ok: true, lines: built.value });
}

async function validateDraftMutation(client, { requestContext, payload, currentReceipt = null }) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return failure('INVALID_INPUT', 'Goods receipt data is required');
  }
  const purchaseOrderId = typeof payload.purchaseOrderId === 'string' ? payload.purchaseOrderId.trim() : '';
  if (!isUuid(purchaseOrderId)) return failure('INVALID_PURCHASE_ORDER_ID', 'Purchase order ID must be a valid UUID');
  const receiptDate = normalizeDate(payload.receiptDate, true);
  if (!receiptDate) return failure('INVALID_RECEIPT_DATE', 'receiptDate must be a valid YYYY-MM-DD date');
  const supplierDeliveryReference = text(payload.supplierDeliveryReference, 256);
  if (payload.supplierDeliveryReference && supplierDeliveryReference === null) {
    return failure('INVALID_SUPPLIER_DELIVERY_REFERENCE', 'Supplier delivery reference must not exceed 256 characters');
  }
  const note = text(payload.note, 4000);
  if (payload.note && note === null) return failure('INVALID_NOTE', 'Note must not exceed 4000 characters');
  if (!Array.isArray(payload.lines) || payload.lines.length < 1 || payload.lines.length > 500) {
    return failure('INVALID_LINES', 'Goods receipt must contain between 1 and 500 lines');
  }

  const orderResult = await loadPurchaseOrderForReceipt(client, {
    requestContext,
    purchaseOrderId,
    forUpdate: true,
  });
  if (!orderResult.ok) return orderResult;
  if (!RECEIPT_PURCHASE_ORDER_STATUSES.has(orderResult.raw.status)) {
    return failure('INVALID_PURCHASE_ORDER_STATUS', 'Only approved or partially received purchase orders can receive goods');
  }
  if (currentReceipt && currentReceipt.raw.purchase_order_id !== purchaseOrderId) {
    return failure('PURCHASE_ORDER_MISMATCH', 'Goods receipt cannot be moved to another purchase order');
  }

  const linesResult = normalizeOrderAndLines(orderResult, payload.lines, requestContext);
  if (!linesResult.ok) return linesResult;
  if (linesResult.lines.some((line) => !warehouseAllowed(requestContext, line.warehouseId))) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Warehouse is outside the authorized scope');
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      purchaseOrderId,
      receiptDate,
      supplierDeliveryReference,
      note,
      warehouseId: orderResult.raw.warehouse_id,
      lines: linesResult.lines,
      orderResult,
    }),
  });
}

export async function listGoodsReceipts(client, input) {
  const validation = normalizeListInput(input);
  if (!validation.ok) return validation;
  const receipts = await repository.listGoodsReceipts(client, {
    installationId: input.requestContext.installationId,
    warehouseIds: warehouseScopeIds(input.requestContext),
    purchaseOrderId: input.purchaseOrderId || null,
    status: input.status || null,
    search: validation.search,
    limit: input.limit,
    offset: input.offset,
  });
  return Object.freeze({ ok: true, goodsReceipts: Object.freeze(receipts.map(mapReceipt)) });
}

export async function getGoodsReceipt(client, { requestContext, id, forUpdate = false }) {
  if (!isUuid(id)) return failure('GOODS_RECEIPT_NOT_FOUND', 'Goods receipt was not found');
  const receipt = await repository.getGoodsReceiptById(client, {
    installationId: requestContext.installationId,
    id: id.trim(),
    warehouseIds: warehouseScopeIds(requestContext),
    forUpdate,
  });
  return receipt
    ? Object.freeze({ ok: true, goodsReceipt: mapReceipt(receipt), raw: receipt })
    : failure('GOODS_RECEIPT_NOT_FOUND', 'Goods receipt was not found');
}

export async function createGoodsReceipt(client, { requestContext, payload }) {
  const validation = await validateDraftMutation(client, { requestContext, payload });
  if (!validation.ok) return validation;
  const created = await repository.insertGoodsReceiptDraft(client, {
    installationId: requestContext.installationId,
    purchaseOrderId: validation.value.purchaseOrderId,
    warehouseId: validation.value.warehouseId,
    receiptDate: validation.value.receiptDate,
    supplierDeliveryReference: validation.value.supplierDeliveryReference,
    note: validation.value.note,
    actorId: requestContext.actorId,
    lines: validation.value.lines,
  });
  return Object.freeze({ ok: true, goodsReceipt: mapReceipt(created) });
}

export async function updateGoodsReceipt(client, { requestContext, id, payload }) {
  const current = await getGoodsReceipt(client, { requestContext, id, forUpdate: true });
  if (!current.ok) return current;
  if (current.raw.status !== 'draft') return failure('GOODS_RECEIPT_LOCKED', 'Only draft goods receipts can be edited');
  const expectedRevision = normalizeRevision(payload?.expectedRevision);
  if (!expectedRevision) return failure('EXPECTED_REVISION_REQUIRED', 'expectedRevision is required');
  if (String(current.raw.revision) !== expectedRevision) return failure('CONFLICT', 'Goods receipt was changed by another request', true);
  const validation = await validateDraftMutation(client, { requestContext, payload, currentReceipt: current });
  if (!validation.ok) return validation;
  const updated = await repository.updateGoodsReceiptDraft(client, {
    installationId: requestContext.installationId,
    id: current.raw.id,
    purchaseOrderId: validation.value.purchaseOrderId,
    warehouseId: validation.value.warehouseId,
    receiptDate: validation.value.receiptDate,
    supplierDeliveryReference: validation.value.supplierDeliveryReference,
    note: validation.value.note,
    actorId: requestContext.actorId,
    expectedRevision,
    lines: validation.value.lines,
  });
  if (!updated) return failure('CONFLICT', 'Goods receipt was changed by another request', true);
  return Object.freeze({ ok: true, goodsReceipt: mapReceipt(updated), beforeData: current.goodsReceipt });
}

async function refreshDraftLinesForPosting(client, { requestContext, receipt, order }) {
  const rebuilt = buildReceiptLines(order.raw, receipt.raw.lines, requestContext);
  if (!rebuilt.ok) return rebuilt;
  const refreshed = await repository.replaceGoodsReceiptLines(client, {
    installationId: requestContext.installationId,
    goodsReceiptId: receipt.raw.id,
    lines: rebuilt.value,
    actorId: requestContext.actorId,
  });
  return Object.freeze({ ok: true, lines: Object.freeze(refreshed.map(mapLine)) });
}

export async function postGoodsReceipt(client, { requestContext, id, payload, idempotencyKey }) {
  const current = await getGoodsReceipt(client, { requestContext, id, forUpdate: true });
  if (!current.ok) return current;
  if (current.raw.status !== 'draft') return failure('GOODS_RECEIPT_LOCKED', 'Only draft goods receipts can be posted');
  const expectedRevision = normalizeRevision(payload?.expectedRevision);
  if (!expectedRevision) return failure('EXPECTED_REVISION_REQUIRED', 'expectedRevision is required');
  if (String(current.raw.revision) !== expectedRevision) return failure('CONFLICT', 'Goods receipt was changed by another request', true);

  const orderResult = await loadPurchaseOrderForReceipt(client, {
    requestContext,
    purchaseOrderId: current.raw.purchase_order_id,
    forUpdate: true,
  });
  if (!orderResult.ok) return orderResult;
  if (!RECEIPT_PURCHASE_ORDER_STATUSES.has(orderResult.raw.status)) {
    return failure('INVALID_PURCHASE_ORDER_STATUS', 'Only approved or partially received purchase orders can receive goods');
  }

  const refreshed = await refreshDraftLinesForPosting(client, {
    requestContext,
    receipt: current,
    order: orderResult,
  });
  if (!refreshed.ok) return refreshed;

  const receiptDocumentDate = dateOnly(current.raw.receipt_date);
  if (!receiptDocumentDate) return failure('INVALID_RECEIPT_DATE', 'Stored receipt date is invalid');

  const series = await ensureGoodsReceiptSeries(client, {
    installationId: requestContext.installationId,
    actorId: requestContext.actorId,
  });
  if (!series) return failure('DOCUMENT_NUMBER_SERIES_UNAVAILABLE', 'Goods receipt number series is unavailable', true);

  const allocation = await allocateDocumentNumber(client, {
    installationId: requestContext.installationId,
    seriesId: series.id,
    idempotencyKey,
    payload: {
      documentDate: receiptDocumentDate,
      metadata: {
        goodsReceiptId: current.raw.id,
        purchaseOrderId: current.raw.purchase_order_id,
      },
    },
    actorId: requestContext.actorId,
    requestId: requestContext.requestId,
    sourceApp: requestContext.sourceApp,
  });
  if (!allocation.ok) return allocation;

  const movementLines = refreshed.lines
  .filter((line) => (decimalToScaled(line.acceptedQuantity, { allowZero: true }) ?? 0n) > 0n)
  .map((line) => ({
    warehouseId: line.warehouseId,
    locationId: line.locationId,
    sourceVariantId: line.variantId,
    direction: 'IN',
    sourceQuantity: line.acceptedQuantity,
    sourceLineReference: `PO-${line.purchaseOrderLineNumber}`,
    lotId: line.lotId,
    lotCode: line.lotCode,
    manufacturedDate: line.manufacturedDate,
    expiryDate: line.expiryDate,
    supplierLotReference: line.supplierLotReference,
    metadata: {
      goodsReceiptId: current.raw.id,
      goodsReceiptLineId: line.id,
      purchaseOrderLineId: line.purchaseOrderLineId,
    },
  }));

let inventoryMovementId = null;
if (movementLines.length > 0) {
  const movementResult = await postInventoryMovement(client, {
    requestContext,
    idempotencyKey,
    payload: {
      movementType: 'PURCHASE_RECEIPT',
      sourceDomain: 'PURCHASING',
      sourceDocumentType: 'PURCHASE_RECEIPT',
      sourceDocumentId: current.raw.id,
      sourceDocumentNumber: allocation.allocation.document_number,
      documentDate: receiptDocumentDate,
      reasonCode: 'PURCHASE_RECEIPT',
      reasonNote: current.raw.supplier_delivery_reference ?? 'Purchase receipt posted',
      metadata: {
        goodsReceiptId: current.raw.id,
        purchaseOrderId: current.raw.purchase_order_id,
      },
      lines: movementLines,
    },
  });
  if (!movementResult.ok) return movementResult;
  inventoryMovementId = movementResult.movement.id;
}

  const posted = await repository.postGoodsReceipt(client, {
    installationId: requestContext.installationId,
    id: current.raw.id,
    documentNumber: allocation.allocation.document_number,
    documentNumberAllocationId: allocation.allocation.id,
    inventoryMovementId,
    actorId: requestContext.actorId,
    expectedRevision,
  });
  if (!posted) return failure('CONFLICT', 'Goods receipt was changed by another request', true);

  await purchaseOrderRepository.updatePurchaseOrderReceiptStatus(client, {
    installationId: requestContext.installationId,
    purchaseOrderId: current.raw.purchase_order_id,
    actorId: requestContext.actorId,
  });

  return Object.freeze({ ok: true, goodsReceipt: mapReceipt(posted), beforeData: current.goodsReceipt });
}

export async function reverseGoodsReceipt(client, {
  requestContext,
  id,
  payload,
  idempotencyKey,
}) {
  const current = await getGoodsReceipt(client, { requestContext, id, forUpdate: true });
  if (!current.ok) return current;
  if (current.raw.status !== 'posted') return failure('GOODS_RECEIPT_LOCKED', 'Only posted goods receipts can be reversed');
  const expectedRevision = normalizeRevision(payload?.expectedRevision);
  if (!expectedRevision) return failure('EXPECTED_REVISION_REQUIRED', 'expectedRevision is required');
  if (String(current.raw.revision) !== expectedRevision) return failure('CONFLICT', 'Goods receipt was changed by another request', true);

  const documentDate = normalizeDate(payload?.documentDate, true);
  if (!documentDate) return failure('INVALID_DOCUMENT_DATE', 'documentDate must be a valid YYYY-MM-DD date');
  const reasonNote = text(payload?.reasonNote ?? payload?.reversalReason, 2000);
  if (!reasonNote) return failure('REVERSAL_REASON_REQUIRED', 'reversalReason or reasonNote is required');
  const reasonCode = text(payload?.reasonCode, 64)?.toUpperCase() ?? 'PURCHASE_RECEIPT_REVERSAL';

  if (await supplierReturnRepository.hasBlockingSupplierReturnsForGoodsReceipt(client, {
    installationId: requestContext.installationId,
    goodsReceiptId: current.raw.id,
  })) {
    return failure('GOODS_RECEIPT_SUPPLIER_RETURN_BLOCKED', 'Goods receipt has an active supplier return and cannot be reversed');
  }

  let inventoryReversalMovementId = null;
if (current.raw.inventory_movement_id) {
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
  inventoryReversalMovementId = reversalResult.movement.id;
}

  const reversed = await repository.reverseGoodsReceipt(client, {
    installationId: requestContext.installationId,
    id: current.raw.id,
    reversalReason: reasonNote,
    inventoryReversalMovementId,
    actorId: requestContext.actorId,
    expectedRevision,
  });
  if (!reversed) return failure('CONFLICT', 'Goods receipt was changed by another request', true);

  await purchaseOrderRepository.updatePurchaseOrderReceiptStatus(client, {
    installationId: requestContext.installationId,
    purchaseOrderId: current.raw.purchase_order_id,
    actorId: requestContext.actorId,
  });

  return Object.freeze({ ok: true, goodsReceipt: mapReceipt(reversed), beforeData: current.goodsReceipt });
}

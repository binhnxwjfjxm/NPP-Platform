import * as repository from '../db/repositories/purchase-order.js';
import * as documentNumberRepository from '../db/repositories/document-numbering.js';
import { allocateDocumentNumber } from './document-numbering.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DECIMAL_PATTERN = /^(0|[1-9]\d{0,13})(?:\.(\d{1,6}))?$/;
const INTEGER_PATTERN = /^[1-9]\d{0,18}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const STATUSES = new Set(['draft', 'pending_approval', 'approved', 'partially_received', 'fully_received', 'closed', 'cancelled']);
const SCALE = 1_000_000n;
const PURCHASE_ORDER_SERIES_CODE = 'PURCHASE_ORDER';

function failure(code, message, retryable = false, details = {}) {
  return Object.freeze({ ok: false, code, message, retryable, details });
}

function normalizeText(value, maxLength, required = false) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (required && !text) return null;
  return text.length <= maxLength ? (text || null) : null;
}

function isUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value.trim());
}

function normalizeDate(value, required = false) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return required ? null : null;
  const match = DATE_PATTERN.exec(text);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.getUTCFullYear() !== Number(match[1])
    || date.getUTCMonth() !== Number(match[2]) - 1
    || date.getUTCDate() !== Number(match[3])) return null;
  return text;
}

function dateOnly(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const leadingDate = value.slice(0, 10);
    if (normalizeDate(leadingDate)) return leadingDate;
  }
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function decimalToScaled(value, { allowZero }) {
  const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  const match = DECIMAL_PATTERN.exec(text);
  if (!match) return null;
  const fraction = (match[2] ?? '').padEnd(6, '0');
  const scaled = BigInt(match[1]) * SCALE + BigInt(fraction || '0');
  if (!allowZero && scaled === 0n) return null;
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
  const text = String(value ?? '').trim();
  return INTEGER_PATTERN.test(text) ? text : null;
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
    variantId: line.variant_id,
    skuCode: line.sku_snapshot,
    itemName: line.item_name_snapshot,
    unitId: line.unit_id,
    unitCode: line.unit_code_snapshot,
    conversionToBase: String(line.conversion_to_base),
    quantity: String(line.ordered_quantity),
    baseQuantity: String(line.base_quantity),
    unitPrice: String(line.unit_price),
    discountAmount: String(line.discount_amount),
    taxAmount: String(line.tax_amount),
    lineTotal: String(line.line_total),
    note: line.note ?? null,
  });
}

function mapOrder(order) {
  return Object.freeze({
    id: order.id,
    number: order.document_number ?? null,
    status: order.status,
    supplierId: order.supplier_id,
    supplierCode: order.supplier_code,
    supplierName: order.supplier_name,
    warehouseId: order.warehouse_id,
    warehouseCode: order.warehouse_code,
    warehouseName: order.warehouse_name,
    placedAt: dateOnly(order.order_date),
    expectedAt: dateOnly(order.expected_date),
    supplierReference: order.supplier_reference ?? null,
    currency: order.currency_code,
    note: order.note ?? null,
    subtotal: String(order.subtotal),
    discountTotal: String(order.discount_total),
    taxTotal: String(order.tax_total),
    total: String(order.total),
    revision: String(order.revision),
    lineCount: Number(order.line_count ?? order.lines?.length ?? 0),
    submittedAt: order.submitted_at ?? null,
    submittedBy: order.submitted_by ?? null,
    approvedAt: order.approved_at ?? null,
    approvedBy: order.approved_by ?? null,
    cancelledAt: order.cancelled_at ?? null,
    cancelledBy: order.cancelled_by ?? null,
    cancellationReason: order.cancellation_reason ?? null,
    createdAt: order.created_at,
    updatedAt: order.updated_at,
    createdBy: order.created_by,
    updatedBy: order.updated_by,
    lines: Array.isArray(order.lines) ? Object.freeze(order.lines.map(mapLine)) : undefined,
  });
}

function validateListInput(input) {
  const search = normalizeText(input.search, 256, false);
  if (input.search && search === null) return failure('INVALID_SEARCH', 'Search must not exceed 256 characters');
  if (input.status && !STATUSES.has(input.status)) return failure('INVALID_STATUS', 'Purchase order status is invalid');
  if (input.supplierId && !isUuid(input.supplierId)) return failure('INVALID_SUPPLIER_ID', 'Supplier ID is invalid');
  if (input.warehouseId && !isUuid(input.warehouseId)) return failure('INVALID_WAREHOUSE_ID', 'Warehouse ID is invalid');
  if (input.warehouseId && !warehouseAllowed(input.requestContext, input.warehouseId)) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Warehouse is outside the authorized scope');
  }
  return { ok: true, search };
}

async function validateAndNormalizeDraft(client, { requestContext, payload }) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return failure('INVALID_INPUT', 'Purchase order data is required');
  }
  const supplierId = typeof payload.supplierId === 'string' ? payload.supplierId.trim() : '';
  const warehouseId = typeof payload.warehouseId === 'string' ? payload.warehouseId.trim() : '';
  if (!isUuid(supplierId)) return failure('INVALID_SUPPLIER_ID', 'Supplier ID must be a valid UUID');
  if (!isUuid(warehouseId)) return failure('INVALID_WAREHOUSE_ID', 'Warehouse ID must be a valid UUID');
  if (!warehouseAllowed(requestContext, warehouseId)) return failure('WAREHOUSE_SCOPE_DENIED', 'Warehouse is outside the authorized scope');

  const orderDate = normalizeDate(payload.orderDate, true);
  if (!orderDate) return failure('INVALID_ORDER_DATE', 'orderDate must be a valid YYYY-MM-DD date');
  const expectedDate = payload.expectedDate ? normalizeDate(payload.expectedDate) : null;
  if (payload.expectedDate && !expectedDate) return failure('INVALID_EXPECTED_DATE', 'expectedDate must be a valid YYYY-MM-DD date');
  if (expectedDate && expectedDate < orderDate) return failure('INVALID_EXPECTED_DATE', 'expectedDate cannot be before orderDate');

  const supplierReference = normalizeText(payload.supplierReference, 256, false);
  if (payload.supplierReference && supplierReference === null) return failure('INVALID_SUPPLIER_REFERENCE', 'Supplier reference must not exceed 256 characters');
  const note = normalizeText(payload.note, 4000, false);
  if (payload.note && note === null) return failure('INVALID_NOTE', 'Note must not exceed 4000 characters');
  const currencyCode = String(payload.currencyCode ?? 'VND').trim().toUpperCase();
  if (!CURRENCY_PATTERN.test(currencyCode)) return failure('INVALID_CURRENCY', 'currencyCode must contain three uppercase letters');

  if (!Array.isArray(payload.lines) || payload.lines.length < 1 || payload.lines.length > 500) {
    return failure('INVALID_LINES', 'Purchase order must contain between 1 and 500 lines');
  }

  const variantIds = [];
  const seen = new Set();
  for (const line of payload.lines) {
    const variantId = typeof line?.variantId === 'string' ? line.variantId.trim() : '';
    if (!isUuid(variantId)) return failure('INVALID_VARIANT_ID', 'Every line must reference a valid variant ID');
    if (seen.has(variantId)) return failure('DUPLICATE_VARIANT', 'A SKU can appear only once on a purchase order');
    seen.add(variantId);
    variantIds.push(variantId);
  }

  const supplier = await repository.getActiveSupplier(client, {
    installationId: requestContext.installationId,
    id: supplierId,
  });
  const warehouse = await repository.getActiveWarehouse(client, {
    installationId: requestContext.installationId,
    id: warehouseId,
  });
  const variants = await repository.getPurchasableVariants(client, {
    installationId: requestContext.installationId,
    ids: variantIds,
  });
  if (!supplier) return failure('SUPPLIER_NOT_FOUND', 'Active supplier was not found');
  if (!warehouse) return failure('WAREHOUSE_NOT_FOUND', 'Active warehouse was not found');
  if (variants.length !== variantIds.length) return failure('VARIANT_NOT_PURCHASABLE', 'One or more SKUs are inactive, missing a unit, or not purchasable');
  const variantMap = new Map(variants.map((variant) => [variant.id, variant]));

  let subtotal = 0n;
  let discountTotal = 0n;
  let taxTotal = 0n;
  const lines = [];
  for (let index = 0; index < payload.lines.length; index += 1) {
    const input = payload.lines[index];
    const variant = variantMap.get(input.variantId.trim());
    const quantity = decimalToScaled(input.quantity, { allowZero: false });
    const unitPrice = decimalToScaled(input.unitPrice, { allowZero: true });
    const discountAmount = decimalToScaled(input.discountAmount ?? '0', { allowZero: true });
    const taxAmount = decimalToScaled(input.taxAmount ?? '0', { allowZero: true });
    if (quantity === null) return failure('INVALID_QUANTITY', `Line ${index + 1} quantity must be a positive decimal with at most six decimal places`);
    if (unitPrice === null) return failure('INVALID_UNIT_PRICE', `Line ${index + 1} unit price is invalid`);
    if (discountAmount === null) return failure('INVALID_DISCOUNT', `Line ${index + 1} discount amount is invalid`);
    if (taxAmount === null) return failure('INVALID_TAX', `Line ${index + 1} tax amount is invalid`);

    const conversion = decimalToScaled(String(variant.conversion_to_base), { allowZero: false });
    if (conversion === null) return failure('INVALID_CONVERSION', `Line ${index + 1} conversion snapshot is invalid`);
    const gross = multiplyScaled(quantity, unitPrice);
    const lineTotal = gross - discountAmount + taxAmount;
    if (lineTotal < 0n) return failure('INVALID_LINE_TOTAL', `Line ${index + 1} total cannot be negative`);
    const lineNote = normalizeText(input.note, 2000, false);
    if (input.note && lineNote === null) return failure('INVALID_LINE_NOTE', `Line ${index + 1} note must not exceed 2000 characters`);

    subtotal += gross;
    discountTotal += discountAmount;
    taxTotal += taxAmount;
    lines.push(Object.freeze({
      lineNumber: index + 1,
      variantId: variant.id,
      skuSnapshot: variant.sku,
      itemNameSnapshot: variant.name,
      unitId: variant.unit_id,
      unitCodeSnapshot: variant.unit_code,
      conversionToBase: scaledToDecimal(conversion),
      orderedQuantity: scaledToDecimal(quantity),
      baseQuantity: scaledToDecimal(multiplyScaled(quantity, conversion)),
      unitPrice: scaledToDecimal(unitPrice),
      discountAmount: scaledToDecimal(discountAmount),
      taxAmount: scaledToDecimal(taxAmount),
      lineTotal: scaledToDecimal(lineTotal),
      note: lineNote,
    }));
  }

  return Object.freeze({
    ok: true,
    value: Object.freeze({
      supplierId,
      warehouseId,
      orderDate,
      expectedDate,
      supplierReference,
      currencyCode,
      note,
      subtotal: scaledToDecimal(subtotal),
      discountTotal: scaledToDecimal(discountTotal),
      taxTotal: scaledToDecimal(taxTotal),
      total: scaledToDecimal(subtotal - discountTotal + taxTotal),
      lines: Object.freeze(lines),
    }),
  });
}

async function ensurePurchaseOrderSeries(client, { installationId, actorId }) {
  let series = await documentNumberRepository.getDocumentNumberSeriesByCode(client, {
    installationId,
    code: PURCHASE_ORDER_SERIES_CODE,
  });
  if (series) return series;
  series = await documentNumberRepository.insertDocumentNumberSeries(client, {
    installationId,
    code: PURCHASE_ORDER_SERIES_CODE,
    documentType: 'PURCHASE_ORDER',
    name: 'Đơn đặt hàng',
    prefix: 'PO-',
    numberTemplate: '{PREFIX}{YYYY}{MM}-{SEQ}',
    resetPolicy: 'MONTHLY',
    sequenceWidth: 6,
    startCounter: '1',
    timezoneName: 'Asia/Ho_Chi_Minh',
    description: 'Series mặc định cho đơn đặt hàng nhà cung cấp.',
    isActive: true,
    createdBy: actorId,
  });
  if (series) return series;
  return documentNumberRepository.getDocumentNumberSeriesByCode(client, {
    installationId,
    code: PURCHASE_ORDER_SERIES_CODE,
  });
}

export async function listPurchaseOrders(client, input) {
  const validation = validateListInput(input);
  if (!validation.ok) return validation;
  const purchaseOrders = await repository.listPurchaseOrders(client, {
    installationId: input.requestContext.installationId,
    warehouseIds: warehouseScopeIds(input.requestContext),
    status: input.status || null,
    supplierId: input.supplierId || null,
    warehouseId: input.warehouseId || null,
    search: validation.search,
    limit: input.limit,
    offset: input.offset,
  });
  return Object.freeze({ ok: true, purchaseOrders: Object.freeze(purchaseOrders.map(mapOrder)) });
}

export async function getPurchaseOrder(client, { requestContext, id, forUpdate = false }) {
  if (!isUuid(id)) return failure('PURCHASE_ORDER_NOT_FOUND', 'Purchase order was not found');
  const purchaseOrder = await repository.getPurchaseOrderById(client, {
    installationId: requestContext.installationId,
    id: id.trim(),
    warehouseIds: warehouseScopeIds(requestContext),
    forUpdate,
  });
  return purchaseOrder
    ? Object.freeze({ ok: true, purchaseOrder: mapOrder(purchaseOrder), raw: purchaseOrder })
    : failure('PURCHASE_ORDER_NOT_FOUND', 'Purchase order was not found');
}

export async function createPurchaseOrder(client, { requestContext, payload }) {
  const validation = await validateAndNormalizeDraft(client, { requestContext, payload });
  if (!validation.ok) return validation;
  const purchaseOrder = await repository.insertPurchaseOrder(client, {
    installationId: requestContext.installationId,
    actorId: requestContext.actorId,
    ...validation.value,
  });
  return Object.freeze({ ok: true, purchaseOrder: mapOrder(purchaseOrder) });
}

export async function updatePurchaseOrder(client, { requestContext, id, payload }) {
  const current = await getPurchaseOrder(client, { requestContext, id, forUpdate: true });
  if (!current.ok) return current;
  if (current.raw.status !== 'draft') return failure('PURCHASE_ORDER_LOCKED', 'Only draft purchase orders can be edited');
  const expectedRevision = normalizeRevision(payload?.expectedRevision);
  if (!expectedRevision) return failure('EXPECTED_REVISION_REQUIRED', 'expectedRevision is required');
  if (String(current.raw.revision) !== expectedRevision) return failure('CONFLICT', 'Purchase order was changed by another request', true);
  const validation = await validateAndNormalizeDraft(client, { requestContext, payload });
  if (!validation.ok) return validation;
  const purchaseOrder = await repository.updatePurchaseOrderDraft(client, {
    id: current.raw.id,
    installationId: requestContext.installationId,
    actorId: requestContext.actorId,
    expectedRevision,
    ...validation.value,
  });
  if (!purchaseOrder) return failure('CONFLICT', 'Purchase order was changed by another request', true);
  return Object.freeze({ ok: true, purchaseOrder: mapOrder(purchaseOrder), beforeData: current.purchaseOrder });
}

export async function submitPurchaseOrder(client, { requestContext, id, payload }) {
  const current = await getPurchaseOrder(client, { requestContext, id, forUpdate: true });
  if (!current.ok) return current;
  if (current.raw.status !== 'draft') return failure('INVALID_STATUS_TRANSITION', 'Only draft purchase orders can be submitted');
  const expectedRevision = normalizeRevision(payload?.expectedRevision);
  if (!expectedRevision) return failure('EXPECTED_REVISION_REQUIRED', 'expectedRevision is required');
  if (String(current.raw.revision) !== expectedRevision) return failure('CONFLICT', 'Purchase order was changed by another request', true);
  if (!Array.isArray(current.raw.lines) || current.raw.lines.length === 0) return failure('INVALID_LINES', 'Purchase order must contain at least one line');
  const purchaseOrder = await repository.submitPurchaseOrder(client, {
    installationId: requestContext.installationId,
    id: current.raw.id,
    expectedRevision,
    actorId: requestContext.actorId,
  });
  if (!purchaseOrder) return failure('CONFLICT', 'Purchase order was changed by another request', true);
  return Object.freeze({ ok: true, purchaseOrder: mapOrder(purchaseOrder), beforeData: current.purchaseOrder });
}

export async function approvePurchaseOrder(client, {
  requestContext,
  id,
  payload,
  idempotencyKey,
}) {
  const current = await getPurchaseOrder(client, { requestContext, id, forUpdate: true });
  if (!current.ok) return current;
  if (current.raw.status !== 'pending_approval') return failure('INVALID_STATUS_TRANSITION', 'Only pending purchase orders can be approved');
  const expectedRevision = normalizeRevision(payload?.expectedRevision);
  if (!expectedRevision) return failure('EXPECTED_REVISION_REQUIRED', 'expectedRevision is required');
  if (String(current.raw.revision) !== expectedRevision) return failure('CONFLICT', 'Purchase order was changed by another request', true);

  const series = await ensurePurchaseOrderSeries(client, {
    installationId: requestContext.installationId,
    actorId: requestContext.actorId,
  });
  if (!series) return failure('DOCUMENT_NUMBER_SERIES_UNAVAILABLE', 'Purchase order number series is unavailable', true);
  const documentDate = dateOnly(current.raw.order_date);
  if (!documentDate) return failure('INVALID_DOCUMENT_DATE', 'Purchase order date is invalid');
  const allocation = await allocateDocumentNumber(client, {
    installationId: requestContext.installationId,
    seriesId: series.id,
    idempotencyKey,
    payload: {
      documentDate,
      metadata: { purchaseOrderId: current.raw.id },
    },
    actorId: requestContext.actorId,
    requestId: requestContext.requestId,
    sourceApp: requestContext.sourceApp,
  });
  if (!allocation.ok) return allocation;

  const purchaseOrder = await repository.approvePurchaseOrder(client, {
    installationId: requestContext.installationId,
    id: current.raw.id,
    expectedRevision,
    actorId: requestContext.actorId,
    documentNumber: allocation.allocation.document_number,
    documentNumberAllocationId: allocation.allocation.id,
  });
  if (!purchaseOrder) return failure('CONFLICT', 'Purchase order was changed by another request', true);
  return Object.freeze({ ok: true, purchaseOrder: mapOrder(purchaseOrder), beforeData: current.purchaseOrder });
}

export async function cancelPurchaseOrder(client, { requestContext, id, payload }) {
  const current = await getPurchaseOrder(client, { requestContext, id, forUpdate: true });
  if (!current.ok) return current;
  if (!['draft', 'pending_approval', 'approved'].includes(current.raw.status)) {
    return failure('INVALID_STATUS_TRANSITION', 'Purchase order cannot be cancelled from its current status');
  }
  const expectedRevision = normalizeRevision(payload?.expectedRevision);
  if (!expectedRevision) return failure('EXPECTED_REVISION_REQUIRED', 'expectedRevision is required');
  if (String(current.raw.revision) !== expectedRevision) return failure('CONFLICT', 'Purchase order was changed by another request', true);
  const reason = normalizeText(payload?.reason, 1000, true);
  if (!reason) return failure('CANCELLATION_REASON_REQUIRED', 'Cancellation reason is required and must not exceed 1000 characters');
  const purchaseOrder = await repository.cancelPurchaseOrder(client, {
    installationId: requestContext.installationId,
    id: current.raw.id,
    expectedRevision,
    actorId: requestContext.actorId,
    reason,
  });
  if (!purchaseOrder) return failure('CONFLICT', 'Purchase order was changed by another request', true);
  return Object.freeze({ ok: true, purchaseOrder: mapOrder(purchaseOrder), beforeData: current.purchaseOrder });
}

export const purchaseOrderInternals = Object.freeze({
  decimalToScaled,
  scaledToDecimal,
  multiplyScaled,
  dateOnly,
  mapOrder,
});

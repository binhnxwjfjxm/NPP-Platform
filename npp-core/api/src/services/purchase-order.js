import * as repository from '../db/repositories/purchase-order.js';
import * as documentNumberRepository from '../db/repositories/document-numbering.js';
import { allocateDocumentNumber } from './document-numbering.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DECIMAL_PATTERN = /^(0|[1-9]\d{0,13})(?:\.(\d{1,6}))?$/;
const INTEGER_PATTERN = /^[1-9]\d{0,18}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const STATUSES = new Set(['draft', 'pending_approval', 'approved', 'partially_received', 'fully_received', 'closed', 'cancelled']);
const DISCOUNT_MODES = new Set(['TOTAL_AMOUNT', 'PER_UNIT', 'PERCENT']);
const SCALE = 1_000_000n;
const ONE_HUNDRED_PERCENT = 100n * SCALE;
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
  if (Number.isNaN(parsed.getTime())) return null;
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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

function fixedScaleQuantity(value) {
  const text = String(value ?? '').trim();
  const match = DECIMAL_PATTERN.exec(text);
  if (!match) return text;
  return `${match[1]}.${(match[2] ?? '').padEnd(6, '0')}`;
}

function multiplyScaled(left, right) {
  return (left * right + SCALE / 2n) / SCALE;
}

function percentOfScaled(base, percent) {
  return (base * percent + 50n * SCALE) / (100n * SCALE);
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
    receivedQuantity: line.received_quantity === undefined || line.received_quantity === null ? undefined : fixedScaleQuantity(line.received_quantity),
    acceptedQuantity: line.accepted_quantity === undefined || line.accepted_quantity === null ? undefined : fixedScaleQuantity(line.accepted_quantity),
    rejectedQuantity: line.rejected_quantity === undefined || line.rejected_quantity === null ? undefined : fixedScaleQuantity(line.rejected_quantity),
    shortageClosedQuantity: line.shortage_closed_quantity === undefined || line.shortage_closed_quantity === null ? undefined : fixedScaleQuantity(line.shortage_closed_quantity),
    remainingQuantity: line.remaining_quantity === undefined || line.remaining_quantity === null ? undefined : fixedScaleQuantity(line.remaining_quantity),
    unitPrice: String(line.unit_price),
    discountMode: line.discount_mode ?? 'TOTAL_AMOUNT',
    discountValue: String(line.discount_value ?? line.discount_amount ?? 0),
    discountAmount: String(line.discount_amount),
    taxRate: line.tax_rate === undefined || line.tax_rate === null ? null : String(line.tax_rate),
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
    receiptCount: Number(order.receipt_count ?? 0),
    receivedQuantityTotal: order.received_quantity_total === undefined || order.received_quantity_total === null
      ? null
      : fixedScaleQuantity(order.received_quantity_total),
    acceptedQuantityTotal: order.accepted_quantity_total === undefined || order.accepted_quantity_total === null
      ? null
      : fixedScaleQuantity(order.accepted_quantity_total),
    rejectedQuantityTotal: order.rejected_quantity_total === undefined || order.rejected_quantity_total === null
      ? null
      : fixedScaleQuantity(order.rejected_quantity_total),
    shortageClosedQuantityTotal: order.shortage_closed_quantity_total === undefined || order.shortage_closed_quantity_total === null
      ? null
      : fixedScaleQuantity(order.shortage_closed_quantity_total),
    remainingQuantityTotal: order.remaining_quantity_total === undefined || order.remaining_quantity_total === null
      ? null
      : fixedScaleQuantity(order.remaining_quantity_total),
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

export function evaluatePurchaseOrderSkuEligibility(row) {
  if (!row) return Object.freeze({ selectable: false, code: 'SKU_NOT_FOUND', message: 'Không tìm thấy SKU trong danh mục.' });
  if (row.product_is_active !== true) return Object.freeze({ selectable: false, code: 'PRODUCT_INACTIVE', message: 'Sản phẩm đang ngưng hoạt động.' });
  if (row.product_is_orderable !== true) return Object.freeze({ selectable: false, code: 'PRODUCT_NOT_ORDERABLE', message: 'Sản phẩm chưa được bật cho phép đặt hàng.' });
  if (row.variant_is_active !== true) return Object.freeze({ selectable: false, code: 'SKU_INACTIVE', message: 'SKU đang ngưng hoạt động.' });
  if (row.is_purchasable !== true) return Object.freeze({ selectable: false, code: 'SKU_NOT_PURCHASABLE', message: 'SKU chưa được bật cho nghiệp vụ mua hàng.' });
  if (!row.unit_id) return Object.freeze({ selectable: false, code: 'SKU_UNIT_MISSING', message: 'SKU chưa được gắn đơn vị mua hàng và hệ số quy đổi.' });
  if (row.unit_is_active !== true) return Object.freeze({ selectable: false, code: 'SKU_UNIT_INACTIVE', message: 'Đơn vị của SKU đang ngưng hoạt động.' });
  const conversion = decimalToScaled(String(row.conversion_to_base ?? ''), { allowZero: false });
  if (conversion === null) return Object.freeze({ selectable: false, code: 'SKU_CONVERSION_INVALID', message: 'SKU chưa có hệ số quy đổi đơn vị hợp lệ.' });
  return Object.freeze({ selectable: true, code: 'ELIGIBLE', message: 'Có thể chọn để mua hàng.' });
}

function mapSkuOption(row) {
  return Object.freeze({
    id: row.id,
    productId: row.product_id,
    productCode: row.product_code,
    productName: row.product_name,
    sku: row.sku,
    variantName: row.name,
    barcode: row.barcode ?? null,
    unitId: row.unit_id ?? null,
    unitCode: row.unit_code ?? null,
    unitName: row.unit_name ?? null,
    conversionToBase: row.conversion_to_base === null || row.conversion_to_base === undefined ? null : String(row.conversion_to_base),
    allowsFractional: row.allows_fractional === undefined ? null : row.allows_fractional,
    eligibility: evaluatePurchaseOrderSkuEligibility(row),
  });
}

export async function searchPurchaseOrderSkuOptions(client, input) {
  const search = normalizeText(input.search, 256, false) ?? '';
  const rows = await repository.searchPurchaseOrderSkuOptions(client, {
    installationId: input.requestContext.installationId,
    search,
    limit: Math.max(1, Math.min(50, Number(input.limit) || 20)),
    offset: Math.max(0, Number(input.offset) || 0),
  });
  return Object.freeze({ ok: true, skuOptions: Object.freeze(rows.map(mapSkuOption)) });
}

export async function resolvePurchaseOrderSkuIdentifiers(client, input) {
  if (!Array.isArray(input.identifiers) || input.identifiers.length < 1 || input.identifiers.length > 500) {
    return failure('INVALID_SKU_IDENTIFIERS', 'identifiers must contain between 1 and 500 SKU or barcode values');
  }
  const identifiers = input.identifiers.map((value) => String(value ?? '').trim().toUpperCase());
  if (identifiers.some((value) => !value || value.length > 128)) {
    return failure('INVALID_SKU_IDENTIFIER', 'Every SKU or barcode must contain between 1 and 128 characters');
  }
  const rows = await repository.resolvePurchaseOrderSkuOptions(client, {
    installationId: input.requestContext.installationId,
    identifiers,
  });
  const grouped = new Map();
  for (const row of rows) {
    const key = row.matched_identifier;
    const current = grouped.get(key) ?? [];
    current.push(row);
    grouped.set(key, current);
  }
  const resolutions = identifiers.map((identifier) => {
    const matches = grouped.get(identifier) ?? [];
    const unique = [...new Map(matches.map((row) => [row.id, row])).values()];
    if (unique.length === 0) {
      return Object.freeze({
        identifier,
        option: null,
        error: Object.freeze({ code: 'SKU_NOT_FOUND', message: 'Không tìm thấy SKU hoặc mã vạch.' }),
      });
    }
    if (unique.length > 1) {
      return Object.freeze({
        identifier,
        option: null,
        error: Object.freeze({ code: 'SKU_IDENTIFIER_AMBIGUOUS', message: 'Mã khớp nhiều SKU; hãy dùng mã SKU chính xác.' }),
      });
    }
    return Object.freeze({ identifier, option: mapSkuOption(unique[0]), error: null });
  });
  return Object.freeze({ ok: true, resolutions: Object.freeze(resolutions) });
}

export function calculatePurchaseOrderLineFinancials(input, { quantity, unitPrice }) {
  const mode = input.discountMode ?? 'TOTAL_AMOUNT';
  if (!DISCOUNT_MODES.has(mode)) return failure('INVALID_DISCOUNT_MODE', 'Discount mode is invalid');
  const discountValue = decimalToScaled(input.discountValue ?? input.discountAmount ?? '0', { allowZero: true });
  const taxRate = decimalToScaled(input.taxRate ?? '0', { allowZero: true });
  if (discountValue === null) return failure('INVALID_DISCOUNT', 'Discount value is invalid');
  if (taxRate === null || taxRate > ONE_HUNDRED_PERCENT) return failure('INVALID_TAX', 'Tax rate must be between 0 and 100 percent');
  if (mode === 'PERCENT' && discountValue > ONE_HUNDRED_PERCENT) {
    return failure('INVALID_DISCOUNT', 'Discount percent must be between 0 and 100');
  }
  const gross = multiplyScaled(quantity, unitPrice);
  const discountAmount = mode === 'PERCENT'
    ? percentOfScaled(gross, discountValue)
    : mode === 'PER_UNIT'
      ? multiplyScaled(quantity, discountValue)
      : discountValue;
  const discountedBase = gross - discountAmount;
  if (discountedBase < 0n) return failure('INVALID_DISCOUNT', 'Discount cannot exceed line gross amount');
  const taxAmount = percentOfScaled(discountedBase, taxRate);
  return Object.freeze({
    ok: true,
    gross,
    discountMode: mode,
    discountValue,
    discountAmount,
    taxRate,
    taxAmount,
    lineTotal: discountedBase + taxAmount,
  });
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
  const variants = await repository.getPurchaseOrderVariantEligibility(client, {
    installationId: requestContext.installationId,
    ids: variantIds,
  });
  if (!supplier) return failure('SUPPLIER_NOT_FOUND', 'Active supplier was not found');
  if (!warehouse) return failure('WAREHOUSE_NOT_FOUND', 'Active warehouse was not found');
  const variantMap = new Map(variants.map((variant) => [variant.id, variant]));

  let subtotal = 0n;
  let discountTotal = 0n;
  let taxTotal = 0n;
  const lines = [];
  for (let index = 0; index < payload.lines.length; index += 1) {
    const input = payload.lines[index];
    const variant = variantMap.get(input.variantId.trim());
    const eligibility = evaluatePurchaseOrderSkuEligibility(variant);
    if (!eligibility.selectable) {
      return failure(eligibility.code, `Line ${index + 1}: ${eligibility.message}`, false, {
        lineNumber: index + 1,
        variantId: input.variantId.trim(),
        eligibility,
      });
    }
    const quantity = decimalToScaled(input.quantity, { allowZero: false });
    const unitPrice = decimalToScaled(input.unitPrice, { allowZero: true });
    if (quantity === null) return failure('INVALID_QUANTITY', `Line ${index + 1} quantity must be a positive decimal with at most six decimal places`);
    if (unitPrice === null) return failure('INVALID_UNIT_PRICE', `Line ${index + 1} unit price is invalid`);
    const financials = calculatePurchaseOrderLineFinancials(input, { quantity, unitPrice });
    if (!financials.ok) return failure(financials.code, `Line ${index + 1}: ${financials.message}`);

    const conversion = decimalToScaled(String(variant.conversion_to_base), { allowZero: false });
    if (conversion === null) return failure('INVALID_CONVERSION', `Line ${index + 1} conversion snapshot is invalid`);
    const lineNote = normalizeText(input.note, 2000, false);
    if (input.note && lineNote === null) return failure('INVALID_LINE_NOTE', `Line ${index + 1} note must not exceed 2000 characters`);

    subtotal += financials.gross;
    discountTotal += financials.discountAmount;
    taxTotal += financials.taxAmount;
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
      discountMode: financials.discountMode,
      discountValue: scaledToDecimal(financials.discountValue),
      discountAmount: scaledToDecimal(financials.discountAmount),
      taxRate: scaledToDecimal(financials.taxRate),
      taxAmount: scaledToDecimal(financials.taxAmount),
      lineTotal: scaledToDecimal(financials.lineTotal),
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

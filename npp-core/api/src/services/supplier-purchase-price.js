import * as repository from '../db/repositories/supplier-purchase-price.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DECIMAL_PATTERN = /^(0|[1-9]\d{0,13})(?:\.(\d{1,6}))?$/;
const POSITIVE_DECIMAL_PATTERN = /^(?:0*\.[0-9]*[1-9][0-9]*|[1-9]\d*)(?:\.\d{1,6})?$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const REVISION_PATTERN = /^[1-9]\d{0,18}$/;

function failure(code, message, retryable = false, details = {}) {
  return Object.freeze({ ok: false, code, message, retryable, details });
}

function text(value, maxLength, { required = false, upper = false } = {}) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (required && !normalized) return null;
  if (normalized.length > maxLength) return null;
  return upper ? normalized.toUpperCase() : (normalized || null);
}

function uuid(value) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return UUID_PATTERN.test(normalized) ? normalized : null;
}

function date(value, required = false) {
  const normalized = typeof value === 'string' ? value.trim() : '';
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
  if (typeof value === 'string') {
    const leadingDate = value.slice(0, 10);
    if (date(leadingDate, true)) return leadingDate;
  }
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function decimal(value, { positive = false, field = 'value' } = {}) {
  const normalized = String(value ?? '').trim();
  const pattern = positive ? POSITIVE_DECIMAL_PATTERN : DECIMAL_PATTERN;
  if (!pattern.test(normalized)) return failure('INVALID_DECIMAL', `${field} must be ${positive ? 'greater than zero and ' : ''}a decimal with at most six places`);
  return { ok: true, value: normalized };
}

function mapPrice(row) {
  return Object.freeze({
    id: row.id,
    supplierId: row.supplier_id,
    supplierCode: row.supplier_code,
    supplierName: row.supplier_name,
    variantId: row.variant_id,
    sku: row.sku,
    variantName: row.variant_name,
    productCode: row.product_code,
    productName: row.product_name,
    unitId: row.unit_id,
    unitCode: row.unit_code,
    unitName: row.unit_name,
    currencyCode: row.currency_code,
    unitPrice: String(row.unit_price),
    minQuantity: String(row.min_quantity),
    effectiveFrom: dateOnly(row.effective_from),
    effectiveTo: dateOnly(row.effective_to),
    supplierSku: row.supplier_sku ?? null,
    sourceReference: row.source_reference ?? null,
    note: row.note ?? null,
    isActive: row.is_active === true,
    revision: String(row.revision),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  });
}

async function validateReferences(client, { installationId, supplierId, variantId, unitId }) {
  const refs = await repository.getPurchasePriceReferences(client, {
    installationId,
    supplierId,
    variantId,
    unitId,
  });
  if (!refs) return failure('PURCHASE_PRICE_REFERENCE_NOT_FOUND', 'Không tìm thấy nhà cung cấp, SKU hoặc đơn vị trong installation hiện tại.');
  if (refs.supplier_is_active !== true) return failure('SUPPLIER_INACTIVE', 'Nhà cung cấp đang ngưng hoạt động.');
  if (refs.product_is_active !== true) return failure('PRODUCT_INACTIVE', 'Sản phẩm đang ngưng hoạt động.');
  if (refs.product_is_orderable !== true) return failure('PRODUCT_NOT_ORDERABLE', 'Sản phẩm chưa được bật cho phép đặt hàng.');
  if (refs.variant_is_active !== true) return failure('SKU_INACTIVE', 'SKU đang ngưng hoạt động.');
  if (refs.is_purchasable !== true) return failure('SKU_NOT_PURCHASABLE', 'SKU chưa được bật cho nghiệp vụ mua hàng.');
  if (refs.unit_is_active !== true) return failure('SKU_UNIT_INACTIVE', 'Đơn vị của SKU đang ngưng hoạt động.');
  if (refs.variant_unit_id !== unitId) return failure('SKU_UNIT_MISMATCH', 'Đơn vị giá mua phải đúng đơn vị mua hàng đang gắn với SKU.');
  const conversion = decimal(refs.conversion_to_base, { positive: true, field: 'conversionToBase' });
  if (!conversion.ok) return failure('SKU_CONVERSION_INVALID', 'SKU chưa có hệ số quy đổi đơn vị hợp lệ.');
  return { ok: true };
}

function validatePayload(payload, defaults = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return failure('INVALID_INPUT', 'Dữ liệu giá mua là bắt buộc.');
  const supplierId = uuid(payload.supplierId ?? defaults.supplierId);
  const variantId = uuid(payload.variantId ?? defaults.variantId);
  const unitId = uuid(payload.unitId ?? defaults.unitId);
  if (!supplierId) return failure('INVALID_SUPPLIER_ID', 'supplierId không hợp lệ.');
  if (!variantId) return failure('INVALID_VARIANT_ID', 'variantId không hợp lệ.');
  if (!unitId) return failure('INVALID_UNIT_ID', 'unitId không hợp lệ.');

  const currencyCode = text(payload.currencyCode ?? defaults.currencyCode ?? 'VND', 3, { required: true, upper: true });
  if (!currencyCode || !CURRENCY_PATTERN.test(currencyCode)) return failure('INVALID_CURRENCY', 'currencyCode phải gồm ba chữ cái in hoa.');
  const unitPrice = decimal(payload.unitPrice ?? defaults.unitPrice, { positive: true, field: 'unitPrice' });
  if (!unitPrice.ok) return failure('INVALID_UNIT_PRICE', 'Giá mua phải lớn hơn 0 và có tối đa 6 chữ số thập phân.');
  const minQuantity = decimal(payload.minQuantity ?? defaults.minQuantity ?? '0', { field: 'minQuantity' });
  if (!minQuantity.ok) return failure('INVALID_MIN_QUANTITY', 'Số lượng tối thiểu phải từ 0 và có tối đa 6 chữ số thập phân.');

  const effectiveFrom = date(payload.effectiveFrom ?? defaults.effectiveFrom, true);
  const effectiveTo = date(Object.prototype.hasOwnProperty.call(payload, 'effectiveTo') ? payload.effectiveTo : defaults.effectiveTo);
  if (!effectiveFrom) return failure('INVALID_EFFECTIVE_FROM', 'Ngày bắt đầu hiệu lực không hợp lệ.');
  if ((payload.effectiveTo ?? defaults.effectiveTo) && !effectiveTo) return failure('INVALID_EFFECTIVE_TO', 'Ngày kết thúc hiệu lực không hợp lệ.');
  if (effectiveTo && effectiveTo < effectiveFrom) return failure('INVALID_EFFECTIVE_RANGE', 'Ngày kết thúc hiệu lực không được trước ngày bắt đầu.');

  const supplierSku = text(Object.prototype.hasOwnProperty.call(payload, 'supplierSku') ? payload.supplierSku : defaults.supplierSku, 128);
  if ((payload.supplierSku ?? defaults.supplierSku) && supplierSku === null) return failure('INVALID_SUPPLIER_SKU', 'Mã SKU nhà cung cấp không được vượt quá 128 ký tự.');
  const sourceReference = text(Object.prototype.hasOwnProperty.call(payload, 'sourceReference') ? payload.sourceReference : defaults.sourceReference, 256);
  if ((payload.sourceReference ?? defaults.sourceReference) && sourceReference === null) return failure('INVALID_SOURCE_REFERENCE', 'Tham chiếu nguồn không được vượt quá 256 ký tự.');
  const note = text(Object.prototype.hasOwnProperty.call(payload, 'note') ? payload.note : defaults.note, 2000);
  if ((payload.note ?? defaults.note) && note === null) return failure('INVALID_NOTE', 'Ghi chú không được vượt quá 2000 ký tự.');
  const isActive = Object.prototype.hasOwnProperty.call(payload, 'isActive')
    ? payload.isActive
    : (defaults.isActive ?? true);
  if (typeof isActive !== 'boolean') return failure('INVALID_ACTIVE_STATE', 'isActive phải là boolean.');

  return {
    ok: true,
    value: Object.freeze({
      supplierId,
      variantId,
      unitId,
      currencyCode,
      unitPrice: unitPrice.value,
      minQuantity: minQuantity.value,
      effectiveFrom,
      effectiveTo,
      supplierSku,
      sourceReference,
      note,
      isActive,
    }),
  };
}

export async function listSupplierPurchasePrices(client, input) {
  const supplierId = input.supplierId ? uuid(input.supplierId) : null;
  const variantId = input.variantId ? uuid(input.variantId) : null;
  if (input.supplierId && !supplierId) return failure('INVALID_SUPPLIER_ID', 'supplierId không hợp lệ.');
  if (input.variantId && !variantId) return failure('INVALID_VARIANT_ID', 'variantId không hợp lệ.');
  const rows = await repository.listSupplierPurchasePrices(client, {
    installationId: input.installationId,
    supplierId,
    variantId,
    active: input.active,
    limit: Math.max(1, Math.min(1000, Number(input.limit) || 100)),
    offset: Math.max(0, Number(input.offset) || 0),
  });
  return Object.freeze({ ok: true, prices: Object.freeze(rows.map(mapPrice)) });
}

export async function createSupplierPurchasePrice(client, { requestContext, payload }) {
  const validation = validatePayload(payload);
  if (!validation.ok) return validation;
  const refs = await validateReferences(client, {
    installationId: requestContext.installationId,
    ...validation.value,
  });
  if (!refs.ok) return refs;
  try {
    const row = await repository.insertSupplierPurchasePrice(client, {
      installationId: requestContext.installationId,
      actorId: requestContext.actorId,
      ...validation.value,
    });
    return Object.freeze({ ok: true, price: mapPrice(row) });
  } catch (error) {
    if (error?.code === '23505') return failure('DUPLICATE_SUPPLIER_PURCHASE_PRICE', 'Đã có giá mua trùng nhà cung cấp, SKU, đơn vị, tiền tệ, bậc số lượng và ngày hiệu lực.');
    throw error;
  }
}

export async function updateSupplierPurchasePrice(client, { requestContext, id, payload }) {
  const normalizedId = uuid(id);
  if (!normalizedId) return failure('SUPPLIER_PURCHASE_PRICE_NOT_FOUND', 'Không tìm thấy giá mua.');
  const current = await repository.getSupplierPurchasePriceById(client, {
    installationId: requestContext.installationId,
    id: normalizedId,
    forUpdate: true,
  });
  if (!current) return failure('SUPPLIER_PURCHASE_PRICE_NOT_FOUND', 'Không tìm thấy giá mua.');
  const expectedRevision = String(payload?.expectedRevision ?? '').trim();
  if (!REVISION_PATTERN.test(expectedRevision)) return failure('EXPECTED_REVISION_REQUIRED', 'expectedRevision là bắt buộc.');
  if (String(current.revision) !== expectedRevision) return failure('CONFLICT', 'Giá mua đã thay đổi ở yêu cầu khác.', true);

  const validation = validatePayload(payload, {
    supplierId: current.supplier_id,
    variantId: current.variant_id,
    unitId: current.unit_id,
    currencyCode: current.currency_code,
    unitPrice: String(current.unit_price),
    minQuantity: String(current.min_quantity),
    effectiveFrom: dateOnly(current.effective_from),
    effectiveTo: dateOnly(current.effective_to),
    supplierSku: current.supplier_sku,
    sourceReference: current.source_reference,
    note: current.note,
    isActive: current.is_active,
  });
  if (!validation.ok) return validation;
  const refs = await validateReferences(client, {
    installationId: requestContext.installationId,
    ...validation.value,
  });
  if (!refs.ok) return refs;
  try {
    const row = await repository.updateSupplierPurchasePrice(client, {
      id: normalizedId,
      installationId: requestContext.installationId,
      actorId: requestContext.actorId,
      expectedRevision,
      ...validation.value,
    });
    if (!row) return failure('CONFLICT', 'Giá mua đã thay đổi ở yêu cầu khác.', true);
    return Object.freeze({
      ok: true,
      price: mapPrice(row),
      beforeData: mapPrice(current),
    });
  } catch (error) {
    if (error?.code === '23505') return failure('DUPLICATE_SUPPLIER_PURCHASE_PRICE', 'Đã có giá mua trùng nhà cung cấp, SKU, đơn vị, tiền tệ, bậc số lượng và ngày hiệu lực.');
    throw error;
  }
}

export async function resolveSupplierPurchasePrice(client, input) {
  const supplierId = uuid(input.supplierId);
  const variantId = uuid(input.variantId);
  const unitId = uuid(input.unitId);
  const currencyCode = text(input.currencyCode ?? 'VND', 3, { required: true, upper: true });
  const orderDate = date(input.orderDate, true);
  const quantity = decimal(input.quantity, { positive: true, field: 'quantity' });
  if (!supplierId) return failure('INVALID_SUPPLIER_ID', 'supplierId không hợp lệ.');
  if (!variantId) return failure('INVALID_VARIANT_ID', 'variantId không hợp lệ.');
  if (!unitId) return failure('INVALID_UNIT_ID', 'unitId không hợp lệ.');
  if (!currencyCode || !CURRENCY_PATTERN.test(currencyCode)) return failure('INVALID_CURRENCY', 'currencyCode không hợp lệ.');
  if (!orderDate) return failure('INVALID_ORDER_DATE', 'orderDate không hợp lệ.');
  if (!quantity.ok) return failure('INVALID_QUANTITY', 'quantity phải lớn hơn 0 và có tối đa 6 chữ số thập phân.');

  const refs = await validateReferences(client, {
    installationId: input.installationId,
    supplierId,
    variantId,
    unitId,
  });
  if (!refs.ok) return refs;
  const row = await repository.resolveSupplierPurchasePrice(client, {
    installationId: input.installationId,
    supplierId,
    variantId,
    unitId,
    currencyCode,
    quantity: quantity.value,
    orderDate,
  });
  if (!row) return Object.freeze({ ok: true, status: 'NOT_FOUND', price: null });
  return Object.freeze({ ok: true, status: 'RESOLVED', price: mapPrice(row) });
}

export const supplierPurchasePriceInternals = Object.freeze({
  validatePayload,
  mapPrice,
});

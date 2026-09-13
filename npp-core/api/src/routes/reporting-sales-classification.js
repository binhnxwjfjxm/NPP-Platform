const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function failure(code, message, details = {}) {
  return Object.freeze({ ok: false, code, message, details, statusCode: 400 });
}

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function normalizedId(value) {
  const normalized = text(value).toLowerCase();
  return normalized || null;
}

function optionalUuid(value, code, message) {
  const normalized = normalizedId(value);
  if (!normalized) return Object.freeze({ ok: true, value: null });
  if (!UUID_PATTERN.test(normalized)) return failure(code, message);
  return Object.freeze({ ok: true, value: normalized });
}

function booleanFlag(value) {
  if (value === null || value === undefined || value === '') return Object.freeze({ ok: true, value: false });
  if (typeof value === 'boolean') return Object.freeze({ ok: true, value });
  const normalized = text(value).toLowerCase();
  if (normalized === 'true' || normalized === '1') return Object.freeze({ ok: true, value: true });
  if (normalized === 'false' || normalized === '0') return Object.freeze({ ok: true, value: false });
  return failure('INVALID_SALES_INCLUDE_ZERO_PRODUCTS', 'Tùy chọn hiện sản phẩm không phát sinh không hợp lệ');
}

function unitOf(row) {
  return Object.freeze({
    id: normalizedId(row?.unitId),
    code: text(row?.unitCode, 'Không xác định'),
    name: text(row?.unitName, text(row?.unitCode, 'Không xác định')),
  });
}

function productIdentity(row) {
  const variantId = normalizedId(row?.variantId ?? row?.id);
  const sku = text(row?.sku ?? row?.code);
  const unit = unitOf(row);
  return `${variantId ?? sku}|${unit.id ?? unit.code}`;
}

export function normalizeSalesClassificationFilters(input = {}, baseFilters = {}) {
  const productGroup = optionalUuid(
    input.productGroupId,
    'INVALID_SALES_PRODUCT_GROUP',
    'Nhóm sản phẩm báo cáo không hợp lệ',
  );
  if (!productGroup.ok) return productGroup;

  const customerGroup = optionalUuid(
    input.customerGroupId,
    'INVALID_SALES_CUSTOMER_GROUP',
    'Nhóm khách hàng báo cáo không hợp lệ',
  );
  if (!customerGroup.ok) return customerGroup;

  const includeZeroProducts = booleanFlag(input.includeZeroProducts);
  if (!includeZeroProducts.ok) return includeZeroProducts;

  return Object.freeze({
    ...baseFilters,
    ok: true,
    productGroupId: productGroup.value,
    customerGroupId: customerGroup.value,
    includeZeroProducts: includeZeroProducts.value,
  });
}

export function filterSalesFactsForDimension(facts, filters, dimension) {
  const source = facts ?? [];
  if (dimension === 'customers') {
    const customerGroupId = normalizedId(filters?.customerGroupId);
    if (!customerGroupId) return Object.freeze([...source]);
    return Object.freeze(source.filter((fact) => normalizedId(fact?.customerGroupId) === customerGroupId));
  }
  if (dimension === 'products') {
    const productGroupId = normalizedId(filters?.productGroupId);
    if (!productGroupId) return Object.freeze([...source]);
    return Object.freeze(source.filter((fact) => normalizedId(fact?.productGroupId) === productGroupId));
  }
  return Object.freeze([...source]);
}

export function buildSalesClassificationOptions(productGroups, customerGroups) {
  const normalizedProductGroups = (productGroups ?? []).map((row) => Object.freeze({
    id: normalizedId(row?.id),
    code: text(row?.code) || null,
    name: text(row?.name, 'Nhóm hàng chưa có tên'),
    parentCategoryId: normalizedId(row?.parentCategoryId),
  })).filter((row) => row.id).sort((left, right) => `${left.code ?? ''}|${left.name}`.localeCompare(`${right.code ?? ''}|${right.name}`, 'vi'));

  const normalizedCustomerGroups = (customerGroups ?? []).map((row) => Object.freeze({
    id: normalizedId(row?.id),
    code: text(row?.code) || null,
    name: text(row?.name, 'Nhóm khách chưa có tên'),
  })).filter((row) => row.id).sort((left, right) => `${left.code ?? ''}|${left.name}`.localeCompare(`${right.code ?? ''}|${right.name}`, 'vi'));

  return Object.freeze({
    productGroups: Object.freeze(normalizedProductGroups),
    customerGroups: Object.freeze(normalizedCustomerGroups),
  });
}

export function appendZeroProductRows(rows, catalogRows, { productGroupId = null, currencyCode = '' } = {}) {
  const selectedProductGroupId = normalizedId(productGroupId);
  const output = [...(rows ?? [])];
  const existing = new Set(output.map(productIdentity));

  for (const catalogRow of catalogRows ?? []) {
    if (selectedProductGroupId && normalizedId(catalogRow?.productGroupId) !== selectedProductGroupId) continue;
    const key = productIdentity(catalogRow);
    if (existing.has(key)) continue;
    output.push(Object.freeze({
      id: normalizedId(catalogRow?.variantId ?? catalogRow?.id),
      code: text(catalogRow?.sku ?? catalogRow?.code) || null,
      name: text(catalogRow?.itemName ?? catalogRow?.name, 'Sản phẩm chưa xác định'),
      source: 'current-master-zero',
      currencyCode: text(currencyCode),
      unit: unitOf(catalogRow),
      revenue: '0',
      quantity: '0',
      documentCount: '0',
      customerCount: '0',
      productCount: '1',
      sharePercent: '0',
      previousRevenue: '0',
      previousQuantity: '0',
      changePercent: null,
      comparisonState: 'comparable',
    }));
    existing.add(key);
  }

  return Object.freeze(output.sort((left, right) => {
    const leftActive = left.revenue !== '0' || left.quantity !== '0';
    const rightActive = right.revenue !== '0' || right.quantity !== '0';
    if (leftActive !== rightActive) return leftActive ? -1 : 1;
    return String(left.name).localeCompare(String(right.name), 'vi');
  }));
}

export const salesClassificationInternals = Object.freeze({
  normalizedId,
  productIdentity,
});

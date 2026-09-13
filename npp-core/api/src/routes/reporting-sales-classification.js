const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCALE = 1_000_000n;
const PERCENT_SCALE = 10_000n;

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

function decimal6(value) {
  const normalized = text(value, '0');
  const match = normalized.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) throw Object.assign(new Error('sales_classification_invalid_decimal'), { code: 'SALES_REPORT_INVALID_DECIMAL' });
  const fraction = `${match[3] ?? ''}000000`.slice(0, 6);
  const scaled = BigInt(match[2]) * SCALE + BigInt(fraction || '0');
  return match[1] ? -scaled : scaled;
}

function decimalText(value) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / SCALE;
  const fraction = String(absolute % SCALE).padStart(6, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

function roundedDivide(numerator, denominator) {
  if (denominator === 0n) return null;
  const negative = (numerator < 0n) !== (denominator < 0n);
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const rounded = (n + (d / 2n)) / d;
  return negative ? -rounded : rounded;
}

function percentText(numerator, denominator) {
  if (denominator === 0n) return '0';
  const scaled = roundedDivide(numerator * 100n * PERCENT_SCALE, denominator);
  if (scaled === null) return '0';
  const negative = scaled < 0n;
  const absolute = negative ? -scaled : scaled;
  const whole = absolute / PERCENT_SCALE;
  const fraction = String(absolute % PERCENT_SCALE).padStart(4, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

function unitOf(row) {
  return Object.freeze({
    id: normalizedId(row?.unitId),
    code: text(row?.unitCode, 'Không xác định'),
    name: text(row?.unitName, text(row?.unitCode, 'Không xác định')),
  });
}

function customerGroupColumn(row) {
  const id = normalizedId(row?.customerGroupId ?? row?.id);
  const code = text(row?.customerGroupCode ?? row?.code);
  const name = text(row?.customerGroupName ?? row?.name, id ? 'Nhóm khách chưa có tên' : 'Chưa phân loại');
  return Object.freeze({
    key: id ? `group:${id}` : 'unclassified',
    id,
    code: code || null,
    name,
    source: text(row?.customerGroupSource ?? row?.source, id ? 'master' : 'unavailable'),
  });
}

function productRowIdentity(row) {
  const variantId = normalizedId(row?.variantId ?? row?.id);
  const sku = text(row?.sku ?? row?.code);
  const unit = unitOf(row);
  return `${variantId ?? sku}|${unit.id ?? unit.code}`;
}

function seedProductRow(row) {
  return {
    variantId: normalizedId(row?.variantId ?? row?.id),
    sku: text(row?.sku ?? row?.code) || null,
    name: text(row?.itemName ?? row?.name, 'Sản phẩm chưa xác định'),
    productGroup: Object.freeze({
      id: normalizedId(row?.productGroupId),
      code: text(row?.productGroupCode) || null,
      name: text(row?.productGroupName, row?.productGroupId ? 'Nhóm hàng chưa có tên' : 'Chưa phân loại'),
      source: text(row?.productGroupSource, row?.productGroupId ? 'master' : 'unavailable'),
    }),
    unit: unitOf(row),
    cells: new Map(),
  };
}

function sortedColumns(columns) {
  return [...columns.values()].sort((left, right) => {
    if (left.id === null && right.id !== null) return 1;
    if (left.id !== null && right.id === null) return -1;
    return `${left.code ?? ''}|${left.name}`.localeCompare(`${right.code ?? ''}|${right.name}`, 'vi');
  });
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

export function filterSalesFacts(facts, filters) {
  const productGroupId = normalizedId(filters?.productGroupId);
  const customerGroupId = normalizedId(filters?.customerGroupId);
  return Object.freeze((facts ?? []).filter((fact) => {
    if (productGroupId && normalizedId(fact?.productGroupId) !== productGroupId) return false;
    if (customerGroupId && normalizedId(fact?.customerGroupId) !== customerGroupId) return false;
    return true;
  }));
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

export function appendZeroProductRows(rows, catalogRows, { productGroupId = null, currencyCode = '' } = {}) {
  const selectedProductGroupId = normalizedId(productGroupId);
  const output = [...(rows ?? [])];
  const existing = new Set(output.map(productRowIdentity));

  for (const catalogRow of catalogRows ?? []) {
    if (selectedProductGroupId && normalizedId(catalogRow?.productGroupId) !== selectedProductGroupId) continue;
    const key = productRowIdentity(catalogRow);
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

export function buildProductCustomerMatrix({
  facts = [],
  catalogRows = [],
  customerGroups = [],
  filters = {},
}) {
  const currentFacts = filterSalesFacts(
    (facts ?? []).filter((fact) => fact?.period === 'current'),
    filters,
  );
  const selectedCustomerGroupId = normalizedId(filters.customerGroupId);
  const selectedProductGroupId = normalizedId(filters.productGroupId);

  const columns = new Map();
  for (const group of customerGroups ?? []) {
    const column = customerGroupColumn(group);
    if (!column.id) continue;
    if (selectedCustomerGroupId && column.id !== selectedCustomerGroupId) continue;
    columns.set(column.key, column);
  }
  for (const fact of currentFacts) {
    const column = customerGroupColumn(fact);
    if (selectedCustomerGroupId && column.id !== selectedCustomerGroupId) continue;
    columns.set(column.key, column);
  }

  const rows = new Map();
  if (filters.includeZeroProducts) {
    for (const catalogRow of catalogRows ?? []) {
      if (selectedProductGroupId && normalizedId(catalogRow?.productGroupId) !== selectedProductGroupId) continue;
      const row = seedProductRow(catalogRow);
      rows.set(productRowIdentity(catalogRow), row);
    }
  }

  for (const fact of currentFacts) {
    const key = productRowIdentity(fact);
    const row = rows.get(key) ?? seedProductRow(fact);
    const column = customerGroupColumn(fact);
    if (!columns.has(column.key)) columns.set(column.key, column);
    row.cells.set(column.key, (row.cells.get(column.key) ?? 0n) + decimal6(fact.orderedQuantity));
    rows.set(key, row);
  }

  const orderedColumns = sortedColumns(columns);
  const orderedRows = [...rows.values()].map((row) => {
    const totalQuantity = [...row.cells.values()].reduce((sum, value) => sum + value, 0n);
    const cells = orderedColumns.map((column) => {
      const quantity = row.cells.get(column.key) ?? 0n;
      return Object.freeze({
        columnKey: column.key,
        customerGroupId: column.id,
        quantity: decimalText(quantity),
        sharePercent: percentText(quantity, totalQuantity),
      });
    });
    return Object.freeze({
      variantId: row.variantId,
      sku: row.sku,
      name: row.name,
      productGroup: row.productGroup,
      unit: row.unit,
      totalQuantity: decimalText(totalQuantity),
      cells: Object.freeze(cells),
      hasActivity: totalQuantity !== 0n,
    });
  }).sort((left, right) => {
    const leftGroup = `${left.productGroup.code ?? ''}|${left.productGroup.name}`;
    const rightGroup = `${right.productGroup.code ?? ''}|${right.productGroup.name}`;
    return leftGroup.localeCompare(rightGroup, 'vi')
      || left.name.localeCompare(right.name, 'vi')
      || left.unit.code.localeCompare(right.unit.code, 'vi');
  });

  const unitTotals = new Map();
  for (const row of orderedRows) {
    const unitKey = row.unit.id ?? row.unit.code;
    const total = unitTotals.get(unitKey) ?? {
      unit: row.unit,
      totalQuantity: 0n,
      cells: new Map(),
    };
    const rowTotal = decimal6(row.totalQuantity);
    total.totalQuantity += rowTotal;
    for (const cell of row.cells) {
      total.cells.set(cell.columnKey, (total.cells.get(cell.columnKey) ?? 0n) + decimal6(cell.quantity));
    }
    unitTotals.set(unitKey, total);
  }

  const totalsByUnit = [...unitTotals.values()].sort((left, right) => left.unit.code.localeCompare(right.unit.code, 'vi')).map((row) => Object.freeze({
    unit: row.unit,
    totalQuantity: decimalText(row.totalQuantity),
    cells: Object.freeze(orderedColumns.map((column) => {
      const quantity = row.cells.get(column.key) ?? 0n;
      return Object.freeze({
        columnKey: column.key,
        customerGroupId: column.id,
        quantity: decimalText(quantity),
        sharePercent: percentText(quantity, row.totalQuantity),
      });
    })),
  }));

  return Object.freeze({
    basis: Object.freeze({
      rows: 'product-variant-and-unit',
      columns: 'customer-group',
      quantity: 'sales.sales_order_version_lines.ordered_quantity',
      totalRule: 'Chỉ cộng sản lượng trong cùng một ĐVT; tổng cuối bảng được tách theo ĐVT',
    }),
    includeZeroProducts: Boolean(filters.includeZeroProducts),
    columns: Object.freeze(orderedColumns),
    rows: Object.freeze(orderedRows),
    totalsByUnit: Object.freeze(totalsByUnit),
  });
}

export const salesClassificationInternals = Object.freeze({
  decimal6,
  decimalText,
  percentText,
  customerGroupColumn,
  productRowIdentity,
});

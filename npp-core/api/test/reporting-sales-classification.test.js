import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  appendZeroProductRows,
  buildSalesClassificationOptions,
  filterSalesFactsForDimension,
  normalizeSalesClassificationFilters,
} from '../src/routes/reporting-sales-classification.js';
import { normalizeSalesReportingExportSelection } from '../src/services/reporting-sales-export.js';

const readApi = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Báo cáo bán hàng chuẩn hóa bộ lọc nhóm nhưng chỉ áp vào đúng bảng nghiệp vụ', () => {
  const base = Object.freeze({
    ok: true,
    from: '2026-09-01',
    to: '2026-09-12',
    warehouseId: null,
    fromInstant: '2026-08-31T17:00:00.000Z',
    toExclusiveInstant: '2026-09-12T17:00:00.000Z',
  });
  const productGroupId = '11111111-1111-4111-8111-111111111111';
  const customerGroupId = '22222222-2222-4222-8222-222222222222';
  const normalized = normalizeSalesClassificationFilters({
    productGroupId: productGroupId.toUpperCase(),
    customerGroupId,
    includeZeroProducts: 'true',
  }, base);

  assert.equal(normalized.ok, true);
  assert.equal(normalized.productGroupId, productGroupId);
  assert.equal(normalized.customerGroupId, customerGroupId);
  assert.equal(normalized.includeZeroProducts, true);
  assert.equal(normalizeSalesClassificationFilters({ productGroupId: 'TS' }, base).code, 'INVALID_SALES_PRODUCT_GROUP');
  assert.equal(normalizeSalesClassificationFilters({ includeZeroProducts: 'yes' }, base).code, 'INVALID_SALES_INCLUDE_ZERO_PRODUCTS');

  const facts = [
    { id: 'a', productGroupId, customerGroupId },
    { id: 'b', productGroupId, customerGroupId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    { id: 'c', productGroupId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', customerGroupId },
  ];

  assert.deepEqual(
    filterSalesFactsForDimension(facts, { customerGroupId, productGroupId }, 'customers').map((row) => row.id),
    ['a', 'c'],
  );
  assert.deepEqual(
    filterSalesFactsForDimension(facts, { customerGroupId, productGroupId }, 'products').map((row) => row.id),
    ['a', 'b'],
  );
  assert.deepEqual(
    filterSalesFactsForDimension(facts, { customerGroupId, productGroupId }, 'channels').map((row) => row.id),
    ['a', 'b', 'c'],
  );
});

test('Danh mục nhóm vẫn là nguồn lựa chọn và sản phẩm không phát sinh chỉ được ghép vào bảng Sản phẩm', () => {
  const productGroupId = '11111111-1111-4111-8111-111111111111';
  const options = buildSalesClassificationOptions(
    [{ id: productGroupId, code: 'TS', name: 'Trà sữa', parentCategoryId: null }],
    [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', code: 'KHTV', name: 'Khách thành viên' }],
  );
  assert.equal(options.productGroups[0].code, 'TS');
  assert.equal(options.customerGroups[0].code, 'KHTV');

  const rows = [{
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    code: 'SP-A',
    name: 'Sản phẩm A',
    unit: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', code: 'THUNG', name: 'Thùng' },
    revenue: '100',
    quantity: '3',
  }];
  const catalog = [
    {
      variantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      sku: 'SP-A',
      itemName: 'Sản phẩm A',
      productGroupId,
      unitId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      unitCode: 'THUNG',
      unitName: 'Thùng',
    },
    {
      variantId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      sku: 'SP-ZERO',
      itemName: 'Sản phẩm chưa bán',
      productGroupId,
      unitId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      unitCode: 'BICH',
      unitName: 'Bịch',
    },
  ];

  const result = appendZeroProductRows(rows, catalog, { productGroupId, currencyCode: 'VND' });
  assert.equal(result.length, 2);
  assert.equal(result.filter((row) => row.code === 'SP-A').length, 1);
  const zero = result.find((row) => row.code === 'SP-ZERO');
  assert.equal(zero.quantity, '0');
  assert.equal(zero.revenue, '0');
  assert.equal(zero.source, 'current-master-zero');
});

test('Backend trả tổng cho 6 bảng cũ và không còn export ma trận như một loại báo cáo riêng', async () => {
  const [sales, exporter] = await Promise.all([
    readApi('src/routes/reporting-sales.js'),
    readApi('src/services/reporting-sales-export.js'),
  ]);

  assert.match(sales, /breakdownTotals: breakdownTotalsByDimension/);
  assert.match(sales, /customers: breakdown\(customerFacts, 'customers'\)/);
  assert.match(sales, /products: productRows/);
  assert.match(sales, /customerGroups: breakdown\(allFacts, 'customerGroups'\)/);
  assert.match(sales, /dailyTrend\(allFacts/);
  assert.match(sales, /quality\(allFacts\)/);
  assert.match(sales, /reconciliation\(allFacts\)/);
  assert.doesNotMatch(sales, /productCustomerMatrix,/);

  const rejected = normalizeSalesReportingExportSelection({
    dimension: 'productCustomerMatrix',
    format: 'xlsx',
    columns: [],
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, 'INVALID_SALES_EXPORT_DIMENSION');
  assert.doesNotMatch(exporter, /salesProductCustomerMatrixExportShape/);
});

test('Route Công Ty và Admin vẫn nhận ID nhóm, không thêm DB hoặc migration', async () => {
  const [route, adminRoute, sales] = await Promise.all([
    readApi('src/routes/reporting-sales-purchasing.js'),
    readApi('src/routes/reporting-admin-lot-d.js'),
    readApi('src/routes/reporting-sales.js'),
  ]);
  for (const field of ['productGroupId', 'customerGroupId', 'includeZeroProducts']) {
    assert.match(route, new RegExp(field));
    assert.match(adminRoute, new RegExp(field));
    assert.match(sales, new RegExp(field));
  }
  assert.match(sales, /shared\.product_categories/);
  assert.match(sales, /shared\.customer_groups/);
  assert.doesNotMatch(route + adminRoute + sales, /ALTER TABLE|CREATE TABLE|database\/migrations/);
});

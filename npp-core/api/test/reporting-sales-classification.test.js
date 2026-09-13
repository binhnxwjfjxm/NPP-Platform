import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildProductCustomerMatrix,
  buildSalesClassificationOptions,
  filterSalesFacts,
  normalizeSalesClassificationFilters,
} from '../src/routes/reporting-sales-classification.js';
import {
  normalizeSalesReportingExportSelection,
  salesProductCustomerMatrixExportShape,
} from '../src/services/reporting-sales-export.js';

const readApi = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Báo cáo bán hàng chuẩn hóa lọc nhóm và không nhận giá trị mơ hồ', () => {
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
  assert.equal(
    normalizeSalesClassificationFilters({ productGroupId: 'TS' }, base).code,
    'INVALID_SALES_PRODUCT_GROUP',
  );
  assert.equal(
    normalizeSalesClassificationFilters({ includeZeroProducts: 'yes' }, base).code,
    'INVALID_SALES_INCLUDE_ZERO_PRODUCTS',
  );
});

test('Lọc nhóm dùng đúng ID snapshot và áp dụng đồng thời nhóm sản phẩm + nhóm khách', () => {
  const facts = [
    { productGroupId: '11111111-1111-4111-8111-111111111111', customerGroupId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    { productGroupId: '11111111-1111-4111-8111-111111111111', customerGroupId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
    { productGroupId: '22222222-2222-4222-8222-222222222222', customerGroupId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
  ];
  const filtered = filterSalesFacts(facts, {
    productGroupId: '11111111-1111-4111-8111-111111111111',
    customerGroupId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0], facts[0]);
});

test('Ma trận sản phẩm × nhóm khách có tổng từng dòng, tổng theo ĐVT và giữ sản phẩm không phát sinh', () => {
  const customerGroups = [
    { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', code: 'KHTV', name: 'Khách thành viên' },
    { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', code: 'KHL', name: 'Khách lẻ' },
  ];
  const options = buildSalesClassificationOptions([
    { id: '11111111-1111-4111-8111-111111111111', code: 'TS', name: 'Trà sữa', parentCategoryId: null },
  ], customerGroups);
  assert.equal(options.productGroups[0].code, 'TS');
  assert.equal(options.customerGroups.length, 2);

  const facts = [
    {
      period: 'current',
      variantId: 'variant-a',
      sku: 'SP-A',
      itemName: 'Sản phẩm A',
      productGroupId: '11111111-1111-4111-8111-111111111111',
      productGroupCode: 'TS',
      productGroupName: 'Trà sữa',
      productGroupSource: 'snapshot',
      customerGroupId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      customerGroupCode: 'KHTV',
      customerGroupName: 'Khách thành viên',
      customerGroupSource: 'snapshot',
      unitId: 'unit-box',
      unitCode: 'THUNG',
      unitName: 'Thùng',
      orderedQuantity: '3',
    },
    {
      period: 'current',
      variantId: 'variant-a',
      sku: 'SP-A',
      itemName: 'Sản phẩm A',
      productGroupId: '11111111-1111-4111-8111-111111111111',
      productGroupCode: 'TS',
      productGroupName: 'Trà sữa',
      productGroupSource: 'snapshot',
      customerGroupId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      customerGroupCode: 'KHL',
      customerGroupName: 'Khách lẻ',
      customerGroupSource: 'snapshot',
      unitId: 'unit-box',
      unitCode: 'THUNG',
      unitName: 'Thùng',
      orderedQuantity: '2',
    },
  ];
  const catalogRows = [
    {
      variantId: 'variant-a',
      sku: 'SP-A',
      itemName: 'Sản phẩm A',
      productGroupId: '11111111-1111-4111-8111-111111111111',
      productGroupCode: 'TS',
      productGroupName: 'Trà sữa',
      unitId: 'unit-box',
      unitCode: 'THUNG',
      unitName: 'Thùng',
    },
    {
      variantId: 'variant-zero',
      sku: 'SP-ZERO',
      itemName: 'Sản phẩm chưa bán',
      productGroupId: '11111111-1111-4111-8111-111111111111',
      productGroupCode: 'TS',
      productGroupName: 'Trà sữa',
      unitId: 'unit-bag',
      unitCode: 'BICH',
      unitName: 'Bịch',
    },
  ];

  const matrix = buildProductCustomerMatrix({
    facts,
    catalogRows,
    customerGroups,
    filters: {
      productGroupId: '11111111-1111-4111-8111-111111111111',
      customerGroupId: null,
      includeZeroProducts: true,
    },
  });

  assert.equal(matrix.columns.length, 2);
  assert.equal(matrix.rows.length, 2);
  const active = matrix.rows.find((row) => row.variantId === 'variant-a');
  assert.equal(active.totalQuantity, '5');
  assert.deepEqual(active.cells.map((cell) => [cell.quantity, cell.sharePercent]), [['2', '40'], ['3', '60']]);
  const zero = matrix.rows.find((row) => row.variantId === 'variant-zero');
  assert.equal(zero.totalQuantity, '0');
  assert.equal(zero.hasActivity, false);
  assert.deepEqual(matrix.totalsByUnit.map((row) => [row.unit.code, row.totalQuantity]), [['BICH', '0'], ['THUNG', '5']]);
  assert.match(matrix.basis.totalRule, /cùng một ĐVT/);
});

test('Export ma trận dùng cột nhóm khách động và thêm tổng + tỷ lệ theo từng ĐVT', () => {
  const selection = normalizeSalesReportingExportSelection({
    dimension: 'productCustomerMatrix',
    format: 'xlsx',
    columns: [],
  });
  assert.equal(selection.ok, true);
  assert.equal(selection.dynamicColumns, true);

  const shape = salesProductCustomerMatrixExportShape({
    columns: [
      { id: 'a', code: 'KHTV', name: 'Khách thành viên' },
      { id: 'b', code: 'KHL', name: 'Khách lẻ' },
    ],
    rows: [{
      sku: 'SP-A',
      name: 'Sản phẩm A',
      unit: { code: 'THUNG', name: 'Thùng' },
      totalQuantity: '5',
      cells: [{ quantity: '3' }, { quantity: '2' }],
    }],
    totalsByUnit: [{
      unit: { code: 'THUNG', name: 'Thùng' },
      totalQuantity: '5',
      cells: [
        { quantity: '3', sharePercent: '60' },
        { quantity: '2', sharePercent: '40' },
      ],
    }],
  });

  assert.deepEqual(shape.columns.map((column) => column.label), [
    'Mã', 'Tên sản phẩm', 'ĐVT', 'Tổng SL', 'KHTV · Khách thành viên', 'KHL · Khách lẻ',
  ]);
  assert.equal(shape.rows[0].totalQuantity, '5');
  assert.equal(shape.rows[1].name, 'TỔNG Thùng');
  assert.equal(shape.rows[2].name, 'TỶ LỆ Thùng (%)');
  assert.equal(shape.rows[2].customerGroup1, '60%');
  assert.equal(
    normalizeSalesReportingExportSelection({
      dimension: 'productCustomerMatrix',
      format: 'xlsx',
      columns: ['name'],
    }).code,
    'INVALID_SALES_EXPORT_COLUMNS',
  );
});

test('Route Công Ty và export Admin cùng nhận bộ lọc phân loại, không đụng migration', async () => {
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
  assert.match(sales, /buildProductCustomerMatrix/);
  assert.match(sales, /reconciliation\(allFacts\)/);
  assert.match(sales, /shared\.product_categories/);
  assert.match(sales, /shared\.customer_groups/);
  assert.doesNotMatch(route + adminRoute + sales, /ALTER TABLE|CREATE TABLE|database\/migrations/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  normalizeSalesReportingExportSelection,
  salesReportingExportInternals,
} from '../src/services/reporting-sales-export.js';

const readApi = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Sales export giữ 6 chiều danh sách và whitelist cột theo chiều', () => {
  const valid = normalizeSalesReportingExportSelection({
    dimension: 'products',
    format: 'csv',
    columns: ['code', 'name', 'unitName', 'quantity', 'revenue', 'changePercent'],
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.matrix, false);
  assert.equal(valid.dimension, 'products');
  assert.equal(valid.format, 'csv');
  assert.deepEqual(valid.columns.map((item) => item.key), ['code', 'name', 'unitName', 'quantity', 'revenue', 'changePercent']);

  const invalidDimension = normalizeSalesReportingExportSelection({ dimension: 'documents', format: 'xlsx', columns: [] });
  assert.equal(invalidDimension.ok, false);
  assert.equal(invalidDimension.code, 'INVALID_SALES_EXPORT_DIMENSION');

  const invalidFormat = normalizeSalesReportingExportSelection({ dimension: 'customers', format: 'pdf', columns: [] });
  assert.equal(invalidFormat.ok, false);
  assert.equal(invalidFormat.code, 'INVALID_SALES_EXPORT_FORMAT');

  const invalidColumn = normalizeSalesReportingExportSelection({ dimension: 'customers', format: 'xlsx', columns: ['name', 'quantity'] });
  assert.equal(invalidColumn.ok, false);
  assert.equal(invalidColumn.code, 'INVALID_SALES_EXPORT_COLUMNS');

  assert.deepEqual(Object.keys(salesReportingExportInternals.DIMENSIONS), [
    'customers', 'customerGroups', 'channels', 'products', 'productGroups', 'employees',
  ]);
  assert.deepEqual(
    salesReportingExportInternals.flattenRow({ unit: { code: 'THUNG', name: 'Thùng' } }),
    {
      code: '', name: '', currencyCode: '', unitCode: 'THUNG', unitName: 'Thùng', revenue: '', quantity: '',
      documentCount: '', customerCount: '', productCount: '', sharePercent: '', previousRevenue: '',
      previousQuantity: '', changePercent: '', source: '',
    },
  );

  const formatted = salesReportingExportInternals.flattenRow({
    revenue: '5000000',
    previousRevenue: '1234567.5',
    sharePercent: '7.8543',
    changePercent: '1506500.8887',
  });
  assert.equal(formatted.revenue, '5,000,000');
  assert.equal(formatted.previousRevenue, '1,234,567.5');
  assert.equal(formatted.sharePercent, '7.85%');
  assert.equal(formatted.changePercent, '1,506,500.89%');

  const productDefaults = normalizeSalesReportingExportSelection({
    dimension: 'products',
    format: 'xlsx',
    columns: [],
  });
  assert.equal(productDefaults.ok, true);
  assert.deepEqual(productDefaults.columns.map((item) => item.key).slice(3, 6), ['unitName', 'quantity', 'revenue']);
});

test('Sales export nhận ma trận Sản phẩm, Loại khách, Kênh bán và Nhóm hàng', () => {
  const revenue = normalizeSalesReportingExportSelection({
    dimension: 'matrix.products.customerGroups.revenue',
    format: 'xlsx',
    columns: [],
  });
  assert.equal(revenue.ok, true);
  assert.equal(revenue.matrix, true);
  assert.equal(revenue.rowDimension, 'products');
  assert.equal(revenue.columnDimension, 'customerGroups');
  assert.equal(revenue.metric, 'revenue');

  const channel = normalizeSalesReportingExportSelection({
    dimension: 'matrix.productGroups.channels.revenue',
    format: 'xlsx',
    columns: [],
  });
  assert.equal(channel.ok, true);
  assert.equal(channel.rowDimension, 'productGroups');
  assert.equal(channel.columnDimension, 'channels');

  const quantity = normalizeSalesReportingExportSelection({
    dimension: 'matrix.products.productGroups.quantity',
    format: 'xlsx',
    columns: [],
  });
  assert.equal(quantity.ok, true);
  assert.equal(quantity.metric, 'quantity');

  const invalidQuantity = normalizeSalesReportingExportSelection({
    dimension: 'matrix.customerGroups.channels.quantity',
    format: 'xlsx',
    columns: [],
  });
  assert.equal(invalidQuantity.ok, false);
  assert.equal(invalidQuantity.code, 'INVALID_SALES_MATRIX_QUANTITY_AXIS');

  const invalidCsv = normalizeSalesReportingExportSelection({
    dimension: 'matrix.products.customerGroups.revenue',
    format: 'csv',
    columns: [],
  });
  assert.equal(invalidCsv.ok, false);
  assert.equal(invalidCsv.code, 'INVALID_SALES_MATRIX_FORMAT');
});

test('Ma trận gom đúng số liệu và tách sheet theo tiền tệ hoặc ĐVT', () => {
  const selection = normalizeSalesReportingExportSelection({
    dimension: 'matrix.products.customerGroups.revenue',
    format: 'xlsx',
    columns: [],
  });
  const rows = [
    {
      currencyCode: 'VND', productId: 'p1', productCode: 'SP1', productName: 'Sản phẩm 1', unitId: 'u1', unitCode: 'THUNG', unitName: 'Thùng',
      customerGroupId: 'g1', customerGroupCode: 'DL', customerGroupName: 'Đại lý', revenue: '100', quantity: '1',
    },
    {
      currencyCode: 'VND', productId: 'p1', productCode: 'SP1', productName: 'Sản phẩm 1', unitId: 'u1', unitCode: 'THUNG', unitName: 'Thùng',
      customerGroupId: 'g2', customerGroupCode: 'QUAN', customerGroupName: 'Quán', revenue: '50', quantity: '2',
    },
    {
      currencyCode: 'VND', productId: 'p2', productCode: 'SP2', productName: 'Sản phẩm 2', unitId: 'u1', unitCode: 'THUNG', unitName: 'Thùng',
      customerGroupId: 'g1', customerGroupCode: 'DL', customerGroupName: 'Đại lý', revenue: '150', quantity: '3',
    },
  ];
  const sheets = salesReportingExportInternals.buildMatrixSheets(rows, selection, { from: '2026-09-01', to: '2026-09-17' });
  assert.equal(sheets.length, 1);
  assert.equal(sheets[0].scopeLabel, 'VND');
  assert.equal(sheets[0].grandTotalText, '300');
  assert.equal(sheets[0].columns.length, 2);
  assert.equal(sheets[0].rows.length, 2);
  assert.equal(sheets[0].rows[0].totalText, '150');
});

test('Sales export mặc định cột an toàn, ma trận có khung và không lấy documents giới hạn 200 dòng', async () => {
  const source = await readApi('src/services/reporting-sales-export.js');
  const selection = normalizeSalesReportingExportSelection({ dimension: 'customers', format: 'xlsx', columns: [] });
  assert.equal(selection.ok, true);
  assert.deepEqual(selection.columns.map((item) => item.key), [
    'code', 'name', 'currencyCode', 'revenue', 'documentCount', 'sharePercent', 'previousRevenue', 'changePercent',
  ]);
  assert.match(source, /report\.breakdowns\?\.\[selection\.dimension\]/);
  assert.match(source, /report\.breakdownTotals\?\.\[selection\.dimension\]/);
  assert.doesNotMatch(source, /report\.documents/);
  assert.match(source, /report\.reconciliation\?\.ok !== true/);
  assert.match(source, /buildMultiSheetXlsx/);
  assert.match(source, /buildMatrixXlsx/);
  assert.match(source, /borders count=/);
  assert.match(source, /mergeCells count=/);
  assert.match(source, /orientation=\\"landscape\\"/);
  assert.match(source, /TỶ LỆ/);
  assert.match(source, /text\/csv; charset=utf-8/);
});

test('Route Sales export yêu cầu đồng thời quyền xem Sales và quyền export, giữ scope kho canonical', async () => {
  const route = await readApi('src/routes/reporting-sales-purchasing.js');
  assert.match(route, /\/api\/reporting\/sales-export/);
  assert.match(route, /family === 'sales-export'[\s\S]*coreReportingExport/);
  assert.match(route, /coreReportingSalesRead/);
  assert.match(route, /normalizeSalesReportingExportSelection/);
  assert.match(route, /url\.searchParams\.getAll\('column'\)/);
  assert.match(route, /validateScope/);
  assert.match(route, /createSalesReportingExport/);
  assert.match(route, /Content-Disposition/);
});

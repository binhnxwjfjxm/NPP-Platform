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
  assert.equal(valid.analysis, false);
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
});

test('Sales export phân tích nhận 2 tiêu chí, cả doanh thu và sản lượng, cùng danh sách cột đã chọn', () => {
  const selection = normalizeSalesReportingExportSelection({
    dimension: 'analysis.products.customerGroups.both',
    format: 'xlsx',
    columns: [
      'meta:name',
      'meta:unit',
      'cat:customerGroups:g1|revenue|VND',
      'cat:customerGroups:g1|quantity',
      'total:revenue:VND',
      'total:quantity',
    ],
  });
  assert.equal(selection.ok, true);
  assert.equal(selection.analysis, true);
  assert.equal(selection.matrix, false);
  assert.equal(selection.rowDimension, 'products');
  assert.equal(selection.columnDimension, 'customerGroups');
  assert.deepEqual(selection.metrics, ['revenue', 'quantity']);
  assert.deepEqual(selection.columns, [
    'meta:name',
    'meta:unit',
    'cat:customerGroups:g1|revenue|VND',
    'cat:customerGroups:g1|quantity',
    'total:revenue:VND',
    'total:quantity',
  ]);
  assert.doesNotMatch(selection.dimensionSlug, /Ma-tran/i);

  const invalidSame = normalizeSalesReportingExportSelection({
    dimension: 'analysis.products.products.both',
    format: 'xlsx',
    columns: [],
  });
  assert.equal(invalidSame.ok, false);
  assert.equal(invalidSame.code, 'INVALID_SALES_ANALYSIS_COLUMN');

  const invalidCsv = normalizeSalesReportingExportSelection({
    dimension: 'analysis.products.customerGroups.revenue',
    format: 'csv',
    columns: [],
  });
  assert.equal(invalidCsv.ok, false);
  assert.equal(invalidCsv.code, 'INVALID_SALES_ANALYSIS_FORMAT');
});

test('Phân tích sản phẩm giữ mọi ĐVT trong một sheet và xuất doanh thu + sản lượng cạnh nhau', () => {
  const selection = normalizeSalesReportingExportSelection({
    dimension: 'analysis.products.customerGroups.both',
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
      currencyCode: 'VND', productId: 'p2', productCode: 'SP2', productName: 'Sản phẩm 2', unitId: 'u2', unitCode: 'CAI', unitName: 'Cái',
      customerGroupId: 'g1', customerGroupCode: 'DL', customerGroupName: 'Đại lý', revenue: '20', quantity: '4',
    },
  ];
  const sheet = salesReportingExportInternals.buildAnalysisSheet(rows, selection, { from: '2026-09-01', to: '2026-09-17' });
  assert.equal(sheet.sheetName, 'Sản phẩm theo Loại khách');
  assert.equal(sheet.rows.length, 2);
  assert.deepEqual(sheet.rows.map((row) => row.unitName).sort((a, b) => a.localeCompare(b, 'vi')), ['Cái', 'Thùng']);
  assert.equal(sheet.categories.length, 2);
  assert.ok(sheet.columns.some((item) => item.label === 'Đại lý - Doanh thu'));
  assert.ok(sheet.columns.some((item) => item.label === 'Đại lý - Sản lượng'));
  assert.ok(sheet.columns.some((item) => item.label === 'Tổng doanh thu'));
  assert.ok(sheet.columns.some((item) => item.label === 'Tổng sản lượng'));
  assert.equal(salesReportingExportInternals.buildMatrixSheets(rows, selection, { from: '2026-09-01', to: '2026-09-17' }).length, 1);
});

test('Sản lượng ở tiêu chí không phải sản phẩm vẫn tách dòng theo ĐVT trong cùng sheet, không cộng lẫn đơn vị', () => {
  const selection = normalizeSalesReportingExportSelection({
    dimension: 'analysis.customerGroups.channels.quantity',
    format: 'xlsx',
    columns: [],
  });
  const rows = [
    {
      currencyCode: 'VND', unitId: 'u1', unitCode: 'THUNG', unitName: 'Thùng', quantity: '2', revenue: '100',
      customerGroupId: 'g1', customerGroupCode: 'DL', customerGroupName: 'Đại lý', channelId: 'c1', channelCode: 'OFF', channelName: 'Tại quầy',
    },
    {
      currencyCode: 'VND', unitId: 'u2', unitCode: 'CAI', unitName: 'Cái', quantity: '5', revenue: '50',
      customerGroupId: 'g1', customerGroupCode: 'DL', customerGroupName: 'Đại lý', channelId: 'c1', channelCode: 'OFF', channelName: 'Tại quầy',
    },
  ];
  const sheet = salesReportingExportInternals.buildAnalysisSheet(rows, selection, { from: '2026-09-01', to: '2026-09-17' });
  assert.equal(sheet.rows.length, 2);
  assert.deepEqual(sheet.rows.map((row) => row.unitName).sort((a, b) => a.localeCompare(b, 'vi')), ['Cái', 'Thùng']);
  assert.equal(sheet.quantityGrandValid, false);
});

test('Luồng matrix cũ vẫn được nhận trong thời gian chuyển frontend nhưng dùng nền xuất mới một sheet', () => {
  const legacy = normalizeSalesReportingExportSelection({
    dimension: 'matrix.products.customerGroups.revenue',
    format: 'xlsx',
    columns: [],
  });
  assert.equal(legacy.ok, true);
  assert.equal(legacy.matrix, true);
  assert.equal(legacy.analysis, true);
  assert.deepEqual(legacy.metrics, ['revenue']);
});

test('Sales export dùng dữ liệu server, đối soát trước khi xuất và workbook phân tích chỉ có một sheet', async () => {
  const source = `${await readApi('src/services/reporting-sales-export.js')}\n${await readApi('src/services/reporting-sales-export-base.js')}`;
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
  assert.match(source, /buildAnalysisXlsx/);
  assert.match(source, /borders count=/);
  assert.match(source, /mergeCells count=/);
  assert.match(source, /orientation="landscape"/);
  assert.match(source, /text\/csv; charset=utf-8/);
  assert.match(source, /ĐVT/);
});

test('Route Sales export yêu cầu đồng thời quyền xem Sales và quyền export, giữ scope kho canonical', async () => {
  const route = await readApi('src/routes/reporting-sales-purchasing.js');
  assert.match(route, /\/api\/reporting\/sales-export/);
  assert.match(route, /family === 'sales-export'[\s\S]*coreReportingExport/);
  assert.match(route, /coreReportingSalesRead/);
  assert.match(route, /normalizeSalesReportingExportSelection/);
  assert.match(route, /url\.searchParams\.getAll\('column'\)/);
  assert.match(route, /quantityDisplay: url\.searchParams\.get\('quantityDisplay'\)/);
  assert.match(route, /validateScope/);
  assert.match(route, /createSalesReportingExport/);
  assert.match(route, /Content-Disposition/);
});

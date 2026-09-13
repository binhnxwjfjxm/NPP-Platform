import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  normalizeSalesReportingExportSelection,
  salesReportingExportInternals,
} from '../src/services/reporting-sales-export.js';

const readApi = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Sales export giữ đúng 6 chiều cũ và whitelist cột theo chiều', () => {
  const valid = normalizeSalesReportingExportSelection({
    dimension: 'products',
    format: 'csv',
    columns: ['code', 'name', 'unitName', 'quantity', 'revenue', 'changePercent'],
  });
  assert.equal(valid.ok, true);
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
  const matrixSelection = normalizeSalesReportingExportSelection({
    dimension: 'productCustomerMatrix',
    format: 'xlsx',
    columns: [],
  });
  assert.equal(matrixSelection.ok, false);
  assert.equal(matrixSelection.code, 'INVALID_SALES_EXPORT_DIMENSION');
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

test('Sales export mặc định cột an toàn và không tự lấy documents giới hạn 200 dòng', async () => {
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

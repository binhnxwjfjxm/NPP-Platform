import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  normalizeSalesReportingExportSelection,
  salesReportingExportInternals,
} from '../src/services/reporting-sales-export.js';

const readApi = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Sales export chỉ nhận 6 chiều canonical, XLSX/CSV và whitelist cột theo chiều', () => {
  const valid = normalizeSalesReportingExportSelection({
    dimension: 'products',
    format: 'csv',
    columns: ['code', 'name', 'unitName', 'revenue', 'quantity', 'changePercent'],
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.dimension, 'products');
  assert.equal(valid.format, 'csv');
  assert.deepEqual(valid.columns.map((item) => item.key), ['code', 'name', 'unitName', 'revenue', 'quantity', 'changePercent']);

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
});

test('Sales export mặc định cột an toàn và không tự lấy documents giới hạn 200 dòng', async () => {
  const source = await readApi('src/services/reporting-sales-export.js');
  const selection = normalizeSalesReportingExportSelection({ dimension: 'customers', format: 'xlsx', columns: [] });
  assert.equal(selection.ok, true);
  assert.deepEqual(selection.columns.map((item) => item.key), [
    'code', 'name', 'currencyCode', 'revenue', 'documentCount', 'sharePercent', 'previousRevenue', 'changePercent',
  ]);
  assert.match(source, /report\.breakdowns\?\.\[selection\.dimension\]/);
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

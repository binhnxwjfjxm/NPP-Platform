import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  normalizeGrossMarginReportingExportSelection,
  grossMarginReportingExportInternals,
} from '../src/services/reporting-gross-margin-export.js';

const routePath = new URL('../src/routes/reporting-sales-purchasing.js', import.meta.url);
const servicePath = new URL('../src/services/reporting-gross-margin-export.js', import.meta.url);

test('Lãi gộp export whitelist nội dung, cột và định dạng', () => {
  const customers = normalizeGrossMarginReportingExportSelection({ dimension: 'customers', format: 'xlsx', columns: [] });
  assert.equal(customers.ok, true);
  assert.deepEqual(customers.columns.map((item) => item.key), ['customerCode', 'customerName', 'netRevenue', 'cogs', 'grossMargin', 'grossMarginPercent']);

  const lines = normalizeGrossMarginReportingExportSelection({ dimension: 'lines', format: 'csv', columns: ['documentNumber', 'sku', 'grossMargin'] });
  assert.equal(lines.ok, true);
  assert.equal(lines.format, 'csv');
  assert.deepEqual(lines.columns.map((item) => item.key), ['documentNumber', 'sku', 'grossMargin']);

  assert.equal(normalizeGrossMarginReportingExportSelection({ dimension: 'bad', format: 'xlsx', columns: [] }).ok, false);
  assert.equal(normalizeGrossMarginReportingExportSelection({ dimension: 'skus', format: 'pdf', columns: [] }).ok, false);
  assert.equal(normalizeGrossMarginReportingExportSelection({ dimension: 'skus', format: 'xlsx', columns: ['customerName'] }).ok, false);
});

test('Lãi gộp export giữ định dạng số chính xác và nhãn nghiệp vụ', () => {
  const row = grossMarginReportingExportInternals.formatRow({
    eventKind: 'RETURN',
    netRevenue: '-5000000.000000',
    cogs: '-3750000.5',
    grossMargin: '-1249999.5',
    grossMarginPercent: '25.0000',
    exceptionCode: 'MISSING_COST_FACT',
  });
  assert.equal(row.eventKind, 'Trả hàng');
  assert.equal(row.netRevenue, '-5,000,000');
  assert.equal(row.cogs, '-3,750,000.5');
  assert.equal(row.grossMarginPercent, '25%');
  assert.equal(row.exceptionReason, 'Chưa có dữ liệu giá vốn');
});

test('Lãi gộp export dùng cùng báo cáo canonical, xuất toàn bộ trong giới hạn và fail-closed khi lệch đối soát', async () => {
  const service = await readFile(servicePath, 'utf8');
  assert.match(service, /grossMarginReport\(/);
  assert.match(service, /MAX_EXPORT_ROWS = 100_000/);
  assert.match(service, /GROSS_MARGIN_EXPORT_TOO_LARGE/);
  assert.match(service, /GROSS_MARGIN_EXPORT_RECONCILIATION_FAILED/);
  assert.match(service, /sum\(sum\(net_revenue\)\) OVER/);
  assert.match(service, /shared\.product_variants/);
  assert.match(service, /shared\.products/);
});

test('Route lãi gộp export bắt buộc quyền xuất + quyền đọc lãi gộp', async () => {
  const route = await readFile(routePath, 'utf8');
  assert.match(route, /\/api\/reporting\/gross-margin-export/);
  assert.match(route, /family === 'gross-margin-export'/);
  assert.match(route, /coreReportingExport/);
  assert.match(route, /coreReportingGrossMarginRead/);
  assert.match(route, /normalizeGrossMarginReportingExportSelection/);
  assert.match(route, /streamGrossMarginReportingExport/);
});

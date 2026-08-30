import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { reportingSalesInternals } from '../src/routes/reporting-sales.js';

const readApi = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const readRepo = (path) => readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');

test('Báo cáo Kinh doanh dùng kỳ liền trước cùng độ dài và số thập phân chính xác', () => {
  const previous = reportingSalesInternals.previousPeriod({ from: '2026-08-10', to: '2026-08-16', fromInstant: '2026-08-09T17:00:00.000Z' });
  assert.deepEqual({ from: previous.from, to: previous.to, dayCount: previous.dayCount }, { from: '2026-08-03', to: '2026-08-09', dayCount: 7 });
  assert.equal(reportingSalesInternals.decimalText(reportingSalesInternals.decimal6('123456789012.345678')), '123456789012.345678');
  assert.equal(reportingSalesInternals.percentText(25_000_000n, 100_000_000n), '25');
});

test('contract Kinh doanh có đủ 6 chiều và không dùng người phụ trách khách làm nhân viên bán hàng', async () => {
  const source = await readApi('src/routes/reporting-sales.js');
  for (const key of ['customers', 'customerGroups', 'channels', 'products', 'productGroups', 'employees']) assert.match(source, new RegExp(`${key}: breakdown`));
  for (const field of ['previousRevenue', 'previousQuantity', 'changePercent', 'sharePercent']) assert.match(source, new RegExp(field));
  assert.match(source, /line\.line_total/);
  assert.match(source, /line\.ordered_quantity/);
  assert.match(source, /so\.source_employee_id/);
  assert.match(source, /shared\.users creator_user/);
  assert.doesNotMatch(source, /responsible_employee_id/);
  assert.match(source, /SALES_REPORT_RECONCILIATION_FAILED/);
});

test('migration 120 chỉ snapshot forward, giữ rõ legacy và nằm sau 119 trong registry', async () => {
  const [migration, registry] = await Promise.all([
    readRepo('database/migrations/sales/120_reporting_sales_dimension_snapshots.sql'),
    readApi('src/migrations/index.js'),
  ]);
  for (const field of ['customer_group_snapshot_captured', 'product_category_name_snapshot', 'unit_name_snapshot', 'reporting_dimension_snapshot_captured']) assert.match(migration, new RegExp(field));
  assert.match(migration, /OLD\.version_status = 'draft' AND NEW\.version_status = 'confirmed'/);
  assert.doesNotMatch(migration, /DISABLE TRIGGER sales_order_versions_immutable/);
  assert.doesNotMatch(migration, /UPDATE sales\.sales_order_versions\s+SET customer_group/i);
  assert.match(registry, /120_reporting_sales_dimension_snapshots\.sql/);
  assert.ok(registry.indexOf("id: '119_retail_print_agent'") < registry.indexOf("id: '120_reporting_sales_dimension_snapshots'"));
});

test('Excel và Trợ lý Công Ty dùng cùng contract Kinh doanh', async () => {
  const [exporter, assistant] = await Promise.all([
    readApi('src/services/reporting-management-export.js'),
    readApi('src/routes/admin-ai-assistant.js'),
  ]);
  assert.match(exporter, /sales\.breakdowns/);
  for (const label of ['Loại khách', 'Kênh bán', 'Nhóm hàng', 'Nhân viên']) assert.match(exporter, new RegExp(label));
  assert.match(assistant, /salesReport\(/);
  assert.match(assistant, /DỮ LIỆU KINH DOANH CANONICAL CỦA CÔNG TY/);
  assert.match(assistant, /không tự suy đoán số liệu/i);
});

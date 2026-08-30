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

test('breakdown quản trị không nhân bản kênh/nhóm theo ĐVT và chỉ giữ sản lượng ở sản phẩm', () => {
  const facts = [
    {
      period: 'current', salesOrderId: 'order-1', currencyCode: 'VND', lineTotal: '2004000', orderedQuantity: '3',
      unitId: 'unit-case', unitCode: 'THUNG', unitName: 'Thùng', customerId: 'customer-1', variantId: 'variant-a',
      salesChannelId: 'channel-horeca', salesChannelCode: 'HORECA', salesChannelName: 'Kênh Quán',
      productGroupId: null, productGroupCode: null, productGroupName: null, productGroupSource: 'legacy-unavailable',
    },
    {
      period: 'current', salesOrderId: 'order-2', currencyCode: 'VND', lineTotal: '300000', orderedQuantity: '1',
      unitId: 'unit-box', unitCode: 'HOP', unitName: 'Hộp', customerId: 'customer-2', variantId: 'variant-b',
      salesChannelId: 'channel-horeca', salesChannelCode: 'HORECA', salesChannelName: 'Kênh Quán',
      productGroupId: null, productGroupCode: null, productGroupName: null, productGroupSource: 'legacy-unavailable',
    },
  ];

  const channels = reportingSalesInternals.breakdown(facts, 'channels');
  assert.equal(channels.length, 1);
  assert.equal(channels[0].name, 'Kênh Quán');
  assert.equal(channels[0].revenue, '2304000');
  assert.equal(channels[0].quantity, '');
  assert.equal(channels[0].documentCount, '2');
  assert.equal(channels[0].customerCount, '2');
  assert.equal(channels[0].sharePercent, '100');

  const productGroups = reportingSalesInternals.breakdown(facts, 'productGroups');
  assert.equal(productGroups.length, 1);
  assert.equal(productGroups[0].name, 'Chưa phân loại');
  assert.equal(productGroups[0].productCount, '2');
  assert.equal(productGroups[0].quantity, '');

  const products = reportingSalesInternals.breakdown(facts, 'products');
  assert.equal(products.length, 2);
  assert.deepEqual(products.map((row) => [row.id, row.quantity, row.unit.name]), [
    ['variant-a', '3', 'Thùng'],
    ['variant-b', '1', 'Hộp'],
  ]);
});

test('contract Kinh doanh có đủ 6 chiều và nhân viên lấy từ đơn/người tạo', async () => {
  const source = await readApi('src/routes/reporting-sales.js');
  for (const key of ['customers', 'customerGroups', 'channels', 'products', 'productGroups', 'employees']) assert.match(source, new RegExp(`${key}: breakdown`));
  for (const field of ['previousRevenue', 'previousQuantity', 'changePercent', 'sharePercent', 'documentCount', 'customerCount', 'productCount']) assert.match(source, new RegExp(field));
  assert.match(source, /keepQuantity = key === 'products'/);
  assert.match(source, /Chưa phân loại/);
  assert.match(source, /soldProductCount/);
  assert.match(source, /line\.line_total/);
  assert.match(source, /line\.ordered_quantity/);
  assert.match(source, /so\.source_employee_id/);
  assert.match(source, /shared\.users creator_user/);
  assert.doesNotMatch(source, /responsible_employee_id/);
  assert.match(source, /SALES_REPORT_RECONCILIATION_FAILED/);
});

test('migration 120 snapshot forward và giữ rõ dữ liệu legacy', async () => {
  const [migration, registry] = await Promise.all([
    readRepo('database/migrations/sales/120_reporting_sales_dimension_snapshots.sql'),
    readApi('src/migrations/index.js'),
  ]);
  for (const field of ['customer_group_snapshot_captured', 'product_category_name_snapshot', 'unit_name_snapshot', 'reporting_dimension_snapshot_captured']) assert.match(migration, new RegExp(field));
  assert.match(migration, /OLD\.version_status = 'draft' AND NEW\.version_status = 'confirmed'/);
  assert.doesNotMatch(migration, /DISABLE TRIGGER sales_order_versions_immutable/);
  assert.match(registry, /120_reporting_sales_dimension_snapshots\.sql/);
});

test('Excel Kinh doanh dùng cùng breakdown canonical và fail-closed khi đối soát lệch', async () => {
  const exporter = await readApi('src/services/reporting-management-export.js');
  assert.match(exporter, /salesReport\(/);
  assert.match(exporter, /report\.breakdowns/);
  assert.match(exporter, /report\.reconciliation\?\.ok !== true/);
  for (const label of ['Loại khách', 'Khách hàng', 'SKU', 'Nhóm hàng', 'Kênh bán', 'Nhân viên']) assert.match(exporter, new RegExp(label));
  assert.match(exporter, /Không cộng gộp sản lượng giữa các ĐVT khác nhau/);
});

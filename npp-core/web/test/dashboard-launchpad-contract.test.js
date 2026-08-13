import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('dashboard remains an operational launchpad', () => {
  const page = source('../app/dashboard/page.tsx');
  assert.match(page, /dashboard-launchpad-page/);
  assert.match(page, /Tổng quan điều hành/);
  assert.match(page, /Truy cập nhanh/);
  assert.match(page, /DashboardOperations/);
  assert.doesNotMatch(page, /OrganizationWorkspace/);
});

test('dashboard shortcuts keep canonical business routes', () => {
  const page = source('../app/dashboard/page.tsx');
  for (const route of [
    '/management',
    '/sales/sales-orders',
    '/purchasing/purchase-orders',
    '/purchasing/goods-receipts',
    '/inventory/fulfillment',
    '/inventory/balances',
    '/inventory/delivery-orders',
    '/logistics/trips',
    '/accounting/receivables',
    '/accounting/customer-payments',
    '/sales/reporting',
    '/purchasing/reporting',
    '/inventory/reporting',
    '/logistics/reporting',
    '/accounting/aging',
  ]) assert.match(page, new RegExp(route.replaceAll('/', '\\/')));
  assert.doesNotMatch(page, /fetch\(/);
  assert.match(page, /loadOrganizationSnapshot/);
});

test('dashboard measurements reuse canonical reporting read models', () => {
  const operations = source('../app/dashboard/dashboard-operations.tsx');
  for (const endpoint of [
    '/api/reporting/sales',
    '/api/reporting/inventory',
    '/api/reporting/logistics',
    '/api/reporting/aging',
  ]) assert.match(operations, new RegExp(endpoint.replaceAll('/', '\\/')));
  assert.match(operations, /method: 'GET'/);
  assert.match(operations, /Promise\.allSettled/);
  assert.match(operations, /Giá trị đơn bán theo ngày/);
  assert.match(operations, /Giá trị tồn theo kho/);
  assert.match(operations, /Giao đủ đúng hạn/);
  assert.match(operations, /Tuổi khoản phải thu/);
  assert.doesNotMatch(operations, /Idempotency-Key/);
});

test('dashboard uses wide desktop canvas and responsive measurement cards', () => {
  const page = source('../app/dashboard/page.tsx');
  const css = source('../app/dashboard/dashboard.module.css');
  for (const metricId of ['branches', 'warehouses', 'locations']) {
    assert.match(page, new RegExp(`id: '${metricId}'`));
  }
  assert.match(css, /max-width: none/);
  assert.match(css, /repeat\(7, minmax\(0, 1fr\)\)/);
  assert.match(css, /repeat\(6, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.analyticsGrid/);
  assert.match(css, /\.activityStrip/);
  assert.match(css, /@media \(max-width: 820px\)/);
  assert.match(css, /@media \(max-width: 560px\)/);
});

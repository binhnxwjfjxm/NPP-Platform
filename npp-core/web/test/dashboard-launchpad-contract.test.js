import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Lane I dashboard is an operational launchpad instead of Organization overview reuse', () => {
  const page = source('../app/dashboard/page.tsx');

  assert.match(page, /dashboard-launchpad-page/);
  assert.match(page, /Tổng quan điều hành/);
  assert.match(page, /Lối tắt nghiệp vụ/);
  assert.doesNotMatch(page, /OrganizationWorkspace/);
  assert.doesNotMatch(page, /scope="overview"/);
});

test('Lane I shortcuts go directly to canonical business routes', () => {
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
    '/inventory/reporting',
    '/logistics/reporting',
  ]) {
    assert.match(page, new RegExp(route.replaceAll('/', '\\/')));
  }

  assert.doesNotMatch(page, /fetch\(/);
  assert.match(page, /loadOrganizationSnapshot/);
});

test('Lane I keeps compact KPI and responsive shortcut presentation', () => {
  const page = source('../app/dashboard/page.tsx');
  const css = source('../app/dashboard/dashboard.module.css');

  assert.match(page, /dashboard-metric-branches/);
  assert.match(page, /dashboard-metric-warehouses/);
  assert.match(page, /dashboard-metric-locations/);
  assert.match(css, /\.shortcutGrid/);
  assert.match(css, /repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 720px\)/);
  assert.match(css, /@media \(max-width: 420px\)/);
});

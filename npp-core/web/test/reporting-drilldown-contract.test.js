import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const boundedSearch = /\.set\('search',\s*[^;]*\.search\.trim\(\)\.slice\(0,\s*256\)\)/;

test('8.1 Sales drill-down search reaches the canonical server-side list query', () => {
  const page = source('../app/sales/sales-orders/page.tsx');
  const bootstrap = source('../lib/sales-order-bootstrap.ts');
  const gateway = source('../lib/sales-order-gateway.ts');

  assert.match(page, /searchParams/);
  assert.match(page, /loadSalesOrderBootstrap\(requestId, \{ search \}\)/);
  assert.match(bootstrap, /listSalesOrders<.*>\(normalizedRequestId, \{/s);
  assert.match(bootstrap, /search: options\.search\.trim\(\)\.slice\(0, 256\)/);
  assert.match(gateway, /ALLOWED_QUERY_KEYS.*'search'/);
  assert.match(gateway, boundedSearch);
});

test('8.1 Purchasing drill-down search is visible client state while bootstrap loads the full scoped PO list', () => {
  const page = source('../app/purchasing/purchase-orders/page.tsx');
  const workspace = source('../app/purchasing/purchase-orders/PurchaseOrderWorkspace.tsx');

  assert.match(page, /searchParams/);
  assert.match(page, /const search = firstSearch\(searchParams\?\.search\)/);
  assert.match(page, /loadPurchaseOrderBootstrap\(requestId\)/);
  assert.doesNotMatch(page, /loadPurchaseOrderBootstrap\(requestId, \{ search \}\)/);
  assert.match(page, /initialSearch=\{search\}/);
  assert.match(workspace, /initialSearch: string/);
  assert.match(workspace, /useState\(initialSearch\)/);
  assert.match(workspace, /bootstrap\.purchaseOrders\.filter/);
  assert.match(workspace, /searchable\.includes\(normalizedSearch\)/);
});

test('8.1 drill-down search is bounded and does not add a new detail route', () => {
  const salesPage = source('../app/sales/sales-orders/page.tsx');
  const purchasingPage = source('../app/purchasing/purchase-orders/page.tsx');
  assert.match(salesPage, /slice\(0, 256\)/);
  assert.match(purchasingPage, /slice\(0, 256\)/);
  assert.doesNotMatch(salesPage + purchasingPage, /\[id\]|\/detail|selectedId/);
});

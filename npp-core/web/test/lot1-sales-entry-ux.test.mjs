import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sales = readFileSync(new URL('../app/sales/sales-orders/SalesOrderCommercialForm.tsx', import.meta.url), 'utf8');
const inventory = readFileSync(new URL('../app/inventory/balances/inventory-balances-workspace.tsx', import.meta.url), 'utf8');
const globals = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

test('Công Ty scales the shared typography to 120 percent', () => {
  assert.match(globals, /html\s*\{[\s\S]*?font-size:\s*120%/);
  assert.match(globals, /body\s*\{[\s\S]*?font-size:\s*0\.875rem/);
});

test('customer lookup selects directly from the search popup', () => {
  assert.match(sales, /data-testid="sales-customer-search-input"/);
  assert.match(sales, /data-testid="sales-customer-results"/);
  assert.match(sales, /setCustomerId\(item\.id\)/);
  assert.doesNotMatch(sales, /<select value=\{customerId\}/);
});

test('a sales line SKU opens its inventory history in a new tab', () => {
  assert.match(sales, /\/inventory\/balances\?sku=\$\{encodeURIComponent\(line\.sku\)\}&warehouseId=/);
  assert.match(sales, /target="_blank"/);
  assert.match(sales, /Mở lịch sử xuất nhập tồn/);
});

test('inventory deep link resolves base or package SKU and opens warehouse history', () => {
  assert.ok(inventory.includes("searchParams.get('sku')"));
  assert.ok(inventory.includes("searchParams.get('warehouseId')"));
  assert.ok(inventory.includes('balance.package_sku'));
  assert.ok(inventory.includes('loadWarehouseHistory(candidate, 0, requestedSku)'));
  assert.ok(inventory.includes("scope: 'warehouse'"));
  assert.ok(inventory.includes("hasHistoryDeepLink ? 'history' : 'balances'"));
});

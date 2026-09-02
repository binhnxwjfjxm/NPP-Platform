import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const pagination = read('../lib/inventory-pagination.ts');
const loaders = read('../lib/inventory-list-loaders.ts');
const scopedSnapshot = read('../lib/inventory-scoped-snapshot.ts');
const balanceWorkspace = read('../app/inventory/balances/inventory-balances-workspace.tsx');
const transferPage = read('../app/inventory/transfers/page.tsx');
const stocktakePage = read('../app/inventory/stocktakes/page.tsx');
const balanceProxy = read('../app/api/inventory/balances/route.ts');
const candidateProxy = read('../app/api/inventory/tracking-policies/candidates/route.ts');
const inventoryRoute = read('../../api/src/routes/inventory-core.js');
const candidateRoute = read('../../api/src/routes/inventory-tracking-policy-candidates.js');

test('Kho loads all list pages without an artificial total-row ceiling', () => {
  assert.match(pagination, /while \(true\)/);
  assert.match(pagination, /Number\.isSafeInteger\(nextOffset\)/);
  assert.doesNotMatch(pagination, /MAX_OFFSET/);

  assert.match(loaders, /INVENTORY_BALANCE_BATCH_SIZE = 1000/);
  assert.match(loaders, /INVENTORY_REFERENCE_BATCH_SIZE = 1000/);
  assert.match(loaders, /listAllInventoryBalances/);
  assert.match(loaders, /listAllInventoryLots/);
  assert.match(loaders, /listAllInventoryTrackingPolicies/);
  assert.doesNotMatch(loaders, /MAX_OFFSET/);

  assert.match(scopedSnapshot, /async function listAllInventoryBalances/);
  assert.match(scopedSnapshot, /offset: String\(offset\)/);
  assert.doesNotMatch(scopedSnapshot, /MAX_OFFSET/);

  assert.match(balanceWorkspace, /while \(true\)/);
  assert.match(balanceWorkspace, /Number\.isSafeInteger\(nextOffset\)/);
  assert.doesNotMatch(balanceWorkspace, /INVENTORY_BALANCE_MAX_OFFSET/);
});

test('Chuyển kho and Kiểm kê use the full balance loader instead of one 1000-row page', () => {
  assert.match(transferPage, /listAllInventoryBalances\(requestId\)/);
  assert.match(stocktakePage, /listAllInventoryBalances\(requestId\)/);
  assert.doesNotMatch(transferPage, /listInventoryBalances<InventoryBalance\[\]>/);
  assert.doesNotMatch(stocktakePage, /listInventoryBalances<InventoryBalance\[\]>/);
});

test('browser proxies aggregate only when offset is omitted and preserve explicit page requests', () => {
  assert.match(balanceProxy, /searchParams\.has\('offset'\)/);
  assert.match(balanceProxy, /listAllInventoryBalances/);
  assert.match(candidateProxy, /searchParams\.has\('offset'\)/);
  assert.match(candidateProxy, /listInventoryTrackingPolicyCandidates/);
});

test('backend removes total caps only from whole-list data while keeping bounded operational history', () => {
  assert.match(inventoryRoute, /function parseOffset/);
  assert.match(inventoryRoute, /offset: parseOffset\(new URL\(`http:\/\/localhost\$\{req\.url\}`\)\.searchParams\.get\('offset'\)\)/);
  assert.match(inventoryRoute, /offset: parseOffset\(url\.searchParams\.get\('offset'\)\)/);
  assert.match(inventoryRoute, /pathname\.endsWith\('\/history'\)[\s\S]*offset: parseInteger\(url\.searchParams\.get\('offset'\), 0, 100000\)/);
  assert.match(inventoryRoute, /pathname\.endsWith\('\/drill-down'\)[\s\S]*offset: parseInteger\(url\.searchParams\.get\('offset'\), 0, 100000\)/);
  assert.match(inventoryRoute, /opening-balances'[\s\S]*offset: parseInteger\(new URL\(`http:\/\/localhost\$\{req\.url\}`\)\.searchParams\.get\('offset'\), 0, 10000\)/);

  assert.match(candidateRoute, /function parseOffset/);
  assert.match(candidateRoute, /offset: parseOffset\(url\.searchParams\.get\('offset'\)\)/);
  assert.match(candidateRoute, /limit: parseInteger\(url\.searchParams\.get\('limit'\), 500, 2000\)/);
});

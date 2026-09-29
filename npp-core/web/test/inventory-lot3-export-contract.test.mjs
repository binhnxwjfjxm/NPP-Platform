import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

const shell = read('../app/components/app-shell.tsx');
const action = read('../app/inventory/inventory-export-action.tsx');
const balances = read('../app/inventory/balances/inventory-balances-workspace.tsx');
const lots = read('../app/inventory/inventory-scoped-workspace.tsx');
const policies = read('../app/inventory/tracking-policies/tracking-policy-workspace.tsx');
const route = read('../app/api/inventory/export/route.ts');
const model = read('../lib/inventory-data-export-model.ts');

test('inventory export is owned by each workspace so it receives the live filter state', () => {
  assert.doesNotMatch(shell, /inventoryExportScope|InventoryExportAction/);
  assert.match(balances, /<InventoryExportAction[\s\S]*scope="balances"[\s\S]*search=\{activeTab === 'balances' \? search : ''\}/);
  assert.match(balances, /balanceScope=\{activeTab === 'history' && selectedBalance/);
  assert.match(balances, /warehouseId: selectedBalance\.warehouse_id/);
  assert.match(balances, /baseVariantId: selectedBalance\.base_variant_id/);
  assert.match(lots, /<InventoryExportAction scope=\{scope\} search=\{search\} \/>/);
  assert.match(policies, /<InventoryExportAction scope="tracking-policies" search=\{search\} \/>/);
});

test('export dialog uses explicit workspace filters instead of scraping the page DOM', () => {
  assert.match(action, /Excel \(\.xlsx\)/);
  assert.match(action, /CSV \(\.csv\)/);
  assert.match(action, /search\?: string/);
  assert.match(action, /balanceScope\?: InventoryBalanceExportScope/);
  assert.match(action, /query\.set\('warehouseId', balanceScope\.warehouseId\)/);
  assert.match(action, /query\.set\('baseVariantId', balanceScope\.baseVariantId\)/);
  assert.match(action, /query\.append\('column', column\)/);
  assert.match(action, /\/api\/inventory\/export/);
  assert.doesNotMatch(action, /document\.querySelector|currentPageSearch/);
  assert.doesNotMatch(action, /createTabularXlsx/);
});

test('export route scopes selected inventory history to the exact warehouse and SKU', () => {
  assert.match(route, /parseBalanceScope/);
  assert.match(route, /UUID_PATTERN/);
  assert.match(route, /sourceParams\.set\('warehouseId', balanceScope\.warehouseId\)/);
  assert.match(route, /sourceParams\.set\('baseVariantId', balanceScope\.baseVariantId\)/);
  assert.match(route, /listAllInventoryBalances\(requestId, sourceParams\)/);
  assert.match(route, /INVENTORY_EXPORT_FILTER_INVALID/);
});

test('export route uses canonical inventory reads and fails instead of truncating', () => {
  assert.match(route, /listAllInventoryBalances/);
  assert.match(route, /listAllInventoryLots/);
  assert.match(route, /listAllInventoryTrackingPolicies/);
  assert.match(route, /listInventoryTrackingPolicyCandidates/);
  assert.match(route, /MAX_EXPORT_ROWS/);
  assert.match(route, /INVENTORY_EXPORT_ROW_LIMIT_EXCEEDED/);
  assert.match(route, /createTabularXlsx/);
  assert.match(route, /guardCsvFormula/);
  assert.match(route, /export async function GET/);
});

test('selectable export columns exclude internal identifiers', () => {
  assert.match(model, /key: 'productCode'/);
  assert.match(model, /key: 'productName'/);
  assert.match(model, /key: 'baseSku'/);
  assert.match(model, /key: 'warehouseCode'/);
  assert.match(model, /key: 'onHand'/);
  assert.match(model, /key: 'supplierLotReference'/);
  assert.match(model, /key: 'setupStatus'/);
  assert.doesNotMatch(model, /key: 'installationId'/);
  assert.doesNotMatch(model, /key: 'warehouseId'/);
  assert.doesNotMatch(model, /key: 'baseVariantId'/);
  assert.doesNotMatch(model, /key: 'lotId'/);
  assert.doesNotMatch(model, /key: 'createdBy'/);
});

test('policy export includes candidates with and without stored policy', () => {
  assert.match(model, /setupStatus: policy \?/);
  assert.match(route, /policyByVariantId/);
  assert.match(route, /candidates\s*\.map/);
});

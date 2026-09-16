import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

const shell = read('../app/components/app-shell.tsx');
const action = read('../app/inventory/inventory-export-action.tsx');
const route = read('../app/api/inventory/export/route.ts');
const model = read('../lib/inventory-data-export-model.ts');

test('inventory lot 3 export stays screen-scoped without route hooks', () => {
  assert.equal((shell.match(/if \(title ===/g) ?? []).length, 3);
  assert.match(shell, /return 'balances'/);
  assert.match(shell, /return 'lots'/);
  assert.match(shell, /return 'tracking-policies'/);
  assert.match(shell, /<InventoryExportAction scope=\{exportScope\}/);
  assert.doesNotMatch(shell, /usePathname/);
  assert.doesNotMatch(shell, /\/inventory\/adjustments|\/inventory\/stocktakes/);
});

test('export dialog supports xlsx csv current search and server download', () => {
  assert.match(action, /Excel \(\.xlsx\)/);
  assert.match(action, /CSV \(\.csv\)/);
  assert.match(action, /inventory-balances-search-input/);
  assert.match(action, /inventory-lots-search-input/);
  assert.match(action, /query\.append\('column', column\)/);
  assert.match(action, /fetch\(`\/api\/inventory\/export\?\$\{query\.toString\(\)\}`/);
  assert.doesNotMatch(action, /createTabularXlsx/);
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

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const scopedSnapshot = readFileSync(new URL('../lib/inventory-scoped-snapshot.ts', import.meta.url), 'utf8');
const workspace = readFileSync(new URL('../app/inventory/balances/inventory-balances-workspace.tsx', import.meta.url), 'utf8');
const gateway = readFileSync(new URL('../lib/inventory-gateway.ts', import.meta.url), 'utf8');
const route = readFileSync(new URL('../app/api/inventory/export/route.ts', import.meta.url), 'utf8');

test('initial balances, refresh and export include products without a recorded balance', () => {
  assert.match(scopedSnapshot, /includeCatalog: 'true'/);
  assert.match(workspace, /includeCatalog=true/);
  assert.match(gateway, /'includeCatalog'/);
  assert.match(route, /listAllInventoryBalances\(requestId, new URLSearchParams\(\{ includeCatalog: 'true' \}\)\)/);
  assert.doesNotMatch(route, /\.filter\(isDisplayableInventoryBalance\)/);
});

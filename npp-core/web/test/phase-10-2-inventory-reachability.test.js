import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const workspace = source('../app/inventory/inventory-scoped-workspace.tsx');
const scopedSnapshot = source('../lib/inventory-scoped-snapshot.ts');
const candidateGateway = source('../lib/inventory-policy-candidates.ts');
const balancesPage = source('../app/inventory/balances/page.tsx');
const lotsPage = source('../app/inventory/lots/page.tsx');
const policiesPage = source('../app/inventory/tracking-policies/page.tsx');
const openingPage = source('../app/inventory/opening-balances/page.tsx');

test('10.2 inventory routes load only their own runtime surface', () => {
  assert.match(balancesPage, /loadInventoryBalancesSnapshot/);
  assert.match(lotsPage, /loadInventoryLotsSnapshot/);
  assert.match(policiesPage, /loadInventoryTrackingPolicySnapshot/);
  assert.match(openingPage, /loadInventoryOpeningBalanceSnapshot/);
  assert.doesNotMatch(balancesPage, /loadInventorySnapshot/);
  assert.doesNotMatch(lotsPage, /loadInventorySnapshot/);
  assert.doesNotMatch(policiesPage, /loadInventorySnapshot/);
  assert.doesNotMatch(openingPage, /loadInventorySnapshot/);

  const balanceLoader = scopedSnapshot.slice(
    scopedSnapshot.indexOf('export async function loadInventoryBalancesSnapshot'),
    scopedSnapshot.indexOf('export async function loadInventoryLotsSnapshot'),
  );
  const lotLoader = scopedSnapshot.slice(
    scopedSnapshot.indexOf('export async function loadInventoryLotsSnapshot'),
    scopedSnapshot.indexOf('export async function loadInventoryTrackingPolicySnapshot'),
  );
  assert.match(balanceLoader, /listInventoryBalances/);
  assert.doesNotMatch(balanceLoader, /listInventoryLots|listInventoryTrackingPolicies|listOpeningBalanceImports/);
  assert.match(lotLoader, /listInventoryLots/);
  assert.doesNotMatch(lotLoader, /listInventoryBalances|listInventoryTrackingPolicies|listOpeningBalanceImports/);
});

test('10.2 scoped workspace renders only the active inventory operation', () => {
  assert.match(workspace, /scope === 'balances'/);
  assert.match(workspace, /scope === 'lots'/);
  assert.match(workspace, /scope === 'tracking-policies'/);
  assert.match(workspace, /inventory-balances-section/);
  assert.match(workspace, /inventory-lots-section/);
  assert.match(workspace, /inventory-policies-section/);
  assert.match(workspace, /inventory-\$\{scope\}-search-input/);
  assert.doesNotMatch(workspace, /inventory-opening-section/);
});

test('10.2 tracking policy editor selects canonical SKU instead of asking for a raw UUID', () => {
  assert.match(workspace, /data-testid="inventory-policy-base-variant-select"/);
  assert.match(workspace, /<option value="">Chọn SKU<\/option>/);
  assert.match(workspace, /candidate\.base_sku/);
  assert.match(workspace, /candidate\.product_name/);
  assert.doesNotMatch(workspace, /inventory-policy-base-variant-input/);
  assert.doesNotMatch(workspace, /Nhập mã tham chiếu của SKU/);
  assert.match(candidateGateway, /\/api\/inventory\/tracking-policies\/candidates\?limit=2000/);
});

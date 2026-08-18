import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../app/inventory/adjustments/page.tsx', import.meta.url), 'utf8');
const workspace = readFileSync(new URL('../app/inventory/adjustments/workspace.tsx', import.meta.url), 'utf8');
const gateway = readFileSync(new URL('../lib/inventory-adjustment-gateway.ts', import.meta.url), 'utf8');
const route = readFileSync(new URL('../app/api/inventory/adjustments/[[...segments]]/route.ts', import.meta.url), 'utf8');
const sharedRoute = readFileSync(new URL('../app/api/inventory/_shared.ts', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../app/components/app-shell-core.tsx', import.meta.url), 'utf8');

test('adjustment screen lives under Inventory and keeps mutation actions in action rows', () => {
  assert.match(shell, /\/inventory\/adjustments/);
  assert.match(shell, /nav-inventory-adjustments/);
  assert.match(workspace, /inventory-adjustment-page-actions/);
  assert.match(workspace, /inventory-adjustment-document-actions/);
  assert.doesNotMatch(workspace, /Balance[^\n]*(button|onClick)/i);
  assert.doesNotMatch(workspace, /Ledger[^\n]*(button|onClick)/i);
  assert.match(workspace, /role="alert"/);
  assert.match(workspace, /role="status"/);
  assert.match(workspace, /createIdempotencyKey\('inventory-adjustment'\)/);
  assert.doesNotMatch(workspace, /crypto\.randomUUID\(\)/);
  assert.doesNotMatch(workspace, /Date\.now\(\)/);
});

test('web screen uses a real server gateway and catch-all proxy', () => {
  assert.match(page, /listInventoryAdjustments/);
  assert.match(page, /loadInventorySnapshot/);
  assert.match(page, /loadOrganizationSnapshot/);
  assert.match(gateway, /CORE_API_INTERNAL_URL/);
  assert.match(gateway, /requireNppWorkforceSessionToken/);
  assert.doesNotMatch(gateway, /process\.env\.CORE_API_SERVER_TOKEN/);
  assert.match(gateway, /Idempotency-Key/);
  assert.match(route, /transitionInventoryAdjustment/);
  assert.match(route, /submit.*approve.*post.*cancel.*reverse/s);
});

test('adjustment proxy preserves the domain gateway status instead of collapsing errors to 503', () => {
  assert.match(sharedRoute, /normalizeError: GatewayErrorNormalizer = normalizeInventoryGatewayError/);
  assert.match(route, /normalizeInventoryAdjustmentGatewayError/);
  assert.equal((route.match(/errorResponse\(error, requestId, normalizeInventoryAdjustmentGatewayError\)/g) ?? []).length, 2);
});

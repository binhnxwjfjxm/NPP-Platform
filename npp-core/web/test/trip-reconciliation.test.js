import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const gatewaySource = read('lib/logistics-gateway.ts');
const proxySource = read('app/api/logistics/trips/[tripId]/[action]/route.ts');
const workspaceSource = read('app/logistics/trip-reconciliation/trip-reconciliation-workspace.tsx');
const appShellSource = read('app/components/app-shell.tsx');

test('NPP gateway allows only explicit reconciliation trip actions', () => {
  assert.match(gatewaySource, /READ_ACTIONS = new Set\(\['dispatch', 'reconciliation'\]\)/);
  assert.match(gatewaySource, /'return-receipts'/);
  assert.match(gatewaySource, /'close'/);
  assert.match(gatewaySource, /CORE_API_SERVER_TOKEN/);
  assert.doesNotMatch(gatewaySource, /NEXT_PUBLIC_.*TOKEN/);
});

test('same-origin proxy preserves idempotency for reconciliation mutations', () => {
  assert.match(proxySource, /request\.headers\.get\('idempotency-key'\)/);
  assert.match(proxySource, /readJsonBody/);
  assert.match(proxySource, /transitionDeliveryTrip/);
});

test('workspace shows exact custody quantities and explicit warehouse receipt', () => {
  assert.match(workspaceSource, /Đối soát cuối chuyến/);
  assert.match(workspaceSource, /outstandingBaseQuantity/);
  assert.match(workspaceSource, /returnedBaseQuantity/);
  assert.match(workspaceSource, /\/return-receipts/);
  assert.match(workspaceSource, /\/close/);
  assert.match(workspaceSource, /Idempotency-Key/);
  assert.match(workspaceSource, /Xác nhận nhập hàng về kho/);
  assert.match(workspaceSource, /Đóng chuyến đã đối soát/);
  assert.doesNotMatch(workspaceSource, /driverId|employeeId|DATABASE_URL|CORE_API_SERVER_TOKEN/);
});

test('logistics navigation exposes reconciliation workspace', () => {
  assert.match(appShellSource, /\/logistics\/trip-reconciliation/);
  assert.match(appShellSource, /Đối soát cuối chuyến/);
  assert.match(appShellSource, /logistics-reconciliation-shortcut/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workspace = readFileSync(
  new URL('../app/inventory/costing/workspace.tsx', import.meta.url),
  'utf8',
);
const proxy = readFileSync(
  new URL('../app/api/inventory/costing/[[...segments]]/route.ts', import.meta.url),
  'utf8',
);
const gateway = readFileSync(
  new URL('../lib/inventory-costing-gateway.ts', import.meta.url),
  'utf8',
);

test('costing UI exposes period lock and operational reconciliation without generic value overwrite', () => {
  for (const marker of [
    'Kỳ giá vốn',
    'Khóa kỳ sau đối soát',
    'Chờ xử lý',
    'Điều chỉnh giá',
    'inventory-costing-period-open',
    'inventory-costing-period-close',
  ]) assert.ok(workspace.includes(marker), `missing ${marker}`);
  assert.doesNotMatch(workspace, /direct value overwrite/i);
  assert.doesNotMatch(workspace, /debit|credit journal/i);
});

test('server gateway owns period and adjustment mutations', () => {
  assert.match(proxy, /periods.*open/s);
  assert.match(proxy, /periods.*close/s);
  assert.match(proxy, /adjustments/);
  assert.match(gateway, /openInventoryCostingPeriod/);
  assert.match(gateway, /closeInventoryCostingPeriod/);
  assert.match(gateway, /createInventoryCostAdjustment/);
  assert.match(gateway, /requireNppWorkforceSessionToken/);
  assert.doesNotMatch(gateway, /process\.env\.CORE_API_SERVER_TOKEN/);
});

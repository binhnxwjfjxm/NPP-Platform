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
const shell = readFileSync(
  new URL('../app/components/app-shell-core.tsx', import.meta.url),
  'utf8',
);

test('costing workspace exposes rebuild and drill-down tabs', () => {
  assert.match(workspace, /Dựng lại giá vốn/);
  assert.match(workspace, /Số dư giá vốn/);
  assert.match(workspace, /Đối soát/);
  assert.match(workspace, /Bất thường/);
  assert.match(workspace, /Cost facts/);
  assert.match(workspace, /MWA_V1/);
  assert.match(workspace, /idempotency-key/i);
  assert.doesNotMatch(workspace, /inventory_balances/);
});

test('costing gateway is server-owned and menu is separate from balance mutation', () => {
  assert.match(proxy, /inventory-costing-gateway/);
  assert.match(proxy, /rebuild/);
  assert.match(shell, /nav-inventory-costing/);
  assert.match(shell, /Giá vốn tồn kho/);
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), 'utf8');

test('opening balance UI selects a canonical warehouse and imports business-readable SKU/location codes', async () => {
  const [workspace, route, gateway] = await Promise.all([
    readSource('../app/inventory/opening-balances/opening-balance-csv-workspace.tsx'),
    readSource('../app/api/inventory/opening-balances/operator/[action]/route.ts'),
    readSource('../lib/opening-balance-operator-gateway.ts'),
  ]);

  assert.match(workspace, /inventory-opening-warehouse-select/);
  assert.match(workspace, /inventory-opening-location-select/);
  assert.match(workspace, /\{ key: 'sku', label: 'SKU' \}/);
  assert.match(workspace, /\{ key: 'locationCode', label: 'Vị trí' \}/);
  assert.doesNotMatch(workspace, /\{ key: 'warehouseId', label: 'Mã kho' \}/);
  assert.doesNotMatch(workspace, /\{ key: 'sourceVariantId', label: 'Mã tham chiếu SKU' \}/);
  assert.match(workspace, /opening-balances\/operator\/validate/);
  assert.match(workspace, /opening-balances\/operator\/post/);
  assert.match(workspace, /Nhân viên chỉ dùng SKU và mã vị trí, không cần biết ID hệ thống/);
  assert.match(route, /listOpeningBalanceOperatorWarehouses/);
  assert.match(route, /postOpeningBalanceOperator/);
  assert.match(gateway, /REQUEST_TIMEOUT_MS = 30_000/);
  assert.match(gateway, /requireNppWorkforceSessionToken/);
});

test('sales order gateway allows the Core confirmation transaction to finish without an 8-second proxy abort', async () => {
  const source = await readSource('../lib/sales-order-gateway.ts');
  assert.match(source, /REQUEST_TIMEOUT_MS=30_000/);
  assert.doesNotMatch(source, /REQUEST_TIMEOUT_MS=8_000/);
  assert.match(source, /Idempotency-Key/);
});

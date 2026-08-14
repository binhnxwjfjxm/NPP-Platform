import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), 'utf8');

test('Issue #497 C1 distinguishes unknown, stale and authoritative empty purchase-order states', async () => {
  const workspace = await readSource('../app/purchasing/purchase-orders/PurchaseOrderWorkspace.tsx');

  assert.match(workspace, /type OrderListState = 'fresh' \| 'stale' \| 'unknown'/);
  assert.match(workspace, /initialBootstrap\.errors\.orders \? 'unknown' : 'fresh'/);
  assert.match(workspace, /purchaseOrders: next\.errors\.orders \? current\.purchaseOrders : next\.purchaseOrders/);
  assert.match(workspace, /current === 'unknown' \? 'unknown' : 'stale'/);
  assert.match(workspace, /data-testid="purchase-order-data-state-banner"/);
  assert.match(workspace, /data-testid="purchase-order-total-count"/);
  assert.match(workspace, /const countValue = .*: '—'/);
  assert.match(workspace, /data-testid="purchase-order-list-unavailable"/);
  assert.match(workspace, /orderListState === 'fresh' \|\| bootstrap\.purchaseOrders\.length > 0/);
});

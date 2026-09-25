import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workspace = readFileSync(new URL('../app/retail-workspace.tsx', import.meta.url), 'utf8');
const retailRoute = readFileSync(new URL('../app/api/retail/[...segments]/route.ts', import.meta.url), 'utf8');
const salesRoute = readFileSync(new URL('../../../npp-core/api/src/routes/sales-orders.js', import.meta.url), 'utf8');
const legacy = readFileSync(new URL('../../../npp-core/api/src/services/sales-order-legacy.js', import.meta.url), 'utf8');
const repository = readFileSync(new URL('../../../npp-core/api/src/db/repositories/sales-order.js', import.meta.url), 'utf8');

test('Retail order history is pickup-only at the server boundary', () => {
  assert.match(retailRoute, /sales-orders\?deliveryMode=PICKUP&limit=101&offset=0/);
  assert.match(retailRoute, /deliveryMode=PICKUP/);
  assert.match(salesRoute, /deliveryMode: url\.searchParams\.get\('deliveryMode'\)/);
  assert.match(legacy, /DELIVERY_MODES\.has\(deliveryMode\)/);
  assert.match(repository, /so\.delivery_mode = \$\$\{params\.length\}/);
});

test('Retail order history is newest-first and can page through older pickup orders', () => {
  assert.match(repository, /ORDER BY so\.created_at DESC, so\.id DESC LIMIT/);
  assert.match(workspace, /const ORDER_VISIBLE_STEP = 30/);
  assert.match(workspace, /const ORDER_BATCH_SIZE = 100/);
  assert.match(workspace, /offset=\$\{orders\.length\}/);
  assert.match(workspace, /setOrdersHasMore\(page\.length > ORDER_BATCH_SIZE\)/);
  assert.match(workspace, /filteredOrders\.slice\(0, orderVisibleCount\)/);
  assert.match(workspace, /Xem thêm đơn hàng/);
  assert.match(workspace, /Date\.parse\(right\.createdAt\) - Date\.parse\(left\.createdAt\)/);
});

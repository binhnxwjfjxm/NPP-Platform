import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const listPage = read('app/picking/page.tsx');
const orderPage = read('app/picking/orders/[salesOrderId]/page.tsx');
const panel = read('app/picking/[demandId]/pick-allocation-panel.tsx');
const reversalRoute = read('app/api/picking/[allocationId]/reversal/route.ts');
const api = read('lib/fulfillment-api.ts');
const css = read('app/picking/picking.module.css');

test('Lane E list is an order-level mobile surface with progress and shortage count', () => {
  assert.match(listPage, /data-testid="picking-order-card"/);
  assert.match(listPage, /Mở soạn hàng/);
  assert.match(listPage, /\/picking\/orders\/\$\{encodeURIComponent\(first\.salesOrderId\)\}/);
  assert.match(listPage, /closeState\.shortageCount/);
  assert.match(listPage, /progressTrack/);
  assert.match(listPage, /Số mã/);
  assert.match(listPage, /Thiếu/);
});

test('Lane E order detail shows every item and canonical allocation detail', () => {
  assert.match(orderPage, /listPickingWork\(user\)/);
  assert.match(orderPage, /line\.salesOrderId === params\.salesOrderId/);
  assert.match(orderPage, /Promise\.all\(orderLines\.map/);
  assert.match(orderPage, /data-testid="picking-item-card"/);
  assert.match(orderPage, /Cần soạn/);
  assert.match(orderPage, /Đã soạn/);
  assert.match(orderPage, /Còn lại/);
  assert.match(orderPage, /detail\.allocations\.map/);
  assert.match(orderPage, /alternativeSources/);
});

test('Lane E moves detailed mutations into a mobile bottom sheet', () => {
  assert.match(panel, /type SheetMode = 'pick' \| 'shortage' \| 'reverse' \| null/);
  assert.match(panel, /role="dialog"/);
  assert.match(panel, /SOẠN ĐỦ/);
  assert.match(panel, /SOẠN TIẾP/);
  assert.match(panel, /THIẾU/);
  assert.match(panel, /HOÀN/);
  assert.match(panel, /Lý do chênh lệch \/ thiếu/);
  assert.match(panel, /Lý do HOÀN/);
  assert.doesNotMatch(panel, /shortageOpen/);
  assert.match(css, /\.sheetBackdrop\s*\{[^}]*position:\s*fixed/s);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
});

test('Lane E HOÀN uses Lane D reverse-pick contract and canonical idempotency reuse', () => {
  assert.match(api, /fulfillment-allocations\/\$\{encodeURIComponent\(allocationId\)\}\/reverse-pick/);
  assert.match(reversalRoute, /reversePickFulfillmentAllocation/);
  assert.match(reversalRoute, /canPickWithWarehouse/);
  assert.match(reversalRoute, /typeof payload\.reason !== 'string'/);
  assert.match(panel, /createIdempotencyKey\('fulfillment-pick-reversal'\)/);
  assert.match(panel, /operation: 'pick-reversal'/);
  assert.match(panel, /pendingByFingerprint\.current\.get\(fingerprint\)/);
  assert.match(panel, /pendingByFingerprint\.current\.delete\(fingerprint\)/);
  assert.match(panel, /reversiblePickQuantity/);
  assert.match(panel, /packedBaseQuantity/);
});

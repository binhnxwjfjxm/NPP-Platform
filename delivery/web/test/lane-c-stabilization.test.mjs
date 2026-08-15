import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const panel = read('app/picking/[demandId]/pick-allocation-panel.tsx');
const closePanel = read('app/picking/[demandId]/picking-close-panel.tsx');
const detail = read('app/picking/[demandId]/page.tsx');
const shortageProxy = read('app/api/picking/[allocationId]/shortage/route.ts');
const closeProxy = read('app/api/picking/orders/[salesOrderId]/close/route.ts');
const api = read('lib/fulfillment-api.ts');

test('Lane C1 keeps SOẠN ĐỦ on canonical Core pick mutation', () => {
  assert.match(panel, />SOẠN ĐỦ</);
  assert.match(panel, /createIdempotencyKey\('fulfillment-pick'\)/);
  assert.match(panel, /fullPickByFingerprint/);
  assert.match(api, /fulfillment-allocations.*\/pick/s);
});

test('Lane C2 records fulfillment shortage and inventory observation as separate fields without balance adjustment', () => {
  assert.match(panel, /Số lượng thực lấy/);
  assert.match(panel, /Tồn thực tế quan sát tại vị trí\/lô/);
  assert.match(panel, /Lý do thiếu \/ chênh lệch/);
  assert.match(panel, /createIdempotencyKey\('fulfillment-shortage'\)/);
  assert.match(panel, /shortageByFingerprint/);
  assert.match(shortageProxy, /actualPickedQuantity/);
  assert.match(shortageProxy, /observedQuantity/);
  assert.match(api, /\/shortage/);
  assert.doesNotMatch(panel, /inventory_balances/);
});

test('Lane C3 surfaces another valid source instead of declaring backorder while stock remains', () => {
  assert.match(detail, /alternativeSources/);
  assert.match(panel, /Nguồn khác còn hợp lệ/);
  assert.match(panel, /Lấy tiếp từ/);
});

test('Lane C4 exposes only server-authorized FULL or PARTIAL close and reuses canonical idempotency by mode', () => {
  assert.match(closePanel, /canCloseFull/);
  assert.match(closePanel, /canClosePartial/);
  assert.match(closePanel, /CHỐT SOẠN XONG/);
  assert.match(closePanel, /CHỐT PHẦN ĐÃ SOẠN/);
  assert.match(closePanel, /createIdempotencyKey\('fulfillment-pick-close'\)/);
  assert.match(closePanel, /pendingByMode/);
  assert.match(closeProxy, /FULL.*PARTIAL/s);
  assert.match(api, /picking-close-state/);
  assert.match(api, /picking-close/);
});

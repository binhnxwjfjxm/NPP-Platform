import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const laneA = read('./lane-a-stabilization.test.mjs');
const laneB = read('./lane-b-stabilization.test.mjs');
const laneC = read('./lane-c-stabilization.test.mjs');
const laneE = read('./lane-e-picking-ui.test.mjs');
const phoneSnapshot = read('../../../npp-core/api/test/delivery-customer-address-snapshot-contract.test.js');
const shortage = read('../../../npp-core/api/test/sales-fulfillment-shortage.test.js');
const reversal = read('../../../npp-core/api/test/sales-fulfillment-reversal.test.js');
const postgresFulfillment = read('../../../npp-core/api/test/sales-fulfillment-operations-integration.test.js');

// Lane F is a regression gate only. It does not introduce another source of truth.
test('Lane F locks Delivery shell, COD custody, canonical idempotency and branding regressions', () => {
  assert.match(laneA, /Navigation cố định|fixed app nav|route-dependent|Soạn hàng/s);
  assert.match(laneA, /custody|Tiền đang giữ/s);
  assert.match(laneA, /delivery-cod-handover/);
  assert.match(laneA, /createIdempotencyKey/);
  assert.match(laneA, /branding|PWA|logo/i);
});

test('Lane F locks immutable customer phone snapshot with and without address id', () => {
  assert.match(phoneSnapshot, /customerPhone/);
  assert.match(phoneSnapshot, /customer_address_id|customerAddressId/);
  assert.match(phoneSnapshot, /independent|không phụ thuộc|without address/i);
  assert.match(phoneSnapshot, /snapshot/i);
  assert.doesNotMatch(phoneSnapshot, /driver.*JOIN\s+shared\.customers/is);
});

test('Lane F locks canonical picking full, shortage, alternative source, close and mobile UI', () => {
  assert.match(laneB, /core\.fulfillment\.pick/);
  assert.match(laneB, /warehouse/i);
  assert.match(laneC, /SOẠN ĐỦ/);
  assert.match(laneC, /THIẾU/);
  assert.match(laneC, /Nguồn khác còn hợp lệ|alternative/i);
  assert.match(laneC, /CHỐT SOẠN XONG/);
  assert.match(laneC, /CHỐT PHẦN ĐÃ SOẠN/);
  assert.match(shortage, /inventory_discrepancy_observations/);
  assert.match(shortage, /doesNotMatch\(service, \/UPDATE/);
  assert.match(shortage, /doesNotMatch\(repository, \/UPDATE/);
  assert.match(laneE, /Mở soạn hàng/);
  assert.match(laneE, /SOẠN TIẾP/);
  assert.match(laneE, /HOÀN/);
  assert.match(laneE, /bottom sheet|bottomSheet|sheet/i);
});

test('Lane F locks append-only reversal and downstream unwind contracts', () => {
  assert.match(reversal, /PICK_REVERSED/);
  assert.match(reversal, /PACK_REVERSED/);
  assert.match(reversal, /reverse-pick|reverse.*pick/s);
  assert.match(reversal, /reverse-pack|reverse.*pack/s);
  assert.match(reversal, /reverse.*order|fulfillment-orders.*reverse/s);
  assert.match(reversal, /RELEASED_FOR_REVERSAL/);
  assert.match(reversal, /DISPATCH_RECOVERED/);
  assert.match(reversal, /PICK_REVERSAL_BLOCKED_BY_PACK|Pack.*Pick|Delivery.*Pack.*Pick/s);
  assert.match(reversal, /Idempotency|idempotency/);
});

test('Lane F requires real PostgreSQL fulfillment mutation/read-model regression', () => {
  assert.match(postgresFulfillment, /getPool\(config\)/);
  assert.match(postgresFulfillment, /startServer\(\{ config \}\)/);
  assert.match(postgresFulfillment, /\/api\/inventory\/fulfillment-work/);
  assert.match(postgresFulfillment, /fulfillment-demands.*allocate/s);
  assert.match(postgresFulfillment, /fulfillment-allocations.*pick/s);
  assert.match(postgresFulfillment, /fulfillment-allocations.*pack/s);
  assert.match(postgresFulfillment, /sales_order_fulfillment_allocation_events/);
  assert.match(postgresFulfillment, /shared\.core_audit_records/);
  assert.match(postgresFulfillment, /shared\.core_outbox_events/);
  assert.match(postgresFulfillment, /PACK_EXCEEDS_PICKED/);
  assert.match(postgresFulfillment, /PICK_EXCEEDS_ALLOCATION/);
});

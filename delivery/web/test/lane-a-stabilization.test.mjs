import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const frame = read('app/DeliveryAppFrame.tsx');
const layout = read('app/layout.tsx');
const middleware = read('middleware.ts');
const capabilities = read('lib/delivery-capabilities.ts');
const custodyPage = read('app/custody/page.tsx');
const handover = read('app/trips/[tripId]/cod-handover-panel.tsx');

test('Lane A1 derives navigation capabilities from trusted Core /me permissions and warehouse scope', () => {
  assert.match(middleware, /core\.delivery-trip\.driver-read/);
  assert.match(middleware, /core\.cod-collection\.read/);
  assert.match(middleware, /core\.cod-collection\.record/);
  assert.match(middleware, /core\.cod-handover\.create/);
  assert.match(middleware, /core\.fulfillment\.pick/);
  assert.match(middleware, /warehouseIds\.length > 0/);
  assert.match(middleware, /applyCapabilityHeaders/);
  assert.match(middleware, /headers\.delete\(name\)/);
  assert.match(layout, /deliveryCapabilitiesFromHeaders\(headers\(\)\)/);
  assert.match(capabilities, /canPickWithWarehouse/);
});

test('Lane A1 keeps real app-level dock destinations and synchronization in the top bar', () => {
  assert.match(frame, /href="\/" icon="route" label="Chuyến"/);
  assert.match(frame, /href="\/custody" icon="wallet" label="Tiền đang giữ"/);
  assert.match(frame, /<span>Tài khoản<\/span>/);
  assert.match(frame, /aria-label="Đồng bộ dữ liệu"/);
  assert.doesNotMatch(frame, /href=\{onTrip \? '#route-section'/);
  assert.doesNotMatch(frame, /#cod-section|#active-trip|#delivery-guide/);
});

test('Lane A2 exposes canonical custody through a real app route and bottom sheet backed by Core COD overview', () => {
  assert.match(custodyPage, /getMyCodOverview/);
  assert.match(custodyPage, /canViewCustody/);
  assert.match(custodyPage, /CodHandoverPanel/);
  assert.match(handover, /overview\.trip\.custodyTotal/);
  assert.match(handover, />Tiền đang giữ</);
  assert.match(handover, /role="dialog"/);
  assert.match(handover, /Lịch sử bàn giao/);
  assert.doesNotMatch(handover, /amountDue/);
});

test('Lane A3 uses canonical idempotency and reuses the exact key and serialized body for the same logical retry', () => {
  assert.match(handover, /createIdempotencyKey\('cod-handover'\)/);
  assert.match(handover, /const fingerprint = JSON\.stringify\(logicalPayload\)/);
  assert.match(handover, /pendingRef\.current/);
  assert.match(handover, /'Idempotency-Key': pending\.key/);
  assert.match(handover, /body: pending\.body/);
  assert.doesNotMatch(handover, /cod-handover-\$\{|crypto\.randomUUID/);
});

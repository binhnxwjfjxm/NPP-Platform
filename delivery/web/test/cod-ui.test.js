import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

test('Delivery COD UI keeps collection and handover in the driver trip boundary', () => {
  const page = read('../app/trips/[tripId]/page.tsx');
  const collection = read('../app/trips/[tripId]/cod-collection-panel.tsx');
  const handover = read('../app/trips/[tripId]/cod-handover-panel.tsx');
  assert.match(page, /getMyCodOverview/);
  assert.match(page, /Delivery không sửa công nợ trực tiếp/);
  assert.match(collection, /COLLECT_ON_DELIVERY/);
  assert.match(collection, /Xác nhận tiền COD/);
  assert.match(handover, /Lập bàn giao COD/);
  assert.match(handover, /Idempotency-Key/);
});

test('Delivery proxy derives driver identity server-side', () => {
  const collectionRoute = read('../app/api/trips/[tripId]/assignments/[assignmentId]/cod-collections/route.ts');
  const handoverRoute = read('../app/api/trips/[tripId]/cod-handovers/route.ts');
  assert.match(collectionRoute, /authenticateDeliveryUser/);
  assert.match(collectionRoute, /UNTRUSTED_DRIVER_IDENTITY/);
  assert.match(handoverRoute, /authenticateDeliveryUser/);
  assert.match(handoverRoute, /Idempotency-Key/i);
});

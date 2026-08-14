import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const pageSource = read('app/trips/[tripId]/page.tsx');
const presentationSource = read('lib/presentation.ts');
const actionSource = read('app/trips/[tripId]/customer-stop-actions.tsx');
const mediaRouteSource = read('app/api/trips/[tripId]/customers/[customerId]/media/route.ts');
const coreApiSource = read('lib/core-api.ts');
const attemptSource = read('app/trips/[tripId]/delivery-attempt-panel.tsx');

test('Delivery stop workspace keeps immutable phone/location snapshot visible without leaking coordinate fields', () => {
  assert.match(pageSource, /customerPhoneFromSnapshot\(stop\.address\)/);
  assert.match(pageSource, /locationUrlFromSnapshot\(stop\.address\)/);
  assert.match(presentationSource, /address\?\.customerPhone/);
  assert.match(presentationSource, /address\?\.locationUrl/);
  assert.match(presentationSource, /parsed\.protocol !== 'https:'/);
  assert.match(actionSource, /href=\{`tel:\$\{phone\}`\}/);
  assert.match(actionSource, /href=\{locationUrl\}/);
  assert.doesNotMatch(pageSource + actionSource, /latitude|longitude|gpsLatitude|gpsLongitude/i);
  assert.doesNotMatch(pageSource, /Điểm giao đang ưu tiên ở phía trên/);
});

test('Missing phone/location/photo stays non-blocking and customer photos load only after explicit click', () => {
  assert.match(actionSource, /Chưa có SĐT/);
  assert.match(actionSource, /Chưa có định vị/);
  assert.match(actionSource, />Xem ảnh khách<\/button>/);
  assert.match(actionSource, /async function openMedia/);
  assert.match(actionSource, /fetch\([\s\S]*\/customers\/\$\{encodeURIComponent\(customerId\)\}\/media/);
  assert.match(actionSource, /body\.data\.media\.slice\(0, 3\)/);
  assert.match(actionSource, /Vẫn có thể tiếp tục giao hàng bình thường/);
  assert.doesNotMatch(pageSource, /<img/);
});

test('Delivery photo read stays behind same-origin and driver-scoped Core trip path', () => {
  assert.match(mediaRouteSource, /authenticateDeliveryUser/);
  assert.match(mediaRouteSource, /getMyCustomerMedia/);
  assert.match(coreApiSource, /\/api\/logistics\/driver\/trips\/\$\{encodeURIComponent\(tripId\)\}\/customers\/\$\{encodeURIComponent\(customerId\)\}\/media/);
  assert.match(coreApiSource, /cache: 'no-store'/);
  assert.doesNotMatch(actionSource, /CORE_API_INTERNAL_URL|requireDeliverySessionToken|shared\.customer_media/);
});

test('Delivery order card exposes human labels, goods before attempt and read-only order details', () => {
  assert.match(pageSource, /formatCollectionPolicy\(assignment\.collectionPolicy\)/);
  assert.doesNotMatch(pageSource, /<dd>\{assignment\.collectionPolicy/);
  assert.match(pageSource, /assignment\.lines\.length/);
  assert.match(pageSource, /Xem chi tiết đơn/);
  assert.match(pageSource, /formatQuantity\(line\.issuedBaseQuantity\)/);
  assert.match(attemptSource, /<summary>Ghi kết quả giao<\/summary>/);
});

test('Touched attempt mutation uses shared canonical idempotency generator and reuses the key by operation signature', () => {
  assert.match(attemptSource, /import \{ createIdempotencyKey \} from '@npp\/contracts'/);
  assert.match(attemptSource, /createIdempotencyKey\('delivery-attempt'\)/);
  assert.match(attemptSource, /keys\.current\.get\(signature\)/);
  assert.match(attemptSource, /keys\.current\.set\(signature, next\)/);
  assert.doesNotMatch(attemptSource, /`delivery-attempt-\$\{crypto\.randomUUID\(\)\}`/);
});

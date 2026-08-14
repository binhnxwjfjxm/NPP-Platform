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
const detailSource = read('app/trips/[tripId]/delivery-order-detail-dialog.tsx');
const dialogSource = read('app/trips/[tripId]/mobile-action-dialog.tsx');

test('Delivery stop workspace keeps immutable phone/location snapshot available without leaking coordinate fields', () => {
  assert.match(pageSource, /customerPhoneFromSnapshot\(stop\.address\)/);
  assert.match(pageSource, /locationUrlFromSnapshot\(stop\.address\)/);
  assert.match(presentationSource, /address\?\.customerPhone/);
  assert.match(presentationSource, /address\?\.locationUrl/);
  assert.match(presentationSource, /parsed\.protocol !== 'https:'/);
  assert.match(actionSource, /href=\{`tel:\$\{phone\}`\}/);
  assert.match(actionSource, /href=\{locationUrl\}/);
  assert.doesNotMatch(pageSource + actionSource, /latitude|longitude|gpsLatitude|gpsLongitude/i);
});

test('Customer actions are compact and open in one popup; photos still load only after explicit click', () => {
  assert.match(actionSource, />Thao tác<\/button>/);
  assert.match(actionSource, /MobileActionDialog/);
  assert.match(actionSource, /Chưa có SĐT/);
  assert.match(actionSource, /Chưa có định vị/);
  assert.match(actionSource, />Xem ảnh khách<\/button>/);
  assert.match(actionSource, /async function openMedia/);
  assert.match(actionSource, /fetch\([\s\S]*\/customers\/\$\{encodeURIComponent\(customerId\)\}\/media/);
  assert.match(actionSource, /body\.data\.media\.slice\(0, 3\)/);
  assert.match(actionSource, /Vẫn có thể tiếp tục giao hàng bình thường/);
  assert.match(dialogSource, /createPortal/);
  assert.match(dialogSource, /role="dialog"/);
  assert.doesNotMatch(pageSource, /<img/);
});

test('Delivery photo read stays behind same-origin and driver-scoped Core trip path', () => {
  assert.match(mediaRouteSource, /authenticateDeliveryUser/);
  assert.match(mediaRouteSource, /getMyCustomerMedia/);
  assert.match(coreApiSource, /\/api\/logistics\/driver\/trips\/\$\{encodeURIComponent\(tripId\)\}\/customers\/\$\{encodeURIComponent\(customerId\)\}\/media/);
  assert.match(coreApiSource, /cache: 'no-store'/);
  assert.doesNotMatch(actionSource, /CORE_API_INTERNAL_URL|requireDeliverySessionToken|shared\.customer_media/);
});

test('Delivery order card exposes value and opens MCP-style read-only order details instead of expanding inline', () => {
  assert.match(pageSource, /formatCollectionPolicy\(assignment\.collectionPolicy\)/);
  assert.match(pageSource, /Giá trị đơn/);
  assert.match(pageSource, /assignment\.totalAmount/);
  assert.match(pageSource, /DeliveryOrderDetailDialog/);
  assert.doesNotMatch(pageSource, /<summary>Xem chi tiết đơn<\/summary>/);
  assert.match(detailSource, /MobileActionDialog/);
  assert.match(detailSource, /line\.issuedUnitQuantity/);
  assert.match(detailSource, /line\.unitPrice/);
  assert.match(detailSource, /line\.lineAmount/);
  assert.match(detailSource, /chỉ đọc để tài xế đối chiếu/);
});

test('Delivery attempt workflow opens in popup so the stop card stays compact', () => {
  assert.match(attemptSource, /MobileActionDialog/);
  assert.match(attemptSource, />Ghi giao<\/button>/);
  assert.doesNotMatch(attemptSource, /<summary>Ghi kết quả giao<\/summary>/);
  assert.match(attemptSource, /attempt-form-/);
  assert.match(attemptSource, /attempt-recorded-/);
});

test('Touched attempt mutation uses shared canonical idempotency generator and reuses the key by operation signature', () => {
  assert.match(attemptSource, /import \{ createIdempotencyKey \} from '@npp\/contracts'/);
  assert.match(attemptSource, /createIdempotencyKey\('delivery-attempt'\)/);
  assert.match(attemptSource, /keys\.current\.get\(signature\)/);
  assert.match(attemptSource, /keys\.current\.set\(signature, next\)/);
  assert.doesNotMatch(attemptSource, /`delivery-attempt-\$\{crypto\.randomUUID\(\)\}`/);
});

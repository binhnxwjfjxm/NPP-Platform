import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const frame = read('app/DeliveryAppFrame.tsx');
const middleware = read('middleware.ts');
const pickingPage = read('app/picking/page.tsx');
const pickingDetail = read('app/picking/[demandId]/page.tsx');
const pickingPanel = read('app/picking/[demandId]/pick-allocation-panel.tsx');
const pickingRoute = read('app/api/picking/[allocationId]/route.ts');
const fulfillmentApi = read('lib/fulfillment-api.ts');
const coreFulfillment = read('../../npp-core/api/src/services/sales-fulfillment-operations.js');
const coreRoute = read('../../npp-core/api/src/routes/fulfillment-operations.js');

test('Lane B1 renders Soạn hàng from pick permission plus warehouse-scoped capability', () => {
  assert.match(middleware, /pickFulfillment: 'core\.fulfillment\.pick'/);
  assert.doesNotMatch(middleware, /readFulfillment: 'core\.fulfillment\.read'/);
  assert.match(
    middleware,
    /permissions\.has\(CORE_PERMISSIONS\.pickFulfillment\)\s*&&\s*warehouseIds\.length > 0/,
  );
  assert.match(frame, /capabilities\.canPickWithWarehouse/);
  assert.match(frame, /href="\/picking" icon="box" label="Soạn hàng"/);
  assert.match(pickingPage, /!capabilities\.canPickWithWarehouse/);
});

test('Lane B2 reads canonical Core Fulfillment work instead of creating Delivery picking state', () => {
  assert.match(fulfillmentApi, /\/api\/inventory\/fulfillment-work\?limit=200&offset=0/);
  assert.match(pickingPage, /listPickingWork\(user\)/);
  assert.match(pickingPage, /orderNumber/);
  assert.match(pickingPage, /customerName/);
  assert.match(pickingPage, /warehouseName/);
  assert.match(pickingPage, /Mở soạn hàng/);
  assert.doesNotMatch(fulfillmentApi, /INSERT INTO|CREATE TABLE|picking_status/i);
});

test('Lane B3 uses canonical demand/allocation detail and pick mutation', () => {
  assert.match(fulfillmentApi, /fulfillment-demands\/\$\{encodeURIComponent\(demandId\)\}\/suggestions/);
  assert.match(fulfillmentApi, /fulfillment-allocations\/\$\{encodeURIComponent\(allocationId\)\}\/pick/);
  assert.match(pickingDetail, /detail\.allocations|allocations\.map/);
  assert.match(pickingPanel, /locationCode/);
  assert.match(pickingPanel, /lotCode/);
  assert.match(pickingPanel, /allocatedBaseQuantity/);
  assert.match(pickingPanel, /pickedBaseQuantity/);
  assert.match(pickingPanel, /Lý do chênh lệch/);
  assert.match(pickingDetail, /state machine canonical/);
});

test('Lane B4 keeps warehouse authorization server-side and lets pick permission read its own picking workflow', () => {
  assert.match(coreFulfillment, /warehouseIds\.filter/);
  assert.match(coreFulfillment, /WAREHOUSE_SCOPE_DENIED/);
  assert.match(coreFulfillment, /warehouseAllowed\(requestContext, demand\.warehouse_id\)/);
  assert.match(coreFulfillment, /warehouseAllowed\(requestContext, allocation\.warehouse_id\)/);
  assert.match(coreRoute, /coreFulfillmentPick/);
  assert.match(coreRoute, /coreFulfillmentRead/);
  assert.match(coreRoute, /Array\.isArray\(permission\)/);
  assert.match(pickingRoute, /canPickWithWarehouse/);
});

test('Lane B writes use canonical idempotency and exact key/body reuse per logical pick payload', () => {
  assert.match(pickingPanel, /createIdempotencyKey\('fulfillment-pick'\)/);
  assert.match(pickingPanel, /const fingerprint = JSON\.stringify/);
  assert.match(pickingPanel, /pendingByFingerprint\.current\.get\(fingerprint\)/);
  assert.match(pickingPanel, /pendingByFingerprint\.current\.set\(fingerprint, pending\)/);
  assert.match(pickingPanel, /'Idempotency-Key': pending\.key/);
  assert.match(pickingPanel, /body: pending\.body/);
  assert.match(fulfillmentApi, /normalizeIdempotencyKey/);
  assert.match(fulfillmentApi, /isValidIdempotencyKey/);
  assert.doesNotMatch(pickingPanel, /fulfillment-pick-\$\{|crypto\.randomUUID/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CORE_API_MIGRATIONS } from '../src/migrations/index.js';
import { isKnownPermissionKey, PERMISSIONS } from '../src/access/permissions.js';
import { dispatchDeliveryTrip } from '../src/services/logistics-trip-dispatch.js';

const migrationSource = readFileSync(
  new URL('../../../database/migrations/logistics/047_logistics_trip_dispatch.sql', import.meta.url),
  'utf8',
);
const routeSource = readFileSync(new URL('../src/routes/logistics-dispatch.js', import.meta.url), 'utf8');
const serviceSource = readFileSync(new URL('../src/services/logistics-trip-dispatch.js', import.meta.url), 'utf8');
const decisionSource = readFileSync(
  new URL('../../../docs/operations/phase-6e2-trip-dispatch-decisions.md', import.meta.url),
  'utf8',
);
const workspaceSource = readFileSync(
  new URL('../../web/app/logistics/dispatch/trip-dispatch-workspace.tsx', import.meta.url),
  'utf8',
);

test('migration 047 is registered once and owns immutable trip dispatch lineage', () => {
  const matches = CORE_API_MIGRATIONS.filter((entry) => entry.id === '047_logistics_trip_dispatch');
  assert.equal(matches.length, 1);
  assert.match(matches[0].sql, /status IN \('draft', 'planned', 'locked', 'dispatched'\)/);
  assert.match(matches[0].sql, /CREATE TABLE IF NOT EXISTS logistics\.trip_dispatch_items/);
  assert.match(matches[0].sql, /trip_dispatch_items_delivery_order_unique/);
  assert.match(matches[0].sql, /OLD\.status = 'locked' AND NEW\.status = 'dispatched'/);
  assert.match(matches[0].sql, /logistics_trip_dispatch_reconciliation_mismatch/);
});

test('dispatch permission is known while attempt POD and COD permissions remain absent', () => {
  assert.equal(isKnownPermissionKey(PERMISSIONS.coreDeliveryTripDispatch), true);
  assert.equal(isKnownPermissionKey('core.delivery-attempt.create'), false);
  assert.equal(isKnownPermissionKey('core.pod.attach'), false);
  assert.equal(isKnownPermissionKey('core.cod.collect'), false);
});

test('dispatch route exposes only trip handover summary and mutation', () => {
  assert.match(routeSource, /\/api\\\/logistics\\\/trips/);
  assert.match(routeSource, /coreDeliveryTripDispatch/);
  assert.match(routeSource, /Idempotency-Key header is required/);
  assert.doesNotMatch(routeSource, /delivery-attempt|proof-of-delivery|core\.pod|core\.cod|pod\/attach/i);
});

test('dispatch service is all-or-nothing and reconciles issue movement delivery order and trip', () => {
  assert.match(serviceSource, /await client\.query\('BEGIN'\)/);
  assert.match(serviceSource, /await client\.query\('ROLLBACK'\)/);
  assert.match(serviceSource, /postServerOwnedSalesMovement/);
  assert.match(serviceSource, /status: 'dispatched'/);
  assert.match(serviceSource, /insertDispatchItem/);
  assert.match(serviceSource, /markTripDispatched/);
  assert.match(serviceSource, /core\.delivery_trip\.dispatched/);
  assert.match(serviceSource, /core\.sales\.delivery_order\.inventory_issued/);
  assert.doesNotMatch(serviceSource, /delivery-attempt|proof-of-delivery|core\.pod|core\.cod|pod\/attach/i);
});

test('malformed or unauthorized dispatch fails before storage', async () => {
  const adapter = Object.freeze({ connect: async () => { throw new Error('storage_must_not_be_called'); } });
  const baseContext = Object.freeze({
    installationId: 'test-installation',
    actorId: 'test:dispatcher',
    sourceApp: 'npp-core-api',
    requestId: 'req-trip-dispatch-contract',
    permissions: Object.freeze([]),
    scopes: Object.freeze({ warehouseIds: Object.freeze([]), branchIds: Object.freeze([]), territoryIds: Object.freeze([]) }),
  });

  const invalidTrip = await dispatchDeliveryTrip({
    adapter,
    requestContext: baseContext,
    tripId: 'not-a-uuid',
    idempotencyKey: 'dispatch-invalid-trip',
    payload: {},
  });
  assert.equal(invalidTrip.ok, false);
  assert.equal(invalidTrip.code, 'INVALID_TRIP_ID');

  const unauthorized = await dispatchDeliveryTrip({
    adapter,
    requestContext: baseContext,
    tripId: '00000000-0000-4000-8000-000000000001',
    idempotencyKey: 'dispatch-no-permission',
    payload: { dispatchedAt: new Date().toISOString(), handoverReceiverName: 'Driver' },
  });
  assert.equal(unauthorized.ok, false);
  assert.equal(unauthorized.code, 'PERMISSION_DENIED');
});

test('NPP dispatch workspace requires physical handover and remains outside attempt/POD actions', () => {
  assert.match(workspaceSource, /handoverReceiverName/);
  assert.match(workspaceSource, /dispatchedAt/);
  assert.match(workspaceSource, /Idempotency-Key/);
  assert.match(workspaceSource, /Bàn giao và cho xe xuất phát/);
  assert.match(workspaceSource, /Inventory OUT đã ghi/);
  assert.match(workspaceSource, /kết quả giao và POD thuộc phần tiếp theo/);
  assert.doesNotMatch(workspaceSource, /Giao thành công|Giao thất bại|Tải POD|Thu COD/);
});

test('Phase plan explicitly tracks all five frontends and the missing Logistics frontend', () => {
  assert.match(decisionSource, /Website \+ Customer Ordering/);
  assert.match(decisionSource, /NPP Operations/);
  assert.match(decisionSource, /MCP Field/);
  assert.match(decisionSource, /Admin MCP\/NPP/);
  assert.match(decisionSource, /Logistics\/Delivery — \*\*chưa có source\/project\*\*/);
  assert.match(decisionSource, /Phase 6E không được coi hoàn tất/);
});

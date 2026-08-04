import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CORE_API_MIGRATIONS } from '../src/migrations/index.js';
import { isKnownPermissionKey, PERMISSIONS } from '../src/access/permissions.js';
import {
  assignDeliveryOrder,
  createDeliveryTrip,
  reopenDeliveryTrip,
  reorderTripStops,
} from '../src/services/logistics-trip-planning.js';

const migrationSource = readFileSync(
  new URL('../../../database/migrations/logistics/046_logistics_trip_planning.sql', import.meta.url),
  'utf8',
);
const constraintSource = readFileSync(
  new URL('../../../database/migrations/logistics/046_logistics_trip_planning_constraints.sql', import.meta.url),
  'utf8',
);
const routeSource = readFileSync(new URL('../src/routes/logistics.js', import.meta.url), 'utf8');
const repositorySource = readFileSync(
  new URL('../src/db/repositories/logistics-trip-planning.js', import.meta.url),
  'utf8',
);

const logisticsPermissions = [
  PERMISSIONS.coreLogisticsRouteRead,
  PERMISSIONS.coreLogisticsRouteManage,
  PERMISSIONS.coreVehicleRead,
  PERMISSIONS.coreVehicleManage,
  PERMISSIONS.coreDriverProfileRead,
  PERMISSIONS.coreDriverProfileManage,
  PERMISSIONS.coreDeliveryTripRead,
  PERMISSIONS.coreDeliveryTripCreate,
  PERMISSIONS.coreDeliveryTripPlan,
  PERMISSIONS.coreDeliveryTripAssign,
  PERMISSIONS.coreDeliveryTripLock,
];

test('migration 046 is registered exactly once and owns the logistics schema', () => {
  const matches = CORE_API_MIGRATIONS.filter((entry) => entry.id === '046_logistics_trip_planning');
  assert.equal(matches.length, 1);
  assert.match(matches[0].sql, /CREATE SCHEMA IF NOT EXISTS logistics/);
  assert.match(matches[0].sql, /CREATE TABLE IF NOT EXISTS logistics\.delivery_trips/);
  assert.match(matches[0].sql, /CREATE TABLE IF NOT EXISTS logistics\.trip_stops/);
  assert.match(matches[0].sql, /CREATE TABLE IF NOT EXISTS logistics\.trip_order_assignments/);
  assert.match(matches[0].sql, /DEFERRABLE INITIALLY IMMEDIATE/);
});

test('database guards active assignment, eligible Delivery Order and locked trip immutability', () => {
  assert.match(migrationSource, /trip_order_assignments_active_delivery_order_unique/);
  assert.match(migrationSource, /WHERE unassigned_at IS NULL/);
  assert.match(migrationSource, /delivery_record\.handover_mode <> 'DELIVERY'/);
  assert.match(migrationSource, /delivery_record\.status <> 'ready_to_dispatch'/);
  assert.match(migrationSource, /delivery_record\.warehouse_id IS DISTINCT FROM trip_record\.warehouse_id/);
  assert.match(migrationSource, /IF OLD\.status = 'locked' AND NEW IS DISTINCT FROM OLD/);
  assert.match(constraintSource, /UNIQUE \(installation_id, trip_id, stop_sequence\)/);
});

test('stop reorder is atomic and does not write invalid temporary sequences', () => {
  assert.match(repositorySource, /SET CONSTRAINTS trip_stops_sequence_unique DEFERRED/);
  assert.doesNotMatch(repositorySource, /stop_sequence = -stop_sequence/);
});

test('permission registry includes planning and dispatch while POD remains denied', () => {
  for (const permission of logisticsPermissions) assert.equal(isKnownPermissionKey(permission), true);
  assert.equal(isKnownPermissionKey(PERMISSIONS.coreDeliveryTripDispatch), true);
  assert.equal(isKnownPermissionKey('core.pod.attach'), false);
});

test('planning route stays separate from dispatch, attempts and POD mutations', () => {
  assert.match(routeSource, /\/api\/logistics\/eligible-delivery-orders/);
  assert.match(routeSource, /assign\|unassign\|reorder\|plan\|reopen\|lock/);
  assert.doesNotMatch(routeSource, /\/dispatch/);
  assert.doesNotMatch(routeSource, /delivery-attempt/);
  assert.doesNotMatch(routeSource, /proof-of-delivery|pod\/attach/i);
});

test('service fails closed before touching storage for malformed trip mutations', async () => {
  const requestContext = Object.freeze({
    installationId: 'test-installation',
    actorId: 'test:dispatcher',
    sourceApp: 'npp-core-api',
    requestId: 'req-logistics-contract',
    permissions: Object.freeze(logisticsPermissions),
    scopes: Object.freeze({ warehouseIds: Object.freeze([]), branchIds: Object.freeze([]), territoryIds: Object.freeze([]) }),
  });
  const adapter = Object.freeze({ connect: async () => { throw new Error('storage_must_not_be_called'); } });

  const create = await createDeliveryTrip({
    adapter,
    requestContext,
    payload: { warehouseId: 'not-a-uuid' },
    idempotencyKey: 'trip-create-invalid',
  });
  assert.equal(create.ok, false);
  assert.equal(create.code, 'INVALID_DELIVERY_TRIP');

  const assign = await assignDeliveryOrder({
    adapter,
    requestContext,
    tripId: 'not-a-uuid',
    payload: { deliveryOrderId: 'not-a-uuid' },
    idempotencyKey: 'trip-assign-invalid',
  });
  assert.equal(assign.ok, false);
  assert.equal(assign.code, 'INVALID_DELIVERY_ORDER_ID');

  const reorder = await reorderTripStops({
    adapter,
    requestContext,
    tripId: 'not-a-uuid',
    payload: { stopIds: ['same', 'same'] },
    idempotencyKey: 'trip-reorder-invalid',
  });
  assert.equal(reorder.ok, false);
  assert.equal(reorder.code, 'INVALID_STOP_ORDER');

  const reopen = await reopenDeliveryTrip({
    adapter,
    requestContext,
    tripId: 'not-a-uuid',
    payload: {},
    idempotencyKey: 'trip-reopen-invalid',
  });
  assert.equal(reopen.ok, false);
  assert.equal(reopen.code, 'REOPEN_REASON_REQUIRED');
});
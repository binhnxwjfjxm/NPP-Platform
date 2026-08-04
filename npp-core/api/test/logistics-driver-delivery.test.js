import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CORE_API_MIGRATIONS } from '../src/migrations/index.js';
import { isKnownPermissionKey, PERMISSIONS } from '../src/access/permissions.js';
import {
  authenticateRequest,
  createBootstrapPrincipal,
  createDeliveryFrontendPrincipal,
  createRequestContext,
  requirePermission,
} from '../src/request-context.js';
import {
  getAssignedDriverTrip,
  listAssignedDriverTrips,
  logisticsDriverDeliveryInternals,
} from '../src/services/logistics-driver-delivery.js';

const EMPLOYEE_ID = '10000000-0000-4000-8000-000000000001';
const WAREHOUSE_ID = '20000000-0000-4000-8000-000000000001';
const TRIP_ID = '30000000-0000-4000-8000-000000000001';
const DRIVER_ID = '40000000-0000-4000-8000-000000000001';
const ISSUE_LINE_ID = '50000000-0000-4000-8000-000000000001';
const DELIVERY_TOKEN = 'delivery-test-token-000000000000';

const config = Object.freeze({
  installationId: 'test-installation',
  deliveryFrontendApiToken: DELIVERY_TOKEN,
  deliveryFrontendActorId: 'service:delivery-frontend',
  deliveryFrontendWarehouseIds: Object.freeze([WAREHOUSE_ID]),
  backendApiToken: 'backend-test-token-0000000000000',
  coreBootstrapActorId: 'test:bootstrap',
  mcpSalesApiToken: '',
  mcpOnboardingApiToken: '',
});

const migrationSource = readFileSync(
  new URL('../../../database/migrations/logistics/049_logistics_delivery_attempts.sql', import.meta.url),
  'utf8',
);
const routeSource = readFileSync(new URL('../src/routes/logistics-driver.js', import.meta.url), 'utf8');
const serviceSource = readFileSync(new URL('../src/services/logistics-driver-delivery.js', import.meta.url), 'utf8');
const repositorySource = readFileSync(
  new URL('../src/db/repositories/logistics-driver-delivery.js', import.meta.url),
  'utf8',
);
const decisionSource = readFileSync(
  new URL('../../../docs/operations/phase-6e4-delivery-attempt-decisions.md', import.meta.url),
  'utf8',
);

test('migration 049 is registered once with immutable attempt facts', () => {
  const matches = CORE_API_MIGRATIONS.filter((entry) => entry.id === '049_logistics_delivery_attempts');
  assert.equal(matches.length, 1);
  assert.match(matches[0].sql, /CREATE TABLE IF NOT EXISTS logistics\.delivery_attempts/);
  assert.match(matches[0].sql, /CREATE TABLE IF NOT EXISTS logistics\.delivery_attempt_lines/);
  assert.match(migrationSource, /delivery_attempts_assignment_unique/);
  assert.match(migrationSource, /delivery_attempts_idempotency_unique/);
  assert.match(migrationSource, /delivery_attempts_are_immutable/);
  assert.match(migrationSource, /delivery_attempt_lines_are_immutable/);
  assert.match(migrationSource, /DELIVERY_ATTEMPT_RECORDED/);
  assert.match(migrationSource, /core\.delivery-attempt\.read/);
  assert.match(migrationSource, /core\.delivery-attempt\.record/);
});

test('Delivery principal can read and record own attempts but cannot dispatch or manage trips', () => {
  const principal = createDeliveryFrontendPrincipal(config, EMPLOYEE_ID);
  assert.equal(principal.employeeId, EMPLOYEE_ID);
  assert.deepEqual(principal.roles, ['driver']);
  assert.deepEqual(principal.permissions, [
    PERMISSIONS.coreDeliveryTripDriverRead,
    PERMISSIONS.coreDeliveryAttemptRead,
    PERMISSIONS.coreDeliveryAttemptRecord,
  ]);
  assert.deepEqual(principal.scopes.warehouseIds, [WAREHOUSE_ID]);
  assert.equal(isKnownPermissionKey(PERMISSIONS.coreDeliveryAttemptRead), true);
  assert.equal(isKnownPermissionKey(PERMISSIONS.coreDeliveryAttemptRecord), true);

  const context = createRequestContext({ config, principal });
  assert.equal(requirePermission(context, PERMISSIONS.coreDeliveryTripDriverRead).ok, true);
  assert.equal(requirePermission(context, PERMISSIONS.coreDeliveryAttemptRead).ok, true);
  assert.equal(requirePermission(context, PERMISSIONS.coreDeliveryAttemptRecord).ok, true);
  assert.equal(requirePermission(context, PERMISSIONS.coreDeliveryTripRead).ok, false);
  assert.equal(requirePermission(context, PERMISSIONS.coreDeliveryTripDispatch).ok, false);
});

test('dispatcher bootstrap can read attempt summary but cannot become driver recorder', () => {
  const principal = createBootstrapPrincipal(config);
  const context = createRequestContext({ config, principal });
  assert.equal(requirePermission(context, PERMISSIONS.coreDeliveryAttemptRead).ok, true);
  assert.equal(requirePermission(context, PERMISSIONS.coreDeliveryAttemptRecord).ok, false);
  assert.equal(context.employeeId, null);
});

test('Delivery token requires a trusted valid employee header', () => {
  const headers = { authorization: `Bearer ${DELIVERY_TOKEN}` };
  assert.equal(authenticateRequest({ headers }, config).ok, false);
  assert.equal(authenticateRequest({ headers: { ...headers, 'x-npp-delivery-employee-id': 'invalid' } }, config).ok, false);

  const authenticated = authenticateRequest({
    headers: { ...headers, 'x-npp-delivery-employee-id': EMPLOYEE_ID },
  }, config);
  assert.equal(authenticated.ok, true);
  assert.equal(authenticated.principal.employeeId, EMPLOYEE_ID);
  assert.deepEqual(authenticated.principal.permissions, [
    PERMISSIONS.coreDeliveryTripDriverRead,
    PERMISSIONS.coreDeliveryAttemptRead,
    PERMISSIONS.coreDeliveryAttemptRecord,
  ]);
});

test('driver repository enforces employee ownership, warehouse scope and dispatched lineage', () => {
  assert.match(repositorySource, /driver\.employee_id = \$2/);
  assert.match(repositorySource, /employee\.is_active = true/);
  assert.match(repositorySource, /trip\.primary_driver_id = \$4/);
  assert.match(repositorySource, /trip\.status = 'dispatched'/);
  assert.match(repositorySource, /trip\.warehouse_id = ANY\(\$5::uuid\[\]\)/);
  assert.match(repositorySource, /JOIN logistics\.trip_dispatch_items/);
  assert.match(repositorySource, /JOIN sales\.delivery_order_inventory_issues/);
  assert.match(repositorySource, /FOR UPDATE OF trip, assignment, issue/);
  assert.match(repositorySource, /sales\.delivery_order_inventory_issue_lines/);
});

test('driver route exposes one attempt mutation without accepting browser identity', () => {
  assert.match(routeSource, /coreDeliveryTripDriverRead/);
  assert.match(routeSource, /coreDeliveryAttemptRecord/);
  assert.match(routeSource, /readJsonBody/);
  assert.match(routeSource, /normalizeIdempotencyKey/);
  assert.match(routeSource, /assignments\\\/\(\[\^\/\]\+\)\\\/attempts/);
  assert.doesNotMatch(routeSource, /driverId|employeeId/);
  assert.doesNotMatch(routeSource, /PUT|PATCH|DELETE/);
});

test('attempt payload normalization preserves exact decimal strings and result shapes', () => {
  const full = logisticsDriverDeliveryInternals.normalizeAttemptPayload({
    result: 'delivered_full',
    attemptedAt: '2026-08-04T10:00:00+07:00',
  });
  assert.equal(full.ok, true);
  assert.equal(full.normalized.attemptedAt, '2026-08-04T03:00:00.000Z');
  assert.deepEqual(full.normalized.lines, []);

  const partial = logisticsDriverDeliveryInternals.normalizeAttemptPayload({
    result: 'delivered_partial',
    attemptedAt: '2026-08-04T03:00:00.000Z',
    lines: [{
      inventoryIssueLineId: ISSUE_LINE_ID,
      deliveredBaseQuantity: '2.500000000001',
    }],
  });
  assert.equal(partial.ok, true);
  assert.equal(
    logisticsDriverDeliveryInternals.formatQuantity(partial.normalized.lines[0].quantity),
    '2.500000000001',
  );

  assert.equal(logisticsDriverDeliveryInternals.normalizeAttemptPayload({
    result: 'failed',
    attemptedAt: '2026-08-04T03:00:00.000Z',
  }).code, 'DELIVERY_ATTEMPT_REASON_REQUIRED');
  assert.equal(logisticsDriverDeliveryInternals.normalizeAttemptPayload({
    result: 'rescheduled',
    attemptedAt: '2026-08-04T03:00:00.000Z',
    reasonCode: 'REQUESTED_NEW_TIME',
    rescheduledFor: '2026-08-04T02:59:00.000Z',
  }).code, 'DELIVERY_ATTEMPT_RESCHEDULE_TIME_INVALID');
  assert.equal(logisticsDriverDeliveryInternals.normalizeAttemptPayload({
    result: 'delivered_full',
    attemptedAt: '2026-08-04T03:00:00.000Z',
    lines: [{ inventoryIssueLineId: ISSUE_LINE_ID, deliveredBaseQuantity: '1' }],
  }).code, 'DELIVERY_ATTEMPT_LINES_FORBIDDEN');
});

test('driver service returns safe attempt-aware read models without inventory movement internals', async () => {
  const rows = [{
    id: TRIP_ID,
    trip_number: 'TRP-TEST-1',
    status: 'dispatched',
    warehouse_id: WAREHOUSE_ID,
    warehouse_code: 'WH',
    warehouse_name: 'Kho',
    primary_driver_id: DRIVER_ID,
    driver_code: 'DRV',
    driver_name: 'Tài xế',
    stop_count: '1',
    assignment_count: '1',
    attempt_count: '0',
  }];
  const adapter = {
    async query(sql) {
      if (sql.includes('FROM logistics.driver_profiles driver')) {
        return { rows: [{ id: DRIVER_ID, code: 'DRV', name: 'Tài xế', employee_id: EMPLOYEE_ID }] };
      }
      if (sql.includes('count(DISTINCT stop.id)')) return { rows };
      if (sql.includes('WHERE trip.installation_id') && sql.includes('trip.id = $2')) return { rows };
      if (sql.includes('FROM logistics.trip_stops stop')) {
        return { rows: [{
          id: '60000000-0000-4000-8000-000000000001',
          stop_sequence: 1,
          customer_id: '70000000-0000-4000-8000-000000000001',
          customer_address_id: '80000000-0000-4000-8000-000000000001',
          address_snapshot: { line1: 'Địa chỉ giao' },
          assignments: [],
        }] };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  const requestContext = createRequestContext({
    config,
    principal: createDeliveryFrontendPrincipal(config, EMPLOYEE_ID),
  });
  const listed = await listAssignedDriverTrips(adapter, { requestContext });
  assert.equal(listed.ok, true);
  assert.equal(listed.trips[0].attemptCount, 0);

  const detail = await getAssignedDriverTrip(adapter, { requestContext, tripId: TRIP_ID });
  assert.equal(detail.ok, true);
  assert.equal(detail.trip.stops.length, 1);
  assert.equal(Object.hasOwn(detail.trip, 'inventoryMovementId'), false);
  assert.equal(Object.hasOwn(detail.trip, 'dispatchItems'), false);
  assert.equal(Object.hasOwn(detail.trip, 'events'), false);
});

test('Phase 6E.4 keeps residual stock on vehicle custody and excludes adjacent phases', () => {
  assert.match(decisionSource, /hàng đang ở custody chuyến\/xe/i);
  assert.match(decisionSource, /không tự Inventory IN/i);
  assert.match(decisionSource, /POD, ảnh, chữ ký, GPS hoặc R2/i);
  assert.match(decisionSource, /COD, payment, receivable hoặc accounting/i);
  assert.match(decisionSource, /PR #234/);
  assert.match(serviceSource, /core\.delivery_attempt\.recorded/);
  assert.doesNotMatch(serviceSource, /postServerOwnedSalesMovement|inventory_movements\s*\(/);
});

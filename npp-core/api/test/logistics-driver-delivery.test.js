import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CORE_API_MIGRATIONS } from '../src/migrations/index.js';
import { isKnownPermissionKey, PERMISSIONS } from '../src/access/permissions.js';
import {
  authenticateRequest,
  createDeliveryFrontendPrincipal,
  createRequestContext,
  requirePermission,
} from '../src/request-context.js';
import {
  getAssignedDriverTrip,
  listAssignedDriverTrips,
} from '../src/services/logistics-driver-delivery.js';

const EMPLOYEE_ID = '10000000-0000-4000-8000-000000000001';
const WAREHOUSE_ID = '20000000-0000-4000-8000-000000000001';
const OTHER_WAREHOUSE_ID = '20000000-0000-4000-8000-000000000002';
const TRIP_ID = '30000000-0000-4000-8000-000000000001';
const DRIVER_ID = '40000000-0000-4000-8000-000000000001';
const DELIVERY_TOKEN = 'delivery-test-token-000000000000';

const config = Object.freeze({
  installationId: 'test-installation',
  deliveryFrontendApiToken: DELIVERY_TOKEN,
  deliveryFrontendActorId: 'service:delivery-frontend',
  deliveryFrontendWarehouseIds: Object.freeze([WAREHOUSE_ID]),
  backendApiToken: 'backend-test-token-0000000000000',
  mcpSalesApiToken: '',
  mcpOnboardingApiToken: '',
});

const migrationSource = readFileSync(
  new URL('../../../database/migrations/logistics/048_logistics_driver_delivery_read.sql', import.meta.url),
  'utf8',
);
const routeSource = readFileSync(new URL('../src/routes/logistics-driver.js', import.meta.url), 'utf8');
const serviceSource = readFileSync(new URL('../src/services/logistics-driver-delivery.js', import.meta.url), 'utf8');
const repositorySource = readFileSync(
  new URL('../src/db/repositories/logistics-driver-delivery.js', import.meta.url),
  'utf8',
);
const decisionSource = readFileSync(
  new URL('../../../docs/operations/phase-6e3-delivery-frontend-foundation-decisions.md', import.meta.url),
  'utf8',
);

test('migration 048 is registered once and locks employee-driver identity', () => {
  const matches = CORE_API_MIGRATIONS.filter((entry) => entry.id === '048_logistics_driver_delivery_read');
  assert.equal(matches.length, 1);
  assert.match(matches[0].sql, /driver_profiles_employee_installation_fk/);
  assert.match(matches[0].sql, /driver_profiles_employee_unique/);
  assert.match(matches[0].sql, /delivery_trips_driver_status_idx/);
  assert.match(migrationSource, /core\.delivery-trip\.driver-read/);
});

test('Delivery principal is employee-bound and deny-by-default', () => {
  const principal = createDeliveryFrontendPrincipal(config, EMPLOYEE_ID);
  assert.equal(principal.employeeId, EMPLOYEE_ID);
  assert.deepEqual(principal.roles, ['driver']);
  assert.deepEqual(principal.permissions, [PERMISSIONS.coreDeliveryTripDriverRead]);
  assert.deepEqual(principal.scopes.warehouseIds, [WAREHOUSE_ID]);
  assert.equal(isKnownPermissionKey(PERMISSIONS.coreDeliveryTripDriverRead), true);

  const context = createRequestContext({ config, principal });
  assert.equal(requirePermission(context, PERMISSIONS.coreDeliveryTripDriverRead).ok, true);
  assert.equal(requirePermission(context, PERMISSIONS.coreDeliveryTripRead).ok, false);
  assert.equal(requirePermission(context, PERMISSIONS.coreDeliveryTripDispatch).ok, false);
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
  assert.deepEqual(authenticated.principal.permissions, [PERMISSIONS.coreDeliveryTripDriverRead]);
});

test('driver repository filters dispatched trips by employee ownership and warehouse', () => {
  assert.match(repositorySource, /driver\.employee_id = \$2/);
  assert.match(repositorySource, /employee\.is_active = true/);
  assert.match(repositorySource, /trip\.primary_driver_id = \$2/);
  assert.match(repositorySource, /trip\.status = 'dispatched'/);
  assert.match(repositorySource, /trip\.warehouse_id = ANY\(\$3::uuid\[\]\)/);
  assert.match(repositorySource, /trip\.primary_driver_id = \$3/);
  assert.match(repositorySource, /trip\.warehouse_id = ANY\(\$4::uuid\[\]\)/);
});

test('driver routes are read-only and never accept driver identity from query or body', () => {
  assert.match(routeSource, /GET/);
  assert.match(routeSource, /coreDeliveryTripDriverRead/);
  assert.match(routeSource, /\/api\\\/logistics\\\/driver\\\/trips/);
  assert.doesNotMatch(routeSource, /readJsonBody|Idempotency-Key|driverId|employeeId/);
  assert.doesNotMatch(routeSource, /POST|PUT|PATCH|DELETE/);
});

test('driver service returns safe read models without dispatch internals', async () => {
  const rows = [
    {
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
    },
  ];
  const adapter = {
    async query(sql) {
      if (sql.includes('FROM logistics.driver_profiles driver')) {
        return { rows: [{ id: DRIVER_ID, code: 'DRV', name: 'Tài xế', employee_id: EMPLOYEE_ID }] };
      }
      if (sql.includes('count(DISTINCT stop.id)')) return { rows };
      if (sql.includes('WHERE trip.installation_id') && sql.includes('trip.id = $2')) return { rows };
      if (sql.includes('FROM logistics.trip_stops stop')) {
        return { rows: [{
          id: '50000000-0000-4000-8000-000000000001',
          stop_sequence: 1,
          customer_id: '60000000-0000-4000-8000-000000000001',
          customer_address_id: '70000000-0000-4000-8000-000000000001',
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
  assert.equal(listed.trips.length, 1);
  assert.equal(listed.trips[0].id, TRIP_ID);

  const detail = await getAssignedDriverTrip(adapter, { requestContext, tripId: TRIP_ID });
  assert.equal(detail.ok, true);
  assert.equal(detail.trip.stops.length, 1);
  assert.equal(Object.hasOwn(detail.trip, 'inventoryMovementId'), false);
  assert.equal(Object.hasOwn(detail.trip, 'dispatchItems'), false);
  assert.equal(Object.hasOwn(detail.trip, 'events'), false);
});

test('cross-driver or out-of-scope trip is reported as not found', async () => {
  const adapter = {
    async query(sql) {
      if (sql.includes('FROM logistics.driver_profiles driver')) {
        return { rows: [{ id: DRIVER_ID, code: 'DRV', name: 'Tài xế', employee_id: EMPLOYEE_ID }] };
      }
      if (sql.includes('trip.id = $2')) return { rows: [] };
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  const requestContext = createRequestContext({
    config,
    principal: createDeliveryFrontendPrincipal(config, EMPLOYEE_ID),
  });
  const result = await getAssignedDriverTrip(adapter, { requestContext, tripId: TRIP_ID });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'DELIVERY_TRIP_NOT_FOUND');
});

test('Phase 6E.3 tracks five frontends and excludes attempts POD COD and deployment', () => {
  assert.match(decisionSource, /Website \+ Customer Ordering/);
  assert.match(decisionSource, /NPP Operations/);
  assert.match(decisionSource, /MCP Field/);
  assert.match(decisionSource, /Admin MCP\/NPP/);
  assert.match(decisionSource, /Logistics\/Delivery/);
  assert.match(decisionSource, /delivery\/web/);
  assert.match(decisionSource, /không có mutation giao hàng/i);
  assert.doesNotMatch(serviceSource, /delivery_attempt|proof_of_delivery|core\.pod|core\.cod/i);
  assert.equal(OTHER_WAREHOUSE_ID === WAREHOUSE_ID, false);
});

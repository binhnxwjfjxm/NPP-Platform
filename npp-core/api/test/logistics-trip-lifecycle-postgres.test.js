import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { closePool, getPool } from '../src/db/pool.js';
import { startServer } from '../src/server.js';

function testEnv() {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3079',
    INSTALLATION_ID: `logistics-lifecycle-${randomUUID()}`,
    DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://user:password@127.0.0.1:5432/npp_platform',
    DATABASE_SSL_MODE: 'disable',
    BACKEND_API_TOKEN: 'test-token-0123456789abcdef',
    CORE_BOOTSTRAP_ACTOR_ID: 'test:bootstrap',
    CORS_ORIGINS: 'http://127.0.0.1:3007',
  };
}

function authHeaders(config, key = null, withJson = true) {
  return {
    Authorization: `Bearer ${config.backendApiToken}`,
    ...(withJson ? { 'Content-Type': 'application/json' } : {}),
    ...(key ? { 'Idempotency-Key': key } : {}),
  };
}

async function fetchJson(responseOrPromise) {
  const response = await responseOrPromise;
  const body = await response.json();
  return { response, body };
}

function closeServer(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

async function seedPlanningFixture(pool, installationId) {
  const actor = 'test:lifecycle-fixture';
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const vehicleId = randomUUID();
  const driverId = randomUUID();
  await pool.query(
    `INSERT INTO shared.branches
      (id, installation_id, code, name, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,true,$5,$5)`,
    [branchId, installationId, `BR-${suffix}`, `Chi nhánh ${suffix}`, actor],
  );
  await pool.query(
    `INSERT INTO shared.warehouses
      (id, installation_id, branch_id, code, name, warehouse_type, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,'main',true,$6,$6)`,
    [warehouseId, installationId, branchId, `WH-${suffix}`, `Kho ${suffix}`, actor],
  );
  await pool.query(
    `INSERT INTO logistics.vehicles
      (id, installation_id, code, license_plate, vehicle_type, operational_status,
       is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,'Xe tải','AVAILABLE',true,$5,$5)`,
    [vehicleId, installationId, `XE-${suffix}`, `PLATE-${suffix}`, actor],
  );
  await pool.query(
    `INSERT INTO logistics.driver_profiles
      (id, installation_id, code, employee_id, name, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,NULL,$4,true,$5,$5)`,
    [driverId, installationId, `DRV-${suffix}`, `Tài xế ${suffix}`, actor],
  );
  return { warehouseId, vehicleId, driverId };
}

async function seedLifecycleAssignment(pool, installationId, tripId) {
  const actor = 'test:lifecycle-fixture';
  const stopId = randomUUID();
  const assignmentId = randomUUID();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL session_replication_role = 'replica'");
    await client.query(
      `INSERT INTO logistics.trip_stops
        (id, installation_id, trip_id, stop_sequence, customer_id, customer_address_id,
         address_snapshot, planned_arrival_at, created_by, updated_by)
       VALUES ($1,$2,$3,1,$4,$5,'{"fullAddress":"Lifecycle fixture"}'::jsonb,NULL,$6,$6)`,
      [stopId, installationId, tripId, randomUUID(), randomUUID(), actor],
    );
    await client.query(
      `INSERT INTO logistics.trip_order_assignments
        (id, installation_id, trip_id, trip_stop_id, delivery_order_id, assigned_by)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [assignmentId, installationId, tripId, stopId, randomUUID(), actor],
    );
    await client.query('COMMIT');
    return { stopId, assignmentId };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function removeLifecycleAssignment(pool, installationId, fixture) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL session_replication_role = 'replica'");
    await client.query(
      `DELETE FROM logistics.trip_order_assignments
        WHERE installation_id = $1 AND id = $2`,
      [installationId, fixture.assignmentId],
    );
    await client.query(
      `DELETE FROM logistics.trip_stops
        WHERE installation_id = $1 AND id = $2`,
      [installationId, fixture.stopId],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function mutate(baseUrl, config, tripId, action, payload, key) {
  return fetchJson(fetch(`${baseUrl}/api/logistics/trips/${tripId}${action ? `/${action}` : ''}`, {
    method: action ? 'POST' : 'PUT',
    headers: authHeaders(config, key),
    body: JSON.stringify(payload),
  }));
}

test('G1 lifecycle makes planned read-only until reopen and keeps locked immutable', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  let server;
  let lifecycleAssignment = null;
  try {
    const { warehouseId, vehicleId, driverId } = await seedPlanningFixture(pool, config.installationId);
    server = await startServer({ config });
    const baseUrl = `http://${config.host}:${config.port}`;

    const created = await fetchJson(fetch(`${baseUrl}/api/logistics/trips`, {
      method: 'POST',
      headers: authHeaders(config, `create-${randomUUID()}`),
      body: JSON.stringify({
        warehouseId,
        deliveryRouteId: null,
        vehicleId,
        primaryDriverId: driverId,
        plannedStartAt: null,
        note: 'G1 draft',
      }),
    }));
    assert.equal(created.response.status, 201, JSON.stringify(created.body));
    const tripId = created.body.data.trip.id;
    lifecycleAssignment = await seedLifecycleAssignment(pool, config.installationId, tripId);

    const planned = await mutate(baseUrl, config, tripId, 'plan', {}, `plan-${randomUUID()}`);
    assert.equal(planned.response.status, 200, JSON.stringify(planned.body));
    assert.equal(planned.body.data.trip.status, 'planned');

    const beforeRejected = await pool.query(
      `SELECT trip.revision,
              (SELECT count(*)::int FROM logistics.trip_events event
                WHERE event.installation_id = trip.installation_id AND event.trip_id = trip.id) AS event_count,
              (SELECT count(*)::int FROM logistics.trip_operation_idempotency replay
                WHERE replay.installation_id = trip.installation_id AND replay.trip_id = trip.id) AS replay_count
         FROM logistics.delivery_trips trip
        WHERE trip.installation_id = $1 AND trip.id = $2`,
      [config.installationId, tripId],
    );

    const plannedMutations = [
      await mutate(baseUrl, config, tripId, '', {
        deliveryRouteId: null,
        vehicleId: null,
        primaryDriverId: null,
        plannedStartAt: null,
        note: 'must reject',
      }, `update-planned-${randomUUID()}`),
      await mutate(baseUrl, config, tripId, 'assign', {
        deliveryOrderIds: [randomUUID()],
      }, `assign-planned-${randomUUID()}`),
      await mutate(baseUrl, config, tripId, 'unassign', {
        deliveryOrderId: randomUUID(),
        reason: 'must reject',
      }, `unassign-planned-${randomUUID()}`),
      await mutate(baseUrl, config, tripId, 'reorder', {
        stopIds: [randomUUID()],
      }, `reorder-planned-${randomUUID()}`),
    ];

    for (const rejected of plannedMutations) {
      assert.equal(rejected.response.status, 409, JSON.stringify(rejected.body));
      assert.equal(rejected.body.error.code, 'DELIVERY_TRIP_NOT_EDITABLE');
    }

    const afterRejected = await pool.query(
      `SELECT trip.revision,
              (SELECT count(*)::int FROM logistics.trip_events event
                WHERE event.installation_id = trip.installation_id AND event.trip_id = trip.id) AS event_count,
              (SELECT count(*)::int FROM logistics.trip_operation_idempotency replay
                WHERE replay.installation_id = trip.installation_id AND replay.trip_id = trip.id) AS replay_count
         FROM logistics.delivery_trips trip
        WHERE trip.installation_id = $1 AND trip.id = $2`,
      [config.installationId, tripId],
    );
    assert.deepEqual(afterRejected.rows[0], beforeRejected.rows[0]);

    const reopened = await mutate(baseUrl, config, tripId, 'reopen', {
      reason: 'Điều chỉnh kế hoạch G1',
    }, `reopen-${randomUUID()}`);
    assert.equal(reopened.response.status, 200, JSON.stringify(reopened.body));
    assert.equal(reopened.body.data.trip.status, 'draft');

    const updated = await mutate(baseUrl, config, tripId, '', {
      deliveryRouteId: null,
      vehicleId,
      primaryDriverId: driverId,
      plannedStartAt: null,
      note: 'edit after reopen',
    }, `update-draft-${randomUUID()}`);
    assert.equal(updated.response.status, 200, JSON.stringify(updated.body));
    assert.equal(updated.body.data.trip.note, 'edit after reopen');

    const replanned = await mutate(baseUrl, config, tripId, 'plan', {}, `replan-${randomUUID()}`);
    assert.equal(replanned.response.status, 200, JSON.stringify(replanned.body));
    assert.equal(replanned.body.data.trip.status, 'planned');

    const locked = await mutate(baseUrl, config, tripId, 'lock', {}, `lock-${randomUUID()}`);
    assert.equal(locked.response.status, 200, JSON.stringify(locked.body));
    assert.equal(locked.body.data.trip.status, 'locked');

    const lockedUpdate = await mutate(baseUrl, config, tripId, '', {
      deliveryRouteId: null,
      vehicleId: null,
      primaryDriverId: null,
      plannedStartAt: null,
      note: 'still immutable',
    }, `update-locked-${randomUUID()}`);
    assert.equal(lockedUpdate.response.status, 409, JSON.stringify(lockedUpdate.body));
    assert.equal(lockedUpdate.body.error.code, 'DELIVERY_TRIP_LOCKED');
  } finally {
    if (server) await closeServer(server);
    if (lifecycleAssignment) {
      await removeLifecycleAssignment(pool, config.installationId, lifecycleAssignment);
    }
    await closePool();
  }
});

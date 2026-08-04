import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { closePool, getPool } from '../src/db/pool.js';
import { startServer } from '../src/server.js';

function closeServer(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

async function fetchJson(responseOrPromise) {
  const response = await responseOrPromise;
  const body = await response.json();
  return { response, body };
}

function deliveryHeaders(config, employeeId) {
  return {
    Authorization: `Bearer ${config.deliveryFrontendApiToken}`,
    'x-npp-delivery-employee-id': employeeId,
  };
}

test('PostgreSQL driver ownership isolates dispatched trips', async () => {
  const installationId = `delivery-driver-${randomUUID()}`;
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const employeeA = randomUUID();
  const employeeB = randomUUID();
  const driverA = randomUUID();
  const driverB = randomUUID();
  const vehicleId = randomUUID();
  const tripA = randomUUID();
  const tripB = randomUUID();
  const config = loadConfig({
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3068',
    INSTALLATION_ID: installationId,
    DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://user:password@127.0.0.1:5432/npp_platform',
    DATABASE_SSL_MODE: 'disable',
    BACKEND_API_TOKEN: 'test-token-0123456789abcdef',
    CORE_BOOTSTRAP_ACTOR_ID: 'test:bootstrap',
    DELIVERY_FRONTEND_API_TOKEN: 'delivery-token-0123456789abcdef',
    DELIVERY_FRONTEND_ACTOR_ID: 'service:delivery-test',
    DELIVERY_FRONTEND_WAREHOUSE_IDS: warehouseId,
    CORS_ORIGINS: 'http://127.0.0.1:3005',
  });
  const pool = getPool(config);
  let server;
  const actor = 'test:delivery-fixture';
  try {
    await pool.query('BEGIN');
    await pool.query(
      `INSERT INTO shared.branches
        (id, installation_id, code, name, is_active, created_by, updated_by)
       VALUES ($1,$2,'BR-DELIVERY','Chi nhánh giao hàng',true,$3,$3)`,
      [branchId, installationId, actor],
    );
    await pool.query(
      `INSERT INTO shared.warehouses
        (id, installation_id, branch_id, code, name, warehouse_type, is_active, created_by, updated_by)
       VALUES ($1,$2,$3,'WH-DELIVERY','Kho giao hàng','main',true,$4,$4)`,
      [warehouseId, installationId, branchId, actor],
    );
    await pool.query(
      `INSERT INTO shared.employees
        (id, installation_id, code, full_name, is_active, created_by, updated_by)
       VALUES
        ($1,$3,'TXA','Tài xế A',true,$4,$4),
        ($2,$3,'TXB','Tài xế B',true,$4,$4)`,
      [employeeA, employeeB, installationId, actor],
    );
    await pool.query(
      `INSERT INTO logistics.vehicles
        (id, installation_id, code, license_plate, vehicle_type, operational_status,
         is_active, created_by, updated_by)
       VALUES ($1,$2,'XE-DELIVERY','51A-00001','Xe tải','AVAILABLE',true,$3,$3)`,
      [vehicleId, installationId, actor],
    );
    await pool.query(
      `INSERT INTO logistics.driver_profiles
        (id, installation_id, code, employee_id, name, is_active, created_by, updated_by)
       VALUES
        ($1,$3,'DRV-A',$4,'Tài xế A',true,$6,$6),
        ($2,$3,'DRV-B',$5,'Tài xế B',true,$6,$6)`,
      [driverA, driverB, installationId, employeeA, employeeB, actor],
    );
    await pool.query("SELECT set_config('npp.logistics_write_context', 'trip_dispatch_service', true)");
    await pool.query(
      `INSERT INTO logistics.delivery_trips (
         id, installation_id, trip_number, warehouse_id, vehicle_id, primary_driver_id,
         planned_start_at, status, revision, create_idempotency_key, create_payload_hash,
         planned_at, planned_by, locked_at, locked_by,
         dispatch_id, dispatch_idempotency_key, dispatch_payload_hash,
         handover_receiver_name, dispatched_at, dispatched_by,
         created_by, updated_by
       ) VALUES
       ($1,$3,'TRIP-A',$4,$5,$6,'2026-08-04T01:00:00Z','dispatched',1,
        'create-trip-a',$8,'2026-08-04T00:30:00Z',$9,'2026-08-04T00:45:00Z',$9,
        $10,'dispatch-trip-a',$11,'Tài xế A','2026-08-04T01:00:00Z',$9,$9,$9),
       ($2,$3,'TRIP-B',$4,$5,$7,'2026-08-04T01:10:00Z','dispatched',1,
        'create-trip-b',$8,'2026-08-04T00:35:00Z',$9,'2026-08-04T00:50:00Z',$9,
        $12,'dispatch-trip-b',$11,'Tài xế B','2026-08-04T01:10:00Z',$9,$9,$9)`,
      [
        tripA,
        tripB,
        installationId,
        warehouseId,
        vehicleId,
        driverA,
        driverB,
        'a'.repeat(64),
        actor,
        randomUUID(),
        'b'.repeat(64),
        randomUUID(),
      ],
    );
    await pool.query('COMMIT');

    server = await startServer({ config });
    const baseUrl = `http://${config.host}:${config.port}`;

    const listA = await fetchJson(fetch(`${baseUrl}/api/logistics/driver/trips`, {
      headers: deliveryHeaders(config, employeeA),
    }));
    assert.equal(listA.response.status, 200, JSON.stringify(listA.body));
    assert.deepEqual(listA.body.data.trips.map((trip) => trip.id), [tripA]);
    assert.equal(listA.body.data.driver.employeeId, employeeA);

    const own = await fetchJson(fetch(`${baseUrl}/api/logistics/driver/trips/${tripA}`, {
      headers: deliveryHeaders(config, employeeA),
    }));
    assert.equal(own.response.status, 200, JSON.stringify(own.body));
    assert.equal(own.body.data.trip.id, tripA);
    assert.equal(own.body.data.trip.stops.length, 0);

    const other = await fetchJson(fetch(`${baseUrl}/api/logistics/driver/trips/${tripB}`, {
      headers: deliveryHeaders(config, employeeA),
    }));
    assert.equal(other.response.status, 404, JSON.stringify(other.body));
    assert.equal(other.body.error.code, 'DELIVERY_TRIP_NOT_FOUND');

    const generic = await fetchJson(fetch(`${baseUrl}/api/logistics/trips`, {
      headers: deliveryHeaders(config, employeeA),
    }));
    assert.equal(generic.response.status, 403, JSON.stringify(generic.body));
    assert.equal(generic.body.error.code, 'PERMISSION_DENIED');
  } finally {
    if (server) await closeServer(server);
    await pool.query('ROLLBACK').catch(() => {});
    await closePool();
  }
});

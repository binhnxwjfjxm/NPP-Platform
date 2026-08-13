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
    PORT: '3081',
    INSTALLATION_ID: `logistics-g3-${randomUUID()}`,
    DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://user:password@127.0.0.1:5432/npp_platform',
    DATABASE_SSL_MODE: 'disable',
    BACKEND_API_TOKEN: 'test-token-0123456789abcdef',
    CORE_BOOTSTRAP_ACTOR_ID: 'test:bootstrap',
    CORS_ORIGINS: 'http://127.0.0.1:3007',
  };
}

function authHeaders(config, key = null) {
  return {
    Authorization: `Bearer ${config.backendApiToken}`,
    'Content-Type': 'application/json',
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

async function seedWarehouses(pool, installationId) {
  const actor = 'test:g3-fixture';
  const branchId = randomUUID();
  const warehouseAId = randomUUID();
  const warehouseBId = randomUUID();
  await pool.query(
    `INSERT INTO shared.branches
      (id, installation_id, code, name, is_active, created_by, updated_by)
     VALUES ($1,$2,'BR-G3','Chi nhánh G3',true,$3,$3)`,
    [branchId, installationId, actor],
  );
  await pool.query(
    `INSERT INTO shared.warehouses
      (id, installation_id, branch_id, code, name, warehouse_type, is_active, created_by, updated_by)
     VALUES
      ($1,$3,$4,'KHO-A','Kho A','main',true,$5,$5),
      ($2,$3,$4,'KHO-B','Kho B','main',true,$5,$5)`,
    [warehouseAId, warehouseBId, installationId, branchId, actor],
  );
  return { warehouseAId, warehouseBId };
}

async function createRoute(baseUrl, config, payload) {
  return fetchJson(fetch(`${baseUrl}/api/logistics/routes`, {
    method: 'POST',
    headers: authHeaders(config, `route-${randomUUID()}`),
    body: JSON.stringify(payload),
  }));
}

async function createTrip(baseUrl, config, payload) {
  return fetchJson(fetch(`${baseUrl}/api/logistics/trips`, {
    method: 'POST',
    headers: authHeaders(config, `trip-${randomUUID()}`),
    body: JSON.stringify(payload),
  }));
}

test('G3 requires route warehouse and rejects applying a route to another warehouse', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  let server;
  try {
    const { warehouseAId, warehouseBId } = await seedWarehouses(pool, config.installationId);
    server = await startServer({ config });
    const baseUrl = `http://${config.host}:${config.port}`;

    const missingWarehouse = await createRoute(baseUrl, config, {
      code: 'R-NO-WH',
      name: 'Tuyến thiếu kho',
      defaultWarehouseId: null,
    });
    assert.equal(missingWarehouse.response.status, 400, JSON.stringify(missingWarehouse.body));
    assert.equal(missingWarehouse.body.error.code, 'INVALID_LOGISTICS_ROUTE');

    const routeA = await createRoute(baseUrl, config, {
      code: 'R-A',
      name: 'Tuyến Kho A',
      defaultWarehouseId: warehouseAId,
    });
    assert.equal(routeA.response.status, 201, JSON.stringify(routeA.body));
    assert.equal(routeA.body.data.defaultWarehouseId, warehouseAId);

    const routeB = await createRoute(baseUrl, config, {
      code: 'R-B',
      name: 'Tuyến Kho B',
      defaultWarehouseId: warehouseBId,
    });
    assert.equal(routeB.response.status, 201, JSON.stringify(routeB.body));

    const mismatchedCreate = await createTrip(baseUrl, config, {
      warehouseId: warehouseBId,
      deliveryRouteId: routeA.body.data.id,
      vehicleId: null,
      primaryDriverId: null,
      plannedStartAt: null,
      note: 'Không được áp tuyến A vào kho B',
    });
    assert.equal(mismatchedCreate.response.status, 409, JSON.stringify(mismatchedCreate.body));
    assert.equal(mismatchedCreate.body.error.code, 'DELIVERY_ROUTE_WAREHOUSE_MISMATCH');

    const validTrip = await createTrip(baseUrl, config, {
      warehouseId: warehouseAId,
      deliveryRouteId: routeA.body.data.id,
      vehicleId: null,
      primaryDriverId: null,
      plannedStartAt: null,
      note: 'Đúng kho A',
    });
    assert.equal(validTrip.response.status, 201, JSON.stringify(validTrip.body));
    assert.equal(validTrip.body.data.trip.warehouseId, warehouseAId);
    assert.equal(validTrip.body.data.trip.deliveryRouteId, routeA.body.data.id);

    const mismatchedUpdate = await fetchJson(fetch(`${baseUrl}/api/logistics/trips/${validTrip.body.data.trip.id}`, {
      method: 'PUT',
      headers: authHeaders(config, `update-${randomUUID()}`),
      body: JSON.stringify({
        deliveryRouteId: routeB.body.data.id,
        vehicleId: null,
        primaryDriverId: null,
        plannedStartAt: null,
        note: 'Không được đổi sang tuyến Kho B',
      }),
    }));
    assert.equal(mismatchedUpdate.response.status, 409, JSON.stringify(mismatchedUpdate.body));
    assert.equal(mismatchedUpdate.body.error.code, 'DELIVERY_ROUTE_WAREHOUSE_MISMATCH');
  } finally {
    if (server) await closeServer(server);
    await closePool();
  }
});

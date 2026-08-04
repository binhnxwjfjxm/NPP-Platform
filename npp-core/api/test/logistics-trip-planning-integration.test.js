import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { closePool, getPool } from '../src/db/pool.js';
import { startServer } from '../src/server.js';
import { PERMISSIONS } from '../src/request-context.js';
import { upsertInventoryTrackingPolicy } from '../src/services/inventory-lots.js';
import { postOpeningBalanceImport } from '../src/services/opening-balance.js';

function testEnv() {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3067',
    INSTALLATION_ID: `logistics-trip-${randomUUID()}`,
    DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://user:password@127.0.0.1:5432/npp_platform',
    DATABASE_SSL_MODE: 'disable',
    BACKEND_API_TOKEN: 'test-token-0123456789abcdef',
    CORE_BOOTSTRAP_ACTOR_ID: 'test:bootstrap',
    CORS_ORIGINS: 'http://127.0.0.1:3007',
  };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function sha256Hex(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function authHeaders(config, key = null, withJson = true) {
  return {
    Authorization: `Bearer ${config.backendApiToken}`,
    ...(withJson ? { 'Content-Type': 'application/json' } : {}),
    ...(key ? { 'Idempotency-Key': key } : {}),
  };
}

function closeServer(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

async function fetchJson(response) {
  const body = await response.json();
  return { response, body };
}

function inventoryContext(installationId, warehouseId) {
  return Object.freeze({
    installationId,
    actorId: 'test:inventory-seed',
    employeeId: null,
    sourceApp: 'npp-core-api',
    requestId: `seed-${randomUUID()}`,
    receivedAt: '2026-08-04T10:00:00.000Z',
    roles: Object.freeze(['warehouse-operator']),
    permissions: Object.freeze([
      PERMISSIONS.coreInventoryRead,
      PERMISSIONS.coreInventoryPost,
      PERMISSIONS.coreInventoryTrackingPolicyRead,
      PERMISSIONS.coreInventoryTrackingPolicyManage,
      PERMISSIONS.coreInventoryLotRead,
      PERMISSIONS.coreInventoryLotManage,
      PERMISSIONS.coreInventoryOpeningBalanceImport,
    ]),
    scopes: Object.freeze({
      branchIds: Object.freeze([]),
      warehouseIds: Object.freeze([warehouseId]),
      territoryIds: Object.freeze([]),
    }),
  });
}

async function seedMasterData(pool, installationId) {
  const actor = 'test:fixture';
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const locationId = randomUUID();
  const customerId = randomUUID();
  const addressId = randomUUID();
  const unitId = randomUUID();
  const productId = randomUUID();
  const variantId = randomUUID();
  const channelId = randomUUID();
  const priceListId = randomUUID();

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
    `INSERT INTO shared.warehouse_locations
      (id, installation_id, warehouse_id, code, name, location_type, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,'storage',true,$6,$6)`,
    [locationId, installationId, warehouseId, `A01-${suffix}`, `Kệ ${suffix}`, actor],
  );
  await pool.query(
    `INSERT INTO shared.customers
      (id, installation_id, code, name, payment_terms_days, credit_limit,
       is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,15,10000000,true,$5,$5)`,
    [customerId, installationId, `CUS-${suffix}`, `Khách ${suffix}`, actor],
  );
  await pool.query(
    `INSERT INTO shared.customer_addresses
      (id, installation_id, customer_id, label, recipient_name, address_line1,
       ward, province, country_code, is_default, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,'Cửa hàng','Người nhận','123 Đường giao hàng',
       'Phường thử nghiệm','TP HCM','VN',true,true,$4,$4)`,
    [addressId, installationId, customerId, actor],
  );
  await pool.query(
    `INSERT INTO shared.units_of_measure
      (id, installation_id, code, name, unit_kind, allows_fractional, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,'COUNT',false,true,$5,$5)`,
    [unitId, installationId, `EA${suffix.slice(0, 4)}`, `Đơn vị ${suffix}`, actor],
  );
  await pool.query(
    `INSERT INTO shared.products
      (id, installation_id, code, name, is_orderable, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,true,true,$5,$5)`,
    [productId, installationId, `PR-${suffix}`, `Sản phẩm ${suffix}`, actor],
  );
  await pool.query(
    `INSERT INTO shared.product_variants
      (id, installation_id, product_id, sku, name, variant_kind,
       is_inventory_base, is_sellable, is_catalog_visible, is_active,
       unit_id, conversion_to_base, is_purchasable, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,'BASE',true,true,true,true,$6,1,true,$7,$7)`,
    [variantId, installationId, productId, `SKU-${suffix}`, `SKU ${suffix}`, unitId, actor],
  );
  await pool.query(
    `INSERT INTO shared.sales_channels
      (id, installation_id, code, name, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,true,$5,$5)`,
    [channelId, installationId, `CH-${suffix}`, `Kênh ${suffix}`, actor],
  );
  await pool.query(
    `INSERT INTO shared.price_lists
      (id, installation_id, code, name, list_type, currency_code, priority,
       stacking_mode, stop_processing, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,'BASE','VND',100,'EXCLUSIVE',true,true,$5,$5)`,
    [priceListId, installationId, `BASE-${suffix}`, `Giá ${suffix}`, actor],
  );
  await pool.query(
    `INSERT INTO shared.price_list_items
      (id, installation_id, price_list_id, variant_id, adjustment_type,
       amount_minor, min_quantity, source_kind, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,'FIXED_PRICE',10000,0,'ADMIN',true,$5,$5)`,
    [randomUUID(), installationId, priceListId, variantId, actor],
  );
  return { warehouseId, locationId, customerId, addressId, variantId, channelId };
}

async function seedInventory(pool, config, master) {
  const context = inventoryContext(config.installationId, master.warehouseId);
  const policy = await upsertInventoryTrackingPolicy(pool, {
    requestContext: context,
    payload: {
      baseVariantId: master.variantId,
      lotTrackingMode: 'REQUIRED',
      expiryTrackingMode: 'REQUIRED',
      locationRequired: true,
    },
  });
  assert.equal(policy.ok, true, JSON.stringify(policy));
  const sourceKey = `logistics-${randomUUID()}`;
  const unsignedPayload = {
    sourceKey,
    sourceFilename: `${sourceKey}.xlsx`,
    documentDate: '2026-08-04',
    metadata: { source: 'phase-6e1-integration' },
    rows: [{
      warehouseId: master.warehouseId,
      locationId: master.locationId,
      sourceVariantId: master.variantId,
      sourceQuantity: '5',
      lotCode: `LOT-${randomUUID().slice(0, 8)}`,
      manufacturedDate: '2026-01-01',
      expiryDate: '2026-12-01',
      sourceLineReference: `${sourceKey}!2`,
      metadata: { sourceKey },
    }],
  };
  const posted = await postOpeningBalanceImport({
    adapter: pool,
    requestContext: context,
    idempotencyKey: `opening-${randomUUID()}`,
    payload: { ...unsignedPayload, contentChecksum: sha256Hex(unsignedPayload) },
  });
  assert.equal(posted.ok, true, JSON.stringify(posted));
}

function salesOrderPayload(master) {
  return {
    sourceType: 'MANUAL',
    customerId: master.customerId,
    customerAddressId: master.addressId,
    warehouseId: master.warehouseId,
    salesChannelId: master.channelId,
    deliveryMode: 'DELIVERY',
    collectionPolicy: 'COLLECT_ON_DELIVERY',
    currency: 'VND',
    requestedDeliveryDate: '2026-08-05',
    note: 'Đơn kiểm thử điều phối chuyến',
    lines: [{
      variantId: master.variantId,
      quantity: '3',
      discountMode: 'TOTAL_AMOUNT',
      discountValue: '0',
      taxMode: 'EXCLUSIVE',
      taxRate: '0',
    }],
  };
}

async function createReadyDeliveryOrder(baseUrl, config, master) {
  const created = await fetchJson(await fetch(`${baseUrl}/api/sales-orders`, {
    method: 'POST',
    headers: authHeaders(config, `sales-create-${randomUUID()}`),
    body: JSON.stringify(salesOrderPayload(master)),
  }));
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const salesOrderId = created.body.data.id;

  const confirmed = await fetchJson(await fetch(`${baseUrl}/api/sales-orders/${salesOrderId}/confirm`, {
    method: 'POST',
    headers: authHeaders(config, `sales-confirm-${randomUUID()}`),
    body: JSON.stringify({}),
  }));
  assert.equal(confirmed.response.status, 200, JSON.stringify(confirmed.body));

  const work = await fetchJson(await fetch(`${baseUrl}/api/inventory/fulfillment-work`, {
    headers: authHeaders(config, null, false),
  }));
  const demand = work.body.data.find((item) => item.salesOrderId === salesOrderId);
  assert.ok(demand, JSON.stringify(work.body));

  const allocated = await fetchJson(await fetch(
    `${baseUrl}/api/inventory/fulfillment-demands/${demand.fulfillmentDemandId}/allocate`,
    {
      method: 'POST',
      headers: authHeaders(config, `allocate-${randomUUID()}`),
      body: JSON.stringify({ mode: 'AUTO' }),
    },
  ));
  assert.equal(allocated.response.status, 201, JSON.stringify(allocated.body));
  const allocation = allocated.body.data.allocation.allocations[0];

  const picked = await fetchJson(await fetch(
    `${baseUrl}/api/inventory/fulfillment-allocations/${allocation.id}/pick`,
    {
      method: 'POST',
      headers: authHeaders(config, `pick-${randomUUID()}`),
      body: JSON.stringify({ quantity: '3' }),
    },
  ));
  assert.equal(picked.response.status, 201, JSON.stringify(picked.body));

  const packed = await fetchJson(await fetch(
    `${baseUrl}/api/inventory/fulfillment-allocations/${allocation.id}/pack`,
    {
      method: 'POST',
      headers: authHeaders(config, `pack-${randomUUID()}`),
      body: JSON.stringify({ quantity: '3' }),
    },
  ));
  assert.equal(packed.response.status, 201, JSON.stringify(packed.body));

  const eligibility = await fetchJson(await fetch(
    `${baseUrl}/api/delivery-orders/eligibility?salesOrderId=${salesOrderId}`,
    { headers: authHeaders(config, null, false) },
  ));
  assert.equal(eligibility.response.status, 200, JSON.stringify(eligibility.body));
  assert.equal(eligibility.body.data[0].handoverMode, 'DELIVERY');

  const delivery = await fetchJson(await fetch(`${baseUrl}/api/delivery-orders`, {
    method: 'POST',
    headers: authHeaders(config, `delivery-create-${randomUUID()}`),
    body: JSON.stringify({
      lines: [{
        fulfillmentAllocationId: eligibility.body.data[0].fulfillmentAllocationId,
        quantity: '3.000000000000',
      }],
    }),
  }));
  assert.equal(delivery.response.status, 201, JSON.stringify(delivery.body));
  const deliveryOrderId = delivery.body.data.deliveryOrder.id;

  const ready = await fetchJson(await fetch(`${baseUrl}/api/delivery-orders/${deliveryOrderId}/confirm`, {
    method: 'POST',
    headers: authHeaders(config, `delivery-confirm-${randomUUID()}`),
    body: JSON.stringify({}),
  }));
  assert.equal(ready.response.status, 201, JSON.stringify(ready.body));
  assert.equal(ready.body.data.deliveryOrder.status, 'ready_to_dispatch');
  return deliveryOrderId;
}

async function createMaster(baseUrl, config, resource, body) {
  const result = await fetchJson(await fetch(`${baseUrl}/api/logistics/${resource}`, {
    method: 'POST',
    headers: authHeaders(config, `${resource}-${randomUUID()}`),
    body: JSON.stringify(body),
  }));
  assert.equal(result.response.status, 201, JSON.stringify(result.body));
  return result.body.data;
}

async function createTrip(baseUrl, config, payload, key = `trip-${randomUUID()}`) {
  return fetchJson(await fetch(`${baseUrl}/api/logistics/trips`, {
    method: 'POST',
    headers: authHeaders(config, key),
    body: JSON.stringify(payload),
  }));
}

test('Phase 6E.1 prevents concurrent double assignment and locks the winning plan', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  let server;
  try {
    const master = await seedMasterData(pool, config.installationId);
    await seedInventory(pool, config, master);
    server = await startServer({ config });
    const baseUrl = `http://${config.host}:${config.port}`;
    const deliveryOrderId = await createReadyDeliveryOrder(baseUrl, config, master);

    const route = await createMaster(baseUrl, config, 'routes', {
      code: 'TUYEN-01',
      name: 'Tuyến kiểm thử',
      defaultWarehouseId: master.warehouseId,
    });
    const vehicle = await createMaster(baseUrl, config, 'vehicles', {
      code: 'XE-01',
      licensePlate: '51C-12345',
      vehicleType: 'Xe tải nhỏ',
    });
    const driver = await createMaster(baseUrl, config, 'drivers', {
      code: 'TX-01',
      name: 'Tài xế kiểm thử',
      phone: '0900000000',
    });

    const payload = {
      warehouseId: master.warehouseId,
      deliveryRouteId: route.id,
      vehicleId: vehicle.id,
      primaryDriverId: driver.id,
      plannedStartAt: '2026-08-05T01:00:00.000Z',
      note: 'Chuyến kiểm thử',
    };
    const createKey = `trip-create-${randomUUID()}`;
    const firstTrip = await createTrip(baseUrl, config, payload, createKey);
    assert.equal(firstTrip.response.status, 201, JSON.stringify(firstTrip.body));
    const replayTrip = await createTrip(baseUrl, config, payload, createKey);
    assert.equal(replayTrip.response.status, 200, JSON.stringify(replayTrip.body));
    assert.equal(replayTrip.body.data.trip.id, firstTrip.body.data.trip.id);

    const secondTrip = await createTrip(baseUrl, config, { ...payload, note: 'Chuyến cạnh tranh' });
    assert.equal(secondTrip.response.status, 201, JSON.stringify(secondTrip.body));
    const tripIds = [firstTrip.body.data.trip.id, secondTrip.body.data.trip.id];

    const assignments = await Promise.all(tripIds.map((tripId) => fetchJson(fetch(
      `${baseUrl}/api/logistics/trips/${tripId}/assign`,
      {
        method: 'POST',
        headers: authHeaders(config, `assign-${tripId}-${randomUUID()}`),
        body: JSON.stringify({ deliveryOrderId }),
      },
    ))));
    assert.deepEqual(assignments.map((entry) => entry.response.status).sort(), [200, 409]);
    const winner = assignments.find((entry) => entry.response.status === 200);
    assert.ok(winner, JSON.stringify(assignments));
    const winningTripId = winner.body.data.trip.id;
    assert.equal(winner.body.data.trip.stops.length, 1);
    assert.equal(winner.body.data.trip.stops[0].assignments[0].deliveryOrderId, deliveryOrderId);

    const eligible = await fetchJson(await fetch(`${baseUrl}/api/logistics/eligible-delivery-orders`, {
      headers: authHeaders(config, null, false),
    }));
    assert.equal(eligible.response.status, 200, JSON.stringify(eligible.body));
    assert.equal(eligible.body.data.length, 0);

    const planned = await fetchJson(await fetch(`${baseUrl}/api/logistics/trips/${winningTripId}/plan`, {
      method: 'POST',
      headers: authHeaders(config, `plan-${randomUUID()}`),
      body: JSON.stringify({}),
    }));
    assert.equal(planned.response.status, 200, JSON.stringify(planned.body));
    assert.equal(planned.body.data.trip.status, 'planned');

    const locked = await fetchJson(await fetch(`${baseUrl}/api/logistics/trips/${winningTripId}/lock`, {
      method: 'POST',
      headers: authHeaders(config, `lock-${randomUUID()}`),
      body: JSON.stringify({}),
    }));
    assert.equal(locked.response.status, 200, JSON.stringify(locked.body));
    assert.equal(locked.body.data.trip.status, 'locked');

    const lockedUpdate = await fetchJson(await fetch(`${baseUrl}/api/logistics/trips/${winningTripId}`, {
      method: 'PUT',
      headers: authHeaders(config, `update-locked-${randomUUID()}`),
      body: JSON.stringify({ ...payload, note: 'Không được sửa' }),
    }));
    assert.equal(lockedUpdate.response.status, 409, JSON.stringify(lockedUpdate.body));
    assert.equal(lockedUpdate.body.error.code, 'DELIVERY_TRIP_LOCKED');

    const evidence = await pool.query(
      `SELECT trip.status,
              count(assignment.id) FILTER (WHERE assignment.unassigned_at IS NULL)::int AS active_assignments
         FROM logistics.delivery_trips trip
         LEFT JOIN logistics.trip_order_assignments assignment
           ON assignment.installation_id = trip.installation_id
          AND assignment.trip_id = trip.id
        WHERE trip.installation_id = $1 AND trip.id = $2
        GROUP BY trip.id`,
      [config.installationId, winningTripId],
    );
    assert.deepEqual(evidence.rows[0], { status: 'locked', active_assignments: 1 });

    const audit = await pool.query(
      `SELECT count(*)::int AS count
         FROM shared.core_audit_records
        WHERE installation_id = $1
          AND resource_type = 'delivery_trip'
          AND action = 'core.delivery_trip.locked'`,
      [config.installationId],
    );
    const outbox = await pool.query(
      `SELECT count(*)::int AS count
         FROM shared.core_outbox_events
        WHERE installation_id = $1
          AND aggregate_type = 'logistics.delivery_trip'
          AND event_type = 'core.delivery_trip.locked'`,
      [config.installationId],
    );
    assert.equal(audit.rows[0].count, 1);
    assert.equal(outbox.rows[0].count, 1);
  } finally {
    if (server) await closeServer(server);
    await closePool();
  }
});

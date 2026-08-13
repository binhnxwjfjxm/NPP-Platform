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
    PORT: '3077',
    INSTALLATION_ID: `logistics-batch-${randomUUID()}`,
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

async function fetchJson(responseOrPromise) {
  const response = await responseOrPromise;
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
    receivedAt: '2026-08-13T03:00:00.000Z',
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
    scopes: Object.freeze({ branchIds: Object.freeze([]), warehouseIds: Object.freeze([warehouseId]), territoryIds: Object.freeze([]) }),
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

  await pool.query(`INSERT INTO shared.branches (id, installation_id, code, name, is_active, created_by, updated_by) VALUES ($1,$2,$3,$4,true,$5,$5)`, [branchId, installationId, `BR-${suffix}`, `Chi nhánh ${suffix}`, actor]);
  await pool.query(`INSERT INTO shared.warehouses (id, installation_id, branch_id, code, name, warehouse_type, is_active, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,'main',true,$6,$6)`, [warehouseId, installationId, branchId, `WH-${suffix}`, `Kho ${suffix}`, actor]);
  await pool.query(`INSERT INTO shared.warehouse_locations (id, installation_id, warehouse_id, code, name, location_type, is_active, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,'storage',true,$6,$6)`, [locationId, installationId, warehouseId, `A01-${suffix}`, `Kệ ${suffix}`, actor]);
  await pool.query(`INSERT INTO shared.customers (id, installation_id, code, name, payment_terms_days, credit_limit, is_active, created_by, updated_by) VALUES ($1,$2,$3,$4,15,10000000,true,$5,$5)`, [customerId, installationId, `CUS-${suffix}`, `Khách ${suffix}`, actor]);
  await pool.query(`INSERT INTO shared.customer_addresses (id, installation_id, customer_id, label, recipient_name, address_line1, ward, province, country_code, is_default, is_active, created_by, updated_by) VALUES ($1,$2,$3,'Cửa hàng','Người nhận','123 Đường giao hàng','Phường thử nghiệm','TP HCM','VN',true,true,$4,$4)`, [addressId, installationId, customerId, actor]);
  await pool.query(`INSERT INTO shared.units_of_measure (id, installation_id, code, name, unit_kind, allows_fractional, is_active, created_by, updated_by) VALUES ($1,$2,$3,$4,'COUNT',false,true,$5,$5)`, [unitId, installationId, `EA${suffix.slice(0, 4)}`, `Đơn vị ${suffix}`, actor]);
  await pool.query(`INSERT INTO shared.products (id, installation_id, code, name, is_orderable, is_active, created_by, updated_by) VALUES ($1,$2,$3,$4,true,true,$5,$5)`, [productId, installationId, `PR-${suffix}`, `Sản phẩm ${suffix}`, actor]);
  await pool.query(`INSERT INTO shared.product_variants (id, installation_id, product_id, sku, name, variant_kind, is_inventory_base, is_sellable, is_catalog_visible, is_active, unit_id, conversion_to_base, is_purchasable, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,'BASE',true,true,true,true,$6,1,true,$7,$7)`, [variantId, installationId, productId, `SKU-${suffix}`, `SKU ${suffix}`, unitId, actor]);
  await pool.query(`INSERT INTO shared.sales_channels (id, installation_id, code, name, is_active, created_by, updated_by) VALUES ($1,$2,$3,$4,true,$5,$5)`, [channelId, installationId, `CH-${suffix}`, `Kênh ${suffix}`, actor]);
  await pool.query(`INSERT INTO shared.price_lists (id, installation_id, code, name, list_type, currency_code, priority, stacking_mode, stop_processing, is_active, created_by, updated_by) VALUES ($1,$2,$3,$4,'BASE','VND',100,'EXCLUSIVE',true,true,$5,$5)`, [priceListId, installationId, `BASE-${suffix}`, `Giá ${suffix}`, actor]);
  await pool.query(`INSERT INTO shared.price_list_items (id, installation_id, price_list_id, variant_id, adjustment_type, amount_minor, min_quantity, source_kind, is_active, created_by, updated_by) VALUES ($1,$2,$3,$4,'FIXED_PRICE',10000,0,'ADMIN',true,$5,$5)`, [randomUUID(), installationId, priceListId, variantId, actor]);
  return { warehouseId, locationId, customerId, addressId, variantId, channelId };
}

async function seedInventory(pool, config, master) {
  const context = inventoryContext(config.installationId, master.warehouseId);
  const policy = await upsertInventoryTrackingPolicy(pool, {
    requestContext: context,
    payload: { baseVariantId: master.variantId, lotTrackingMode: 'REQUIRED', expiryTrackingMode: 'REQUIRED', locationRequired: true },
  });
  assert.equal(policy.ok, true, JSON.stringify(policy));
  const sourceKey = `logistics-batch-${randomUUID()}`;
  const unsignedPayload = {
    sourceKey,
    sourceFilename: `${sourceKey}.xlsx`,
    documentDate: '2026-08-13',
    metadata: { source: 'batch-assignment-integration' },
    rows: [{
      warehouseId: master.warehouseId,
      locationId: master.locationId,
      sourceVariantId: master.variantId,
      sourceQuantity: '20',
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
    sourceType: 'MANUAL', customerId: master.customerId, customerAddressId: master.addressId, warehouseId: master.warehouseId,
    salesChannelId: master.channelId, deliveryMode: 'DELIVERY', collectionPolicy: 'COLLECT_ON_DELIVERY', currency: 'VND',
    requestedDeliveryDate: '2026-08-14', note: 'Đơn kiểm thử batch điều phối',
    lines: [{ variantId: master.variantId, quantity: '3', discountMode: 'TOTAL_AMOUNT', discountValue: '0', taxMode: 'EXCLUSIVE', taxRate: '0' }],
  };
}

async function createReadyDeliveryOrder(baseUrl, config, master) {
  const created = await fetchJson(fetch(`${baseUrl}/api/sales-orders`, { method: 'POST', headers: authHeaders(config, `sales-create-${randomUUID()}`), body: JSON.stringify(salesOrderPayload(master)) }));
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const salesOrderId = created.body.data.id;
  const confirmed = await fetchJson(fetch(`${baseUrl}/api/sales-orders/${salesOrderId}/confirm`, { method: 'POST', headers: authHeaders(config, `sales-confirm-${randomUUID()}`), body: JSON.stringify({}) }));
  assert.equal(confirmed.response.status, 200, JSON.stringify(confirmed.body));
  const work = await fetchJson(fetch(`${baseUrl}/api/inventory/fulfillment-work`, { headers: authHeaders(config, null, false) }));
  const demand = work.body.data.find((item) => item.salesOrderId === salesOrderId);
  assert.ok(demand, JSON.stringify(work.body));
  const allocated = await fetchJson(fetch(`${baseUrl}/api/inventory/fulfillment-demands/${demand.fulfillmentDemandId}/allocate`, { method: 'POST', headers: authHeaders(config, `allocate-${randomUUID()}`), body: JSON.stringify({ mode: 'AUTO' }) }));
  assert.equal(allocated.response.status, 201, JSON.stringify(allocated.body));
  const allocation = allocated.body.data.allocation.allocations[0];
  const picked = await fetchJson(fetch(`${baseUrl}/api/inventory/fulfillment-allocations/${allocation.id}/pick`, { method: 'POST', headers: authHeaders(config, `pick-${randomUUID()}`), body: JSON.stringify({ quantity: '3' }) }));
  assert.equal(picked.response.status, 201, JSON.stringify(picked.body));
  const packed = await fetchJson(fetch(`${baseUrl}/api/inventory/fulfillment-allocations/${allocation.id}/pack`, { method: 'POST', headers: authHeaders(config, `pack-${randomUUID()}`), body: JSON.stringify({ quantity: '3' }) }));
  assert.equal(packed.response.status, 201, JSON.stringify(packed.body));
  const eligibility = await fetchJson(fetch(`${baseUrl}/api/delivery-orders/eligibility?salesOrderId=${salesOrderId}`, { headers: authHeaders(config, null, false) }));
  assert.equal(eligibility.response.status, 200, JSON.stringify(eligibility.body));
  const delivery = await fetchJson(fetch(`${baseUrl}/api/delivery-orders`, {
    method: 'POST', headers: authHeaders(config, `delivery-create-${randomUUID()}`),
    body: JSON.stringify({ lines: [{ fulfillmentAllocationId: eligibility.body.data[0].fulfillmentAllocationId, quantity: '3.000000000000' }] }),
  }));
  assert.equal(delivery.response.status, 201, JSON.stringify(delivery.body));
  const deliveryOrderId = delivery.body.data.deliveryOrder.id;
  const ready = await fetchJson(fetch(`${baseUrl}/api/delivery-orders/${deliveryOrderId}/confirm`, { method: 'POST', headers: authHeaders(config, `delivery-confirm-${randomUUID()}`), body: JSON.stringify({}) }));
  assert.equal(ready.response.status, 201, JSON.stringify(ready.body));
  return deliveryOrderId;
}

async function createTrip(baseUrl, config, warehouseId, note) {
  const result = await fetchJson(fetch(`${baseUrl}/api/logistics/trips`, {
    method: 'POST',
    headers: authHeaders(config, `trip-create-${randomUUID()}`),
    body: JSON.stringify({ warehouseId, deliveryRouteId: null, vehicleId: null, primaryDriverId: null, plannedStartAt: null, note }),
  }));
  assert.equal(result.response.status, 201, JSON.stringify(result.body));
  return result.body.data.trip.id;
}

async function assignBatch(baseUrl, config, tripId, deliveryOrderIds, key) {
  return fetchJson(fetch(`${baseUrl}/api/logistics/trips/${tripId}/assign`, {
    method: 'POST',
    headers: authHeaders(config, key),
    body: JSON.stringify({ deliveryOrderIds }),
  }));
}

test('trip batch assignment is atomic and idempotent across retry, collision and partial failure', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  let server;
  try {
    const master = await seedMasterData(pool, config.installationId);
    await seedInventory(pool, config, master);
    server = await startServer({ config });
    const baseUrl = `http://${config.host}:${config.port}`;

    const deliveryA = await createReadyDeliveryOrder(baseUrl, config, master);
    const deliveryB = await createReadyDeliveryOrder(baseUrl, config, master);
    const deliveryConflict = await createReadyDeliveryOrder(baseUrl, config, master);
    const targetTripId = await createTrip(baseUrl, config, master.warehouseId, 'Batch target');
    const competingTripId = await createTrip(baseUrl, config, master.warehouseId, 'Batch competing');

    const primed = await assignBatch(baseUrl, config, competingTripId, [deliveryConflict], `batch-prime-${randomUUID()}`);
    assert.equal(primed.response.status, 200, JSON.stringify(primed.body));

    const partial = await assignBatch(baseUrl, config, targetTripId, [deliveryA, deliveryConflict], `batch-partial-${randomUUID()}`);
    assert.equal(partial.response.status, 409, JSON.stringify(partial.body));
    assert.equal(partial.body.error.code, 'DELIVERY_ORDER_ALREADY_ASSIGNED');

    const afterPartial = await pool.query(
      `SELECT delivery_order_id FROM logistics.trip_order_assignments WHERE installation_id = $1 AND trip_id = $2 AND unassigned_at IS NULL`,
      [config.installationId, targetTripId],
    );
    assert.equal(afterPartial.rowCount, 0, 'partial failure must leave no assignment in target trip');
    const stopsAfterPartial = await pool.query(
      `SELECT id FROM logistics.trip_stops WHERE installation_id = $1 AND trip_id = $2`,
      [config.installationId, targetTripId],
    );
    assert.equal(stopsAfterPartial.rowCount, 0, 'partial failure must leave no stop in target trip');

    const key = `batch-valid-${randomUUID()}`;
    const first = await assignBatch(baseUrl, config, targetTripId, [deliveryB, deliveryA], key);
    assert.equal(first.response.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.data.replayed, false);
    assert.equal(first.body.data.assignmentCount, 2);

    const retry = await assignBatch(baseUrl, config, targetTripId, [deliveryA, deliveryB], key);
    assert.equal(retry.response.status, 200, JSON.stringify(retry.body));
    assert.equal(retry.body.data.replayed, true);

    const collision = await assignBatch(baseUrl, config, targetTripId, [deliveryA], key);
    assert.equal(collision.response.status, 409, JSON.stringify(collision.body));
    assert.equal(collision.body.error.code, 'IDEMPOTENCY_PAYLOAD_MISMATCH');

    const assignments = await pool.query(
      `SELECT delivery_order_id FROM logistics.trip_order_assignments WHERE installation_id = $1 AND trip_id = $2 AND unassigned_at IS NULL ORDER BY delivery_order_id`,
      [config.installationId, targetTripId],
    );
    assert.deepEqual(assignments.rows.map((row) => row.delivery_order_id).sort(), [deliveryA, deliveryB].sort());

    const events = await pool.query(
      `SELECT metadata FROM logistics.trip_events WHERE installation_id = $1 AND trip_id = $2 AND event_type = 'ASSIGNED'`,
      [config.installationId, targetTripId],
    );
    assert.equal(events.rowCount, 1, 'retry must not duplicate batch event');
    assert.equal(Number(events.rows[0].metadata.assignmentCount), 2);
    assert.equal(events.rows[0].metadata.assignments.length, 2);
  } finally {
    if (server) await closeServer(server);
    await closePool();
  }
});

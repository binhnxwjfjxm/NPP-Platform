import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
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
    PORT: '3099',
    INSTALLATION_ID: `fulfillment-hardening-${randomUUID()}`,
    DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://user:password@127.0.0.1:5432/npp_platform',
    DATABASE_SSL_MODE: 'disable',
    BACKEND_API_TOKEN: 'test-token-0123456789abcdef',
    CORE_BOOTSTRAP_ACTOR_ID: 'test:bootstrap',
    CORS_ORIGINS: 'http://127.0.0.1:3003',
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

function inventoryContext(installationId, warehouseId) {
  return Object.freeze({
    installationId,
    actorId: 'test:fulfillment-hardening',
    employeeId: null,
    sourceApp: 'npp-core-api',
    requestId: `req-${randomUUID()}`,
    receivedAt: new Date().toISOString(),
    roles: Object.freeze(['warehouse-operator']),
    permissions: Object.freeze([
      PERMISSIONS.coreInventoryRead,
      PERMISSIONS.coreInventoryPost,
      PERMISSIONS.coreInventoryTrackingPolicyRead,
      PERMISSIONS.coreInventoryTrackingPolicyManage,
      PERMISSIONS.coreInventoryLotRead,
      PERMISSIONS.coreInventoryLotManage,
      PERMISSIONS.coreInventoryOpeningBalanceImport,
      PERMISSIONS.coreFulfillmentRead,
      PERMISSIONS.coreFulfillmentAllocate,
      PERMISSIONS.coreFulfillmentPick,
      PERMISSIONS.coreFulfillmentPack,
    ]),
    scopes: Object.freeze({
      branchIds: Object.freeze([]),
      warehouseIds: Object.freeze([warehouseId]),
      territoryIds: Object.freeze([]),
    }),
  });
}

function authHeaders(config, key = null) {
  return {
    Authorization: `Bearer ${config.backendApiToken}`,
    'Content-Type': 'application/json',
    ...(key ? { 'Idempotency-Key': key } : {}),
  };
}

async function fetchJson(responsePromise) {
  const response = await responsePromise;
  const body = await response.json();
  return { response, body };
}

async function closeServer(server) {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

async function seedMaster(pool, installationId) {
  const actor = 'test:fixture';
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const receivedFirstLocationId = randomUUID();
  const receivedLaterLocationId = randomUUID();
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
     VALUES
      ($1,$3,$4,$5,$6,'storage',true,$8,$8),
      ($2,$3,$4,$7,$9,'storage',true,$8,$8)`,
    [
      receivedFirstLocationId,
      receivedLaterLocationId,
      installationId,
      warehouseId,
      `Z99-${suffix}`,
      `Nhập trước ${suffix}`,
      `A01-${suffix}`,
      actor,
      `Nhập sau ${suffix}`,
    ],
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
     VALUES ($1,$2,$3,'Cửa hàng','Người nhận','123 Đường thử nghiệm',
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

  return {
    warehouseId,
    receivedFirstLocationId,
    receivedLaterLocationId,
    customerId,
    addressId,
    variantId,
    channelId,
  };
}

async function seedNonExpiringLot(pool, context, master, { sourceKey, locationId, lotCode, quantity }) {
  const unsignedPayload = {
    sourceKey,
    sourceFilename: `${sourceKey}.xlsx`,
    documentDate: '2026-08-04',
    metadata: { source: 'phase-6d2-fifo-hardening' },
    rows: [{
      warehouseId: master.warehouseId,
      locationId,
      sourceVariantId: master.variantId,
      sourceQuantity: quantity,
      lotCode,
      manufacturedDate: '2026-01-01',
      sourceLineReference: `${sourceKey}!2`,
      metadata: { sourceKey },
    }],
  };
  const requestContext = Object.freeze({
    ...context,
    requestId: `req-opening-${randomUUID()}`,
    receivedAt: new Date().toISOString(),
  });
  const posted = await postOpeningBalanceImport({
    adapter: pool,
    requestContext,
    idempotencyKey: `opening-${sourceKey}-${randomUUID()}`,
    payload: { ...unsignedPayload, contentChecksum: sha256Hex(unsignedPayload) },
  });
  assert.equal(posted.ok, true, JSON.stringify(posted));
  return posted.rows[0];
}

function orderPayload(master, quantity) {
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
    lines: [{
      variantId: master.variantId,
      quantity,
      discountMode: 'TOTAL_AMOUNT',
      discountValue: '0',
      taxMode: 'EXCLUSIVE',
      taxRate: '0',
    }],
  };
}

async function createConfirmedOrder(baseUrl, config, master, quantity) {
  const created = await fetchJson(fetch(`${baseUrl}/api/sales-orders`, {
    method: 'POST',
    headers: authHeaders(config, `create-${randomUUID()}`),
    body: JSON.stringify(orderPayload(master, quantity)),
  }));
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const order = created.body.data;
  const confirmed = await fetchJson(fetch(`${baseUrl}/api/sales-orders/${order.id}/confirm`, {
    method: 'POST',
    headers: authHeaders(config, `confirm-${randomUUID()}`),
    body: JSON.stringify({}),
  }));
  assert.equal(confirmed.response.status, 200, JSON.stringify(confirmed.body));
  return confirmed.body.data;
}

async function findDemand(baseUrl, config, salesOrderId) {
  const queue = await fetchJson(fetch(`${baseUrl}/api/inventory/fulfillment-work`, {
    headers: { Authorization: `Bearer ${config.backendApiToken}` },
  }));
  assert.equal(queue.response.status, 200, JSON.stringify(queue.body));
  const demand = queue.body.data.find((item) => item.salesOrderId === salesOrderId);
  assert.ok(demand);
  return demand;
}

test('Phase 6D.2 hardening proves FIFO, blocks lifecycle transitions and serializes concurrent allocation', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  let server;
  try {
    const master = await seedMaster(pool, config.installationId);
    const context = inventoryContext(config.installationId, master.warehouseId);
    const policy = await upsertInventoryTrackingPolicy(pool, {
      requestContext: context,
      payload: {
        baseVariantId: master.variantId,
        lotTrackingMode: 'REQUIRED',
        expiryTrackingMode: 'NONE',
        locationRequired: true,
      },
    });
    assert.equal(policy.ok, true, JSON.stringify(policy));

    const firstReceived = await seedNonExpiringLot(pool, context, master, {
      sourceKey: `fifo-first-${randomUUID()}`,
      locationId: master.receivedFirstLocationId,
      lotCode: `LOT-FIRST-${randomUUID().slice(0, 8)}`,
      quantity: '5',
    });
    await delay(25);
    const laterReceived = await seedNonExpiringLot(pool, context, master, {
      sourceKey: `fifo-later-${randomUUID()}`,
      locationId: master.receivedLaterLocationId,
      lotCode: `LOT-LATER-${randomUUID().slice(0, 8)}`,
      quantity: '5',
    });

    server = await startServer({ config });
    const baseUrl = `http://${config.host}:${config.port}`;
    const firstOrder = await createConfirmedOrder(baseUrl, config, master, '2');
    const firstDemand = await findDemand(baseUrl, config, firstOrder.id);
    const suggestions = await fetchJson(fetch(
      `${baseUrl}/api/inventory/fulfillment-demands/${firstDemand.fulfillmentDemandId}/suggestions`,
      { headers: { Authorization: `Bearer ${config.backendApiToken}` } },
    ));
    assert.equal(suggestions.response.status, 200, JSON.stringify(suggestions.body));
    assert.equal(suggestions.body.data.candidates[0].lotId, firstReceived.lot_id);
    assert.equal(suggestions.body.data.candidates[0].allocationPolicy, 'FIFO');
    assert.equal(suggestions.body.data.candidates[1].lotId, laterReceived.lot_id);

    const allocated = await fetchJson(fetch(
      `${baseUrl}/api/inventory/fulfillment-demands/${firstDemand.fulfillmentDemandId}/allocate`,
      {
        method: 'POST',
        headers: authHeaders(config, `fifo-allocate-${randomUUID()}`),
        body: JSON.stringify({ mode: 'AUTO' }),
      },
    ));
    assert.equal(allocated.response.status, 201, JSON.stringify(allocated.body));
    assert.equal(allocated.body.data.allocation.allocations[0].lotId, firstReceived.lot_id);

    for (const nextState of ['CANCELLED', 'SUPERSEDED']) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          "SELECT set_config('npp.sales_fulfillment_write_context', 'fulfillment_service', true)",
        );
        await assert.rejects(
          client.query(
            `UPDATE sales.sales_order_fulfillment_demands
                SET state = $3, updated_at = now(), updated_by = 'test:lifecycle'
              WHERE installation_id = $1 AND id = $2`,
            [config.installationId, firstDemand.fulfillmentDemandId, nextState],
          ),
          /sales_fulfillment_transition_blocked_by_allocation/,
        );
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    }

    const cancel = await fetchJson(fetch(`${baseUrl}/api/sales-orders/${firstOrder.id}/cancel`, {
      method: 'POST',
      headers: authHeaders(config, `cancel-${randomUUID()}`),
      body: JSON.stringify({ reason: 'Không được hủy sau khi kho đã phân bổ' }),
    }));
    assert.ok(cancel.response.status >= 400, JSON.stringify(cancel.body));
    const lifecycleEvidence = await pool.query(
      `SELECT
         (SELECT status FROM sales.sales_orders WHERE installation_id=$1 AND id=$2) AS order_status,
         (SELECT state FROM sales.sales_order_fulfillment_demands WHERE installation_id=$1 AND id=$3) AS demand_state,
         (SELECT count(*)::int FROM inventory.inventory_reservations
           WHERE installation_id=$1 AND source_document_type='SALES_FULFILLMENT_ALLOCATION' AND state='ACTIVE') AS active_reservations`,
      [config.installationId, firstOrder.id, firstDemand.fulfillmentDemandId],
    );
    assert.deepEqual(lifecycleEvidence.rows[0], {
      order_status: 'confirmed',
      demand_state: 'ACTIVE',
      active_reservations: 1,
    });

    const secondOrder = await createConfirmedOrder(baseUrl, config, master, '2');
    const secondDemand = await findDemand(baseUrl, config, secondOrder.id);
    const requestA = fetch(
      `${baseUrl}/api/inventory/fulfillment-demands/${secondDemand.fulfillmentDemandId}/allocate`,
      {
        method: 'POST',
        headers: authHeaders(config, `concurrent-a-${randomUUID()}`),
        body: JSON.stringify({ mode: 'AUTO' }),
      },
    ).then(async (response) => ({ response, body: await response.json() }));
    const requestB = fetch(
      `${baseUrl}/api/inventory/fulfillment-demands/${secondDemand.fulfillmentDemandId}/allocate`,
      {
        method: 'POST',
        headers: authHeaders(config, `concurrent-b-${randomUUID()}`),
        body: JSON.stringify({ mode: 'AUTO' }),
      },
    ).then(async (response) => ({ response, body: await response.json() }));
    const concurrent = await Promise.all([requestA, requestB]);
    assert.deepEqual(concurrent.map((entry) => entry.response.status).sort(), [201, 409]);

    const concurrentEvidence = await pool.query(
      `SELECT count(*)::int AS allocations,
              COALESCE(sum(allocated_base_quantity), 0)::text AS quantity
         FROM sales.sales_order_fulfillment_allocations
        WHERE installation_id=$1 AND sales_order_id=$2`,
      [config.installationId, secondOrder.id],
    );
    assert.deepEqual(concurrentEvidence.rows[0], {
      allocations: 1,
      quantity: '2.000000000000',
    });
  } finally {
    if (server) await closeServer(server);
    await closePool();
  }
});

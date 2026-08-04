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
    PORT: '3062',
    INSTALLATION_ID: `fulfillment-operations-${randomUUID()}`,
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
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function sha256Hex(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function requestContext(installationId, warehouseId, requestId) {
  return Object.freeze({
    installationId,
    actorId: 'test:fulfillment-operator',
    employeeId: null,
    sourceApp: 'npp-core-api',
    requestId,
    receivedAt: '2026-08-04T03:00:00.000Z',
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

function authHeaders(config, key, withJson = true) {
  return {
    Authorization: `Bearer ${config.backendApiToken}`,
    ...(withJson ? { 'Content-Type': 'application/json' } : {}),
    ...(key ? { 'Idempotency-Key': key } : {}),
  };
}

function closeServer(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

async function seedMasterData(pool, installationId) {
  const actor = 'test:fixture';
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const earlyLocationId = randomUUID();
  const lateLocationId = randomUUID();
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
      earlyLocationId,
      lateLocationId,
      installationId,
      warehouseId,
      `A01-${suffix}`,
      `Kệ lô sớm ${suffix}`,
      `B01-${suffix}`,
      actor,
      `Kệ lô muộn ${suffix}`,
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
    earlyLocationId,
    lateLocationId,
    customerId,
    addressId,
    variantId,
    channelId,
  };
}

async function seedLotBalance(pool, context, master, {
  sourceKey,
  locationId,
  quantity,
  lotCode,
  expiryDate,
}) {
  const unsignedPayload = {
    sourceKey,
    sourceFilename: `${sourceKey}.xlsx`,
    documentDate: '2026-08-04',
    metadata: { source: 'phase-6d2-integration' },
    rows: [{
      warehouseId: master.warehouseId,
      locationId,
      sourceVariantId: master.variantId,
      sourceQuantity: quantity,
      lotCode,
      manufacturedDate: '2026-01-01',
      expiryDate,
      sourceLineReference: `${sourceKey}!2`,
      metadata: { sourceKey },
    }],
  };
  const posted = await postOpeningBalanceImport({
    adapter: pool,
    requestContext: context,
    idempotencyKey: `opening-${sourceKey}-${randomUUID()}`,
    payload: {
      ...unsignedPayload,
      contentChecksum: sha256Hex(unsignedPayload),
    },
  });
  assert.equal(posted.ok, true, JSON.stringify(posted));
  return posted.rows[0];
}

function salesOrderPayload(master, quantity) {
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
    note: 'Đơn kiểm thử chuẩn bị hàng',
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

async function fetchJson(response) {
  const body = await response.json();
  return { response, body };
}

async function createAndConfirmOrder(baseUrl, config, master, quantity) {
  const createResult = await fetchJson(await fetch(`${baseUrl}/api/sales-orders`, {
    method: 'POST',
    headers: authHeaders(config, `create-${randomUUID()}`),
    body: JSON.stringify(salesOrderPayload(master, quantity)),
  }));
  assert.equal(createResult.response.status, 201, JSON.stringify(createResult.body));
  const created = createResult.body.data;

  const confirmResult = await fetchJson(await fetch(
    `${baseUrl}/api/sales-orders/${created.id}/confirm`,
    {
      method: 'POST',
      headers: authHeaders(config, `confirm-${randomUUID()}`),
      body: JSON.stringify({}),
    },
  ));
  assert.equal(confirmResult.response.status, 200, JSON.stringify(confirmResult.body));
  return confirmResult.body.data;
}

test('Phase 6D.2 allocates FEFO, creates exact reservations and keeps pick/pack monotonic', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  let server;
  try {
    const master = await seedMasterData(pool, config.installationId);
    const inventoryContext = requestContext(
      config.installationId,
      master.warehouseId,
      `req-seed-${randomUUID()}`,
    );
    const policy = await upsertInventoryTrackingPolicy(pool, {
      requestContext: inventoryContext,
      payload: {
        baseVariantId: master.variantId,
        lotTrackingMode: 'REQUIRED',
        expiryTrackingMode: 'REQUIRED',
        locationRequired: true,
      },
    });
    assert.equal(policy.ok, true, JSON.stringify(policy));

    const early = await seedLotBalance(pool, inventoryContext, master, {
      sourceKey: `early-${randomUUID()}`,
      locationId: master.earlyLocationId,
      quantity: '3',
      lotCode: `LOT-EARLY-${randomUUID().slice(0, 8)}`,
      expiryDate: '2026-10-01',
    });
    const late = await seedLotBalance(pool, inventoryContext, master, {
      sourceKey: `late-${randomUUID()}`,
      locationId: master.lateLocationId,
      quantity: '7',
      lotCode: `LOT-LATE-${randomUUID().slice(0, 8)}`,
      expiryDate: '2026-12-01',
    });

    server = await startServer({ config });
    const baseUrl = `http://${config.host}:${config.port}`;
    const confirmed = await createAndConfirmOrder(baseUrl, config, master, '8');
    assert.equal(confirmed.status, 'confirmed');
    assert.equal(confirmed.fulfillmentStatus, 'reserved');
    assert.equal(confirmed.fulfillment.lines[0].reservedBaseQuantity, '8.000000000000');

    const workResult = await fetchJson(await fetch(
      `${baseUrl}/api/inventory/fulfillment-work`,
      { headers: authHeaders(config, null, false) },
    ));
    assert.equal(workResult.response.status, 200, JSON.stringify(workResult.body));
    assert.equal(workResult.body.data.length, 1);
    const demandId = workResult.body.data[0].fulfillmentDemandId;

    const suggestionResult = await fetchJson(await fetch(
      `${baseUrl}/api/inventory/fulfillment-demands/${demandId}/suggestions`,
      { headers: authHeaders(config, null, false) },
    ));
    assert.equal(suggestionResult.response.status, 200, JSON.stringify(suggestionResult.body));
    assert.equal(suggestionResult.body.data.candidates[0].lotId, early.lot_id);
    assert.equal(suggestionResult.body.data.candidates[0].allocationPolicy, 'FEFO');
    assert.equal(suggestionResult.body.data.candidates[1].lotId, late.lot_id);
    assert.deepEqual(
      suggestionResult.body.data.suggestedPlan.map((item) => item.quantity),
      ['3.000000000000', '5.000000000000'],
    );

    const allocateKey = `allocate-${randomUUID()}`;
    const allocatedResult = await fetchJson(await fetch(
      `${baseUrl}/api/inventory/fulfillment-demands/${demandId}/allocate`,
      {
        method: 'POST',
        headers: authHeaders(config, allocateKey),
        body: JSON.stringify({ mode: 'AUTO' }),
      },
    ));
    assert.equal(allocatedResult.response.status, 201, JSON.stringify(allocatedResult.body));
    assert.equal(allocatedResult.body.data.allocation.allocations.length, 2);

    const replayResult = await fetchJson(await fetch(
      `${baseUrl}/api/inventory/fulfillment-demands/${demandId}/allocate`,
      {
        method: 'POST',
        headers: authHeaders(config, allocateKey),
        body: JSON.stringify({ mode: 'AUTO' }),
      },
    ));
    assert.equal(replayResult.response.status, 200, JSON.stringify(replayResult.body));
    assert.equal(replayResult.body.data.replayed, true);

    const detailResult = await fetchJson(await fetch(
      `${baseUrl}/api/inventory/fulfillment-demands/${demandId}/suggestions`,
      { headers: authHeaders(config, null, false) },
    ));
    const allocations = detailResult.body.data.allocations;
    assert.equal(allocations.length, 2);
    assert.equal(allocations[0].lotId, early.lot_id);
    assert.equal(allocations[0].allocatedBaseQuantity, '3.000000000000');
    assert.equal(allocations[1].lotId, late.lot_id);
    assert.equal(allocations[1].allocatedBaseQuantity, '5.000000000000');

    const packBeforePick = await fetchJson(await fetch(
      `${baseUrl}/api/inventory/fulfillment-allocations/${allocations[0].id}/pack`,
      {
        method: 'POST',
        headers: authHeaders(config, `pack-before-pick-${randomUUID()}`),
        body: JSON.stringify({ quantity: '1' }),
      },
    ));
    assert.equal(packBeforePick.response.status, 409);
    assert.equal(packBeforePick.body.error.code, 'PACK_EXCEEDS_PICKED');

    const overPick = await fetchJson(await fetch(
      `${baseUrl}/api/inventory/fulfillment-allocations/${allocations[0].id}/pick`,
      {
        method: 'POST',
        headers: authHeaders(config, `over-pick-${randomUUID()}`),
        body: JSON.stringify({ quantity: '4' }),
      },
    ));
    assert.equal(overPick.response.status, 409);
    assert.equal(overPick.body.error.code, 'PICK_EXCEEDS_ALLOCATION');

    for (const allocation of allocations) {
      const picked = await fetchJson(await fetch(
        `${baseUrl}/api/inventory/fulfillment-allocations/${allocation.id}/pick`,
        {
          method: 'POST',
          headers: authHeaders(config, `pick-${allocation.id}`),
          body: JSON.stringify({ quantity: allocation.allocatedBaseQuantity }),
        },
      ));
      assert.equal(picked.response.status, 201, JSON.stringify(picked.body));
      assert.equal(picked.body.data.allocation.pickedBaseQuantity, allocation.allocatedBaseQuantity);

      const packed = await fetchJson(await fetch(
        `${baseUrl}/api/inventory/fulfillment-allocations/${allocation.id}/pack`,
        {
          method: 'POST',
          headers: authHeaders(config, `pack-${allocation.id}`),
          body: JSON.stringify({ quantity: allocation.allocatedBaseQuantity }),
        },
      ));
      assert.equal(packed.response.status, 201, JSON.stringify(packed.body));
      assert.equal(packed.body.data.allocation.packedBaseQuantity, allocation.allocatedBaseQuantity);
      assert.equal(packed.body.data.allocation.state, 'COMPLETED');
    }

    const finalWork = await fetchJson(await fetch(
      `${baseUrl}/api/inventory/fulfillment-work`,
      { headers: authHeaders(config, null, false) },
    ));
    assert.equal(finalWork.body.data[0].fulfillmentStatus, 'packed');
    assert.equal(finalWork.body.data[0].allocatedBaseQuantity, '8.000000000000');
    assert.equal(finalWork.body.data[0].pickedBaseQuantity, '8.000000000000');
    assert.equal(finalWork.body.data[0].packedBaseQuantity, '8.000000000000');

    const evidence = await pool.query(
      `SELECT
         (SELECT count(*)::int
            FROM inventory.inventory_reservations
           WHERE installation_id = $1
             AND source_document_type = 'SALES_FULFILLMENT_ALLOCATION'
             AND state = 'ACTIVE') AS reservations,
         (SELECT COALESCE(sum(quantity), 0)::text
            FROM inventory.inventory_reservations
           WHERE installation_id = $1
             AND source_document_type = 'SALES_FULFILLMENT_ALLOCATION'
             AND state = 'ACTIVE') AS reserved_quantity,
         (SELECT count(*)::int
            FROM sales.sales_order_fulfillment_allocation_events
           WHERE installation_id = $1
             AND event_type = 'ALLOCATED') AS allocated_events,
         (SELECT count(*)::int
            FROM sales.sales_order_fulfillment_allocation_events
           WHERE installation_id = $1
             AND event_type = 'PICKED') AS picked_events,
         (SELECT count(*)::int
            FROM sales.sales_order_fulfillment_allocation_events
           WHERE installation_id = $1
             AND event_type = 'PACKED') AS packed_events,
         (SELECT count(*)::int
            FROM shared.core_audit_records
           WHERE installation_id = $1
             AND resource_type IN ('sales_fulfillment_demand', 'sales_fulfillment_allocation')) AS audits,
         (SELECT count(*)::int
            FROM shared.core_outbox_events
           WHERE installation_id = $1
             AND aggregate_type IN ('sales.fulfillment_demand', 'sales.fulfillment_allocation')) AS events`,
      [config.installationId],
    );
    assert.deepEqual(evidence.rows[0], {
      reservations: 2,
      reserved_quantity: '8.000000000000',
      allocated_events: 2,
      picked_events: 2,
      packed_events: 2,
      audits: 5,
      events: 5,
    });

    const second = await createAndConfirmOrder(baseUrl, config, master, '2');
    assert.equal(second.fulfillmentStatus, 'reserved');
    const queueAfterSecond = await fetchJson(await fetch(
      `${baseUrl}/api/inventory/fulfillment-work`,
      { headers: authHeaders(config, null, false) },
    ));
    const secondWork = queueAfterSecond.body.data.find((item) => item.salesOrderId === second.id);
    assert.ok(secondWork);

    const concurrent = await Promise.all([
      fetchJson(await fetch(
        `${baseUrl}/api/inventory/fulfillment-demands/${secondWork.fulfillmentDemandId}/allocate`,
        {
          method: 'POST',
          headers: authHeaders(config, `concurrent-a-${randomUUID()}`),
          body: JSON.stringify({ mode: 'AUTO' }),
        },
      )),
      fetchJson(await fetch(
        `${baseUrl}/api/inventory/fulfillment-demands/${secondWork.fulfillmentDemandId}/allocate`,
        {
          method: 'POST',
          headers: authHeaders(config, `concurrent-b-${randomUUID()}`),
          body: JSON.stringify({ mode: 'AUTO' }),
        },
      )),
    ]);
    assert.deepEqual(concurrent.map((entry) => entry.response.status).sort(), [201, 409]);

    const secondTotals = await pool.query(
      `SELECT
         count(*)::int AS allocations,
         COALESCE(sum(allocated_base_quantity), 0)::text AS allocated_quantity
       FROM sales.sales_order_fulfillment_allocations
       WHERE installation_id = $1
         AND sales_order_id = $2`,
      [config.installationId, second.id],
    );
    assert.deepEqual(secondTotals.rows[0], {
      allocations: 1,
      allocated_quantity: '2.000000000000',
    });
  } finally {
    if (server) await closeServer(server);
    await closePool();
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { getPool, closePool } from '../src/db/pool.js';
import { startServer } from '../src/server.js';
import { replenishPendingHoldScopes, lockWarehouseStockScopes } from '../src/services/sales-fulfillment-replenishment.js';

function closeServer(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

function authHeaders(config, key) {
  return {
    Authorization: `Bearer ${config.backendApiToken}`,
    'Content-Type': 'application/json',
    'Idempotency-Key': key,
  };
}

async function createFixture(pool, installationId) {
  const actor = 'test:fulfillment-fixture';
  const suffix = randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
  const fixture = {
    branchId: randomUUID(),
    warehouseId: randomUUID(),
    customerId: randomUUID(),
    addressId: randomUUID(),
    unitId: randomUUID(),
    productId: randomUUID(),
    variantId: randomUUID(),
    channelId: randomUUID(),
    priceListId: randomUUID(),
    priceItemId: randomUUID(),
  };

  await pool.query(
    `INSERT INTO shared.branches
       (id, installation_id, code, name, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,true,$5,$5)`,
    [fixture.branchId, installationId, `BR-${suffix}`, `Chi nhánh ${suffix}`, actor],
  );
  await pool.query(
    `INSERT INTO shared.warehouses
       (id, installation_id, branch_id, code, name, warehouse_type, location_management_mode, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,'main','UNMANAGED',true,$6,$6)`,
    [fixture.warehouseId, installationId, fixture.branchId, `WH-${suffix}`, `Kho ${suffix}`, actor],
  );
  await pool.query(
    `INSERT INTO shared.customers
       (id, installation_id, code, name, payment_terms_days, credit_limit,
        is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,15,10000000,true,$5,$5)`,
    [fixture.customerId, installationId, `CUS-${suffix}`, `Khách ${suffix}`, actor],
  );
  await pool.query(
    `INSERT INTO shared.customer_addresses
       (id, installation_id, customer_id, label, recipient_name, address_line1,
        province, country_code, is_default, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,'Cửa hàng','Người nhận','123 Đường kiểm thử',
       'TP HCM','VN',true,true,$4,$4)`,
    [fixture.addressId, installationId, fixture.customerId, actor],
  );
  await pool.query(
    `INSERT INTO shared.units_of_measure
       (id, installation_id, code, name, unit_kind, allows_fractional, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,'COUNT',true,true,$5,$5)`,
    [fixture.unitId, installationId, `EA${suffix.slice(0, 4)}`, `Đơn vị ${suffix}`, actor],
  );
  await pool.query(
    `INSERT INTO shared.products
       (id, installation_id, code, name, is_orderable, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,true,true,$5,$5)`,
    [fixture.productId, installationId, `PR-${suffix}`, `Sản phẩm ${suffix}`, actor],
  );
  await pool.query(
    `INSERT INTO shared.product_variants
       (id, installation_id, product_id, sku, name, variant_kind,
        is_inventory_base, is_sellable, is_catalog_visible, is_active,
        unit_id, conversion_to_base, is_purchasable, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,'BASE',true,true,true,true,$6,1,true,$7,$7)`,
    [fixture.variantId, installationId, fixture.productId, `SKU-${suffix}`, `SKU ${suffix}`, fixture.unitId, actor],
  );
  await pool.query(
    `INSERT INTO shared.sales_channels
       (id, installation_id, code, name, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,true,$5,$5)`,
    [fixture.channelId, installationId, `CH-${suffix}`, `Kênh ${suffix}`, actor],
  );
  await pool.query(
    `INSERT INTO shared.price_lists
       (id, installation_id, code, name, list_type, currency_code, priority,
        stacking_mode, stop_processing, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,'BASE','VND',100,'EXCLUSIVE',true,true,$5,$5)`,
    [fixture.priceListId, installationId, `BASE-${suffix}`, `Giá ${suffix}`, actor],
  );
  await pool.query(
    `INSERT INTO shared.price_list_items
       (id, installation_id, price_list_id, variant_id, adjustment_type,
        amount_minor, min_quantity, source_kind, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,'FIXED_PRICE',10000,0,'ADMIN',true,$5,$5)`,
    [fixture.priceItemId, installationId, fixture.priceListId, fixture.variantId, actor],
  );
  await pool.query(
    `INSERT INTO shared.sales_order_settings
       (installation_id, allow_backorder, created_by, updated_by)
     VALUES ($1,true,$2,$2)
     ON CONFLICT (installation_id) DO UPDATE
       SET allow_backorder=true, updated_at=now(), updated_by=EXCLUDED.updated_by`,
    [installationId, actor],
  );

  const balanceClient = await pool.connect();
  try {
    await balanceClient.query('BEGIN');
    await balanceClient.query(
      "SELECT set_config('npp.inventory_balance_write_context', 'rebuild', true)",
    );
    await balanceClient.query(
      `INSERT INTO inventory.inventory_balances (
         installation_id, warehouse_id, location_id, base_variant_id, lot_id,
         on_hand_quantity, reserved_quantity, updated_at
       ) VALUES ($1,$2,NULL,$3,NULL,5,0,now())`,
      [installationId, fixture.warehouseId, fixture.variantId],
    );
    await balanceClient.query('COMMIT');
  } catch (error) {
    await balanceClient.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    balanceClient.release();
  }

  return fixture;
}

function orderPayload(fixture, quantity) {
  return {
    sourceType: 'MANUAL',
    customerId: fixture.customerId,
    customerAddressId: fixture.addressId,
    warehouseId: fixture.warehouseId,
    salesChannelId: fixture.channelId,
    deliveryMode: 'DELIVERY',
    collectionPolicy: 'COLLECT_ON_DELIVERY',
    currency: 'VND',
    lines: [{
      variantId: fixture.variantId,
      quantity: String(quantity),
      discountMode: 'TOTAL_AMOUNT',
      discountValue: '0',
      taxMode: 'EXCLUSIVE',
      taxRate: '0',
    }],
  };
}

async function createOrder(baseUrl, config, fixture, quantity) {
  const response = await fetch(`${baseUrl}/api/sales-orders`, {
    method: 'POST',
    headers: authHeaders(config, `create-${randomUUID()}`),
    body: JSON.stringify(orderPayload(fixture, quantity)),
  });
  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  return body.data;
}

async function confirmOrder(baseUrl, config, orderId) {
  const response = await fetch(`${baseUrl}/api/sales-orders/${orderId}/confirm`, {
    method: 'POST',
    headers: authHeaders(config, `confirm-${randomUUID()}`),
    body: JSON.stringify({}),
  });
  const body = await response.json();
  return { response, body };
}

test('confirmed orders reserve warehouse demand, prevent oversell and release on cancel', async () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3066',
    INSTALLATION_ID: `sales-fulfillment-test-${randomUUID()}`,
    DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://user:password@127.0.0.1:5432/npp_platform',
    DATABASE_SSL_MODE: 'disable',
    BACKEND_API_TOKEN: 'test-token-0123456789abcdef',
    CORE_BOOTSTRAP_ACTOR_ID: 'test:fulfillment-bootstrap',
    CORS_ORIGINS: 'http://127.0.0.1:3003',
  });
  const pool = getPool(config);
  let server;
  try {
    const fixture = await createFixture(pool, config.installationId);
    server = await startServer({ config });
    const baseUrl = `http://${config.host}:${config.port}`;

    const first = await createOrder(baseUrl, config, fixture, 4);
    const firstConfirm = await confirmOrder(baseUrl, config, first.id);
    assert.equal(firstConfirm.response.status, 200, JSON.stringify(firstConfirm.body));
    assert.equal(firstConfirm.body.data.fulfillmentStatus, 'reserved');
    assert.equal(firstConfirm.body.data.fulfillment.totals.reservedBaseQuantity, '4.000000000000');
    assert.equal(firstConfirm.body.data.fulfillment.totals.backorderedBaseQuantity, '0.000000000000');

    const reservationClient = await pool.connect();
    try {
      await reservationClient.query('BEGIN');
      await reservationClient.query(
        "SELECT set_config('npp.inventory_reservation_write_context', 'reservation_service', true)",
      );
      await assert.rejects(
        reservationClient.query(
          `INSERT INTO inventory.inventory_reservations (
             id, installation_id, warehouse_id, location_id, base_variant_id, lot_id,
             quantity, state, source_domain, source_document_type, source_document_id,
             idempotency_key, payload_hash, metadata
           ) VALUES ($1,$2,$3,NULL,$4,NULL,2,'ACTIVE','TEST','TEST',$5,$6,$7,'{}'::jsonb)`,
          [
            randomUUID(), config.installationId, fixture.warehouseId, fixture.variantId,
            first.id, `manual-${randomUUID()}`, 'a'.repeat(64),
          ],
        ),
        /inventory_sales_fulfillment_reservation_denied/,
      );
      await reservationClient.query('ROLLBACK');
    } finally {
      reservationClient.release();
    }

    const second = await createOrder(baseUrl, config, fixture, 3);
    const secondConfirm = await confirmOrder(baseUrl, config, second.id);
    assert.equal(secondConfirm.response.status, 200, JSON.stringify(secondConfirm.body));
    assert.equal(secondConfirm.body.data.fulfillmentStatus, 'partially_reserved');
    assert.equal(secondConfirm.body.data.fulfillment.totals.reservedBaseQuantity, '1.000000000000');
    assert.equal(secondConfirm.body.data.fulfillment.totals.backorderedBaseQuantity, '2.000000000000');

    await pool.query(
      `UPDATE shared.sales_order_settings
          SET allow_backorder=false, updated_at=now(), updated_by='test:policy'
        WHERE installation_id=$1`,
      [config.installationId],
    );

    const blocked = await createOrder(baseUrl, config, fixture, 1);
    const blockedConfirm = await confirmOrder(baseUrl, config, blocked.id);
    assert.notEqual(blockedConfirm.response.status, 200);
    assert.equal(blockedConfirm.body.error.code, 'SALES_ORDER_INSUFFICIENT_STOCK');
    const blockedState = await pool.query(
      `SELECT status,
              (SELECT count(*)::int
                 FROM sales.sales_order_fulfillment_demands demand
                WHERE demand.installation_id=orders.installation_id
                  AND demand.sales_order_id=orders.id) AS demand_count
         FROM sales.sales_orders orders
        WHERE installation_id=$1 AND id=$2`,
      [config.installationId, blocked.id],
    );
    assert.deepEqual(blockedState.rows[0], { status: 'draft', demand_count: 0 });

    const cancelResponse = await fetch(`${baseUrl}/api/sales-orders/${first.id}/cancel`, {
      method: 'POST',
      headers: authHeaders(config, `cancel-${randomUUID()}`),
      body: JSON.stringify({ reason: 'Giải phóng hàng kiểm thử' }),
    });
    const cancelBody = await cancelResponse.json();
    assert.equal(cancelResponse.status, 200, JSON.stringify(cancelBody));
    const cancelled = cancelBody.data;
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.fulfillmentStatus, 'cancelled');

    const demandStates = await pool.query(
      `SELECT sales_order_id, state, reserved_base_quantity::text, backordered_base_quantity::text
         FROM sales.sales_order_fulfillment_demands
        WHERE installation_id=$1 AND sales_order_id = ANY($2::uuid[])
        ORDER BY sales_order_id`,
      [config.installationId, [first.id, second.id]],
    );
    const firstDemand = demandStates.rows.find((row) => row.sales_order_id === first.id);
    const secondDemand = demandStates.rows.find((row) => row.sales_order_id === second.id);
    assert.equal(firstDemand?.state, 'CANCELLED');
    assert.equal(secondDemand?.state, 'ACTIVE');

    // Cancel releases to the oldest waiting order before a fresh confirmation.
    const waitingAfterCancel = await pool.query(
      `SELECT reserved_base_quantity::text AS held, backordered_base_quantity::text AS waiting
         FROM sales.sales_order_fulfillment_demands
        WHERE installation_id=$1 AND sales_order_id=$2 AND state='ACTIVE'`,
      [config.installationId, second.id],
    );
    assert.deepEqual(waitingAfterCancel.rows[0], {
      held: '3.000000000000', waiting: '0.000000000000',
    });
    const released = await createOrder(baseUrl, config, fixture, 4);
    const releasedConfirm = await confirmOrder(baseUrl, config, released.id);
    assert.equal(releasedConfirm.response.status, 400);
    assert.equal(releasedConfirm.body.error.code, 'SALES_ORDER_INSUFFICIENT_STOCK');
  } finally {
    if (server) await closeServer(server);
    await closePool();
  }
});

test('existing waiting orders receive a later stock increase in confirmation order without changing physical stock', async () => {
  const config = loadConfig({
    NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '3074',
    INSTALLATION_ID: `sales-replenishment-test-${randomUUID()}`,
    DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://user:password@127.0.0.1:5432/npp_platform',
    DATABASE_SSL_MODE: 'disable',
    BACKEND_API_TOKEN: 'test-token-0123456789abcdef',
    CORE_BOOTSTRAP_ACTOR_ID: 'test:fulfillment-bootstrap',
    CORS_ORIGINS: 'http://127.0.0.1:3003',
  });
  const pool = getPool(config);
  let server;
  try {
    const fixture = await createFixture(pool, config.installationId);
    server = await startServer({ config });
    const baseUrl = `http://${config.host}:${config.port}`;
    const first = await createOrder(baseUrl, config, fixture, 10);
    const firstConfirm = await confirmOrder(baseUrl, config, first.id);
    assert.equal(firstConfirm.response.status, 200, JSON.stringify(firstConfirm.body));
    assert.equal(firstConfirm.body.data.fulfillment.totals.backorderedBaseQuantity, '5.000000000000');
    const second = await createOrder(baseUrl, config, fixture, 4);
    const secondConfirm = await confirmOrder(baseUrl, config, second.id);
    assert.equal(secondConfirm.response.status, 200, JSON.stringify(secondConfirm.body));
    assert.equal(secondConfirm.body.data.fulfillment.totals.reservedBaseQuantity, '0.000000000000');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('npp.inventory_balance_write_context', 'rebuild', true)");
      await client.query(
        `UPDATE inventory.inventory_balances
            SET on_hand_quantity = 12, updated_at = now()
          WHERE installation_id=$1 AND warehouse_id=$2 AND base_variant_id=$3`,
        [config.installationId, fixture.warehouseId, fixture.variantId],
      );
      const args = {
        installationId: config.installationId, actorId: 'test:replenishment',
        scopes: [{ warehouseId: fixture.warehouseId, baseVariantId: fixture.variantId }],
      };
      assert.equal((await replenishPendingHoldScopes(client, args)).updatedLines, 2);
      assert.equal((await replenishPendingHoldScopes(client, args)).updatedLines, 0);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }

    const rows = await pool.query(
      `SELECT sales_order_id, reserved_base_quantity::text AS held,
              backordered_base_quantity::text AS waiting
         FROM sales.sales_order_fulfillment_demands
        WHERE installation_id=$1 AND sales_order_id=ANY($2::uuid[])
        ORDER BY sales_order_id`,
      [config.installationId, [first.id, second.id]],
    );
    const byOrder = new Map(rows.rows.map((row) => [row.sales_order_id, row]));
    assert.equal(byOrder.get(first.id)?.held, '10.000000000000');
    assert.equal(byOrder.get(first.id)?.waiting, '0.000000000000');
    assert.equal(byOrder.get(second.id)?.held, '2.000000000000');
    assert.equal(byOrder.get(second.id)?.waiting, '2.000000000000');
    const onHand = await pool.query(
      `SELECT on_hand_quantity::text AS qty FROM inventory.inventory_balances
         WHERE installation_id=$1 AND warehouse_id=$2 AND base_variant_id=$3`,
      [config.installationId, fixture.warehouseId, fixture.variantId],
    );
    assert.equal(onHand.rows[0]?.qty, '12.000000000000');
    const later = await createOrder(baseUrl, config, fixture, 1);
    const laterConfirm = await confirmOrder(baseUrl, config, later.id);
    assert.equal(laterConfirm.response.status, 200, JSON.stringify(laterConfirm.body));
    assert.equal(laterConfirm.body.data.fulfillment.totals.reservedBaseQuantity, '0.000000000000');
  } finally {
    if (server) await closeServer(server);
    await closePool();
  }
});

test('parallel inbound allocation and Sales cancellation serialize without losing stock', async () => {
  const config = loadConfig({
    NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '3075',
    INSTALLATION_ID: `sales-concurrent-replenishment-${randomUUID()}`,
    DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://user:password@127.0.0.1:5432/npp_platform',
    DATABASE_SSL_MODE: 'disable',
    BACKEND_API_TOKEN: 'test-token-0123456789abcdef',
    CORE_BOOTSTRAP_ACTOR_ID: 'test:fulfillment-bootstrap',
    CORS_ORIGINS: 'http://127.0.0.1:3003',
  });
  const pool = getPool(config);
  let server;
  let client;
  try {
    const fixture = await createFixture(pool, config.installationId);
    server = await startServer({ config });
    const baseUrl = `http://${config.host}:${config.port}`;
    const first = await createOrder(baseUrl, config, fixture, 9);
    const confirmed = await confirmOrder(baseUrl, config, first.id);
    assert.equal(confirmed.response.status, 200, JSON.stringify(confirmed.body));
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query("SELECT set_config('lock_timeout', '3000ms', true)");
    await lockWarehouseStockScopes(client, {
      installationId: config.installationId,
      scopes: [{ warehouseId: fixture.warehouseId, baseVariantId: fixture.variantId }],
    });
    const cancellation = fetch(`${baseUrl}/api/sales-orders/${first.id}/cancel`, {
      method: 'POST',
      headers: authHeaders(config, `cancel-${randomUUID()}`),
      body: JSON.stringify({ reason: 'Kiểm thử đồng thời nhập và hủy' }),
    }).then(async (response) => ({ response, body: await response.json() }));
    await new Promise((resolve) => setTimeout(resolve, 80));
    await client.query("SELECT set_config('npp.inventory_balance_write_context', 'rebuild', true)");
    await client.query(
      `UPDATE inventory.inventory_balances
         SET on_hand_quantity = 12, updated_at = now()
       WHERE installation_id=$1 AND warehouse_id=$2 AND base_variant_id=$3`,
      [config.installationId, fixture.warehouseId, fixture.variantId],
    );
    await replenishPendingHoldScopes(client, {
      installationId: config.installationId,
      actorId: 'test:concurrent-inbound',
      scopes: [{ warehouseId: fixture.warehouseId, baseVariantId: fixture.variantId }],
    });
    await client.query('COMMIT');
    client.release();
    client = null;
    const cancelled = await cancellation;
    assert.equal(cancelled.response.status, 200, JSON.stringify(cancelled.body));
    const facts = await pool.query(
      `SELECT orders.status, demand.state,
              demand.reserved_base_quantity::text AS reserved
         FROM sales.sales_orders orders
         JOIN sales.sales_order_fulfillment_demands demand
           ON demand.installation_id=orders.installation_id
          AND demand.sales_order_id=orders.id
        WHERE orders.installation_id=$1 AND orders.id=$2`,
      [config.installationId, first.id],
    );
    assert.equal(facts.rows[0]?.status, 'cancelled');
    assert.equal(facts.rows[0]?.state, 'CANCELLED');
    const totals = await pool.query(
      `SELECT on_hand_quantity::text AS on_hand
         FROM inventory.inventory_balances
        WHERE installation_id=$1 AND warehouse_id=$2 AND base_variant_id=$3`,
      [config.installationId, fixture.warehouseId, fixture.variantId],
    );
    assert.equal(totals.rows[0]?.on_hand, '12.000000000000');
  } finally {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
    if (server) await closeServer(server);
    await closePool();
  }
});

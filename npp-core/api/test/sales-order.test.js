import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { getPool, closePool } from '../src/db/pool.js';
import { startServer } from '../src/server.js';
import { PERMISSIONS } from '../src/request-context.js';

function testEnv(overrides = {}) {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3040',
    INSTALLATION_ID: `sales-order-test-${randomUUID()}`,
    DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://user:password@127.0.0.1:5432/npp_platform',
    DATABASE_SSL_MODE: 'disable',
    BACKEND_API_TOKEN: 'test-token-0123456789abcdef',
    CORE_BOOTSTRAP_ACTOR_ID: 'test:bootstrap',
    CORS_ORIGINS: 'http://127.0.0.1:3003',
    ...overrides,
  };
}

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

async function createFixtures(pool, installationId) {
  const actor = 'test:fixture';
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const customerId = randomUUID();
  const addressId = randomUUID();
  const unitId = randomUUID();
  const productId = randomUUID();
  const variantId = randomUUID();
  const priceListId = randomUUID();
  const priceItemId = randomUUID();
  const suffix = randomUUID().slice(0, 8).toUpperCase();

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
    `INSERT INTO shared.customers
      (id, installation_id, code, name, payment_terms_days, credit_limit,
       is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,15,10000000,true,$5,$5)`,
    [customerId, installationId, `CUS-${suffix}`, `Khách hàng ${suffix}`, actor],
  );
  await pool.query(
    `INSERT INTO shared.customer_addresses
      (id, installation_id, customer_id, label, recipient_name, address_line1,
       ward, province, country_code, is_default, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,'Cửa hàng','Nhân viên nhận hàng','123 Đường thử nghiệm',
       'Phường thử nghiệm','TP HCM','VN',true,true,$4,$4)`,
    [addressId, installationId, customerId, actor],
  );
  await pool.query(
    `INSERT INTO shared.units_of_measure
      (id, installation_id, code, name, unit_kind, allows_fractional, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,'COUNT',true,true,$5,$5)`,
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
    `INSERT INTO shared.price_lists
      (id, installation_id, code, name, list_type, currency_code, priority,
       stacking_mode, stop_processing, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,'BASE','VND',100,'EXCLUSIVE',true,true,$5,$5)`,
    [priceListId, installationId, `BASE-${suffix}`, `Giá cơ sở ${suffix}`, actor],
  );
  await pool.query(
    `INSERT INTO shared.price_list_items
      (id, installation_id, price_list_id, variant_id, adjustment_type,
       amount_minor, min_quantity, source_kind, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,'FIXED_PRICE',10000,0,'ADMIN',true,$5,$5)`,
    [priceItemId, installationId, priceListId, variantId, actor],
  );

  return { warehouseId, customerId, addressId, variantId };
}

function payload(fixture, overrides = {}) {
  return {
    sourceType: 'MANUAL',
    customerId: fixture.customerId,
    customerAddressId: fixture.addressId,
    warehouseId: fixture.warehouseId,
    deliveryMode: 'DELIVERY',
    collectionPolicy: 'COLLECT_ON_DELIVERY',
    currency: 'VND',
    requestedDeliveryDate: '2026-08-02',
    note: 'Đơn bán hàng kiểm thử',
    lines: [{
      variantId: fixture.variantId,
      quantity: '2',
      discountMode: 'TOTAL_AMOUNT',
      discountValue: '500',
      taxMode: 'EXCLUSIVE',
      taxRate: '10',
    }],
    ...overrides,
  };
}

test('Sales Order API is idempotent and preserves immutable commercial versions', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  let server;
  try {
    const fixture = await createFixtures(pool, config.installationId);
    server = await startServer({ config });
    const baseUrl = `http://${config.host}:${config.port}`;
    const createKey = `so-create-${randomUUID()}`;
    const createPayload = payload(fixture);

    const create = () => fetch(`${baseUrl}/api/sales-orders`, {
      method: 'POST',
      headers: authHeaders(config, createKey),
      body: JSON.stringify(createPayload),
    });
    const firstResponse = await create();
    assert.equal(firstResponse.status, 201);
    const first = (await firstResponse.json()).data;
    assert.equal(first.status, 'draft');
    assert.equal(first.number, null);
    assert.equal(first.fulfillmentStatus, 'unallocated');
    assert.equal(first.deliveryStatus, 'pending');
    assert.equal(first.settlementStatus, 'not_due');
    assert.equal(first.versions[0].total, '21450.000000');
    assert.equal(first.versions[0].lines[0].unitPrice, '10000.000000');
    assert.equal(first.versions[0].lines[0].taxAmount, '1950.000000');

    const replayResponse = await create();
    assert.equal(replayResponse.status, 201);
    assert.equal((await replayResponse.json()).data.id, first.id);

    const mismatch = await fetch(`${baseUrl}/api/sales-orders`, {
      method: 'POST',
      headers: authHeaders(config, createKey),
      body: JSON.stringify(payload(fixture, { note: 'Payload khác' })),
    });
    assert.equal(mismatch.status, 409);

    const updatePayload = payload(fixture, {
      expectedRevision: first.versions[0].revision,
      lines: [{
        variantId: fixture.variantId,
        quantity: '3',
        discountMode: 'TOTAL_AMOUNT',
        discountValue: '500',
        taxMode: 'EXCLUSIVE',
        taxRate: '10',
      }],
    });
    const update = await fetch(`${baseUrl}/api/sales-orders/${first.id}/draft`, {
      method: 'PUT',
      headers: authHeaders(config, `so-update-${randomUUID()}`),
      body: JSON.stringify(updatePayload),
    });
    if (update.status !== 200) {
      throw new Error(`Sales Order draft update failed (${update.status}): ${await update.text()}`);
    }
    const updated = (await update.json()).data;
    assert.equal(updated.versions[0].total, '32450.000000');
    assert.equal(updated.versions[0].revision, '2');

    const confirmKey = `so-confirm-${randomUUID()}`;
    const confirm = () => fetch(`${baseUrl}/api/sales-orders/${first.id}/confirm`, {
      method: 'POST',
      headers: authHeaders(config, confirmKey),
      body: JSON.stringify({}),
    });
    const confirmResponse = await confirm();
    assert.equal(confirmResponse.status, 200);
    const confirmed = (await confirmResponse.json()).data;
    assert.equal(confirmed.status, 'confirmed');
    assert.match(confirmed.number, /^SO-\d{6}-\d{6}$/);
    assert.equal(confirmed.versions[0].status, 'confirmed');

    const confirmReplay = await confirm();
    assert.equal(confirmReplay.status, 200);
    assert.equal((await confirmReplay.json()).data.number, confirmed.number);

    await assert.rejects(
      pool.query(
        `UPDATE sales.sales_order_version_lines
         SET ordered_quantity = 9
         WHERE installation_id = $1 AND sales_order_version_id = $2`,
        [config.installationId, confirmed.versions[0].id],
      ),
      /sales_order_version_lines_locked/,
    );

    const amendmentKey = `so-amend-${randomUUID()}`;
    const amendmentResponse = await fetch(`${baseUrl}/api/sales-orders/${first.id}/amendments`, {
      method: 'POST',
      headers: authHeaders(config, amendmentKey),
      body: JSON.stringify({ reason: 'Khách tăng số lượng' }),
    });
    assert.equal(amendmentResponse.status, 201);
    const amendment = (await amendmentResponse.json()).data;
    const draftVersion = amendment.versions.find((entry) => entry.status === 'draft');
    assert.equal(draftVersion.versionNumber, '2');
    assert.equal(draftVersion.amendmentReason, 'Khách tăng số lượng');

    const amendmentUpdate = await fetch(`${baseUrl}/api/sales-orders/${first.id}/amendments/2/draft`, {
      method: 'PUT',
      headers: authHeaders(config, `so-amend-update-${randomUUID()}`),
      body: JSON.stringify(payload(fixture, {
        expectedRevision: draftVersion.revision,
        lines: [{
          variantId: fixture.variantId,
          quantity: '4',
          discountMode: 'TOTAL_AMOUNT',
          discountValue: '0',
          taxMode: 'INCLUSIVE',
          taxRate: '10',
        }],
      })),
    });
    assert.equal(amendmentUpdate.status, 200);
    const amendedDraft = (await amendmentUpdate.json()).data;
    assert.equal(amendedDraft.versions.find((entry) => entry.status === 'draft').total, '40000.000000');

    const amendmentConfirmKey = `so-amend-confirm-${randomUUID()}`;
    const amendmentConfirm = await fetch(`${baseUrl}/api/sales-orders/${first.id}/amendments/2/confirm`, {
      method: 'POST',
      headers: authHeaders(config, amendmentConfirmKey),
      body: JSON.stringify({}),
    });
    assert.equal(amendmentConfirm.status, 200);
    const amended = (await amendmentConfirm.json()).data;
    assert.equal(amended.currentVersionNumber, '2');
    assert.equal(amended.number, confirmed.number);
    assert.equal(amended.versions.find((entry) => entry.versionNumber === '1').status, 'superseded');
    assert.equal(amended.versions.find((entry) => entry.versionNumber === '2').status, 'confirmed');

    const cancelKey = `so-cancel-${randomUUID()}`;
    const cancel = () => fetch(`${baseUrl}/api/sales-orders/${first.id}/cancel`, {
      method: 'POST',
      headers: authHeaders(config, cancelKey),
      body: JSON.stringify({ reason: 'Hủy để kiểm thử' }),
    });
    const cancelResponse = await cancel();
    assert.equal(cancelResponse.status, 200);
    const cancelled = (await cancelResponse.json()).data;
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.deliveryStatus, 'cancelled');
    assert.equal(cancelled.cancellationReason, 'Hủy để kiểm thử');
    const cancelReplay = await cancel();
    assert.equal(cancelReplay.status, 200);

    const counts = await pool.query(
      `SELECT
        (SELECT count(*)::int FROM sales.sales_orders WHERE installation_id=$1 AND id=$2) AS orders,
        (SELECT count(*)::int FROM sales.sales_order_versions WHERE installation_id=$1 AND sales_order_id=$2) AS versions,
        (SELECT count(*)::int FROM shared.core_audit_records WHERE installation_id=$1 AND resource_type='sales_order' AND resource_id=$2::text) AS audits,
        (SELECT count(*)::int FROM shared.core_outbox_events WHERE installation_id=$1 AND aggregate_type='sales.sales_order' AND aggregate_id=$2::text) AS events`,
      [config.installationId, first.id],
    );
    assert.deepEqual(counts.rows[0], { orders: 1, versions: 2, audits: 7, events: 7 });
  } finally {
    if (server) await closeServer(server);
    await closePool();
  }
});

test('Sales Order source references cannot create duplicate official orders', async () => {
  const config = loadConfig(testEnv({ PORT: '3041' }));
  const pool = getPool(config);
  let server;
  try {
    const fixture = await createFixtures(pool, config.installationId);
    server = await startServer({ config });
    const baseUrl = `http://${config.host}:${config.port}`;
    const sourcePayload = payload(fixture, { sourceType: 'API', sourceId: `external-${randomUUID()}` });
    const first = await fetch(`${baseUrl}/api/sales-orders`, {
      method: 'POST', headers: authHeaders(config, `source-a-${randomUUID()}`), body: JSON.stringify(sourcePayload),
    });
    assert.equal(first.status, 201);
    const duplicate = await fetch(`${baseUrl}/api/sales-orders`, {
      method: 'POST', headers: authHeaders(config, `source-b-${randomUUID()}`), body: JSON.stringify(sourcePayload),
    });
    assert.equal(duplicate.status, 409);
  } finally {
    if (server) await closeServer(server);
    await closePool();
  }
});

test('Sales Order mutation is denied without write permission', async () => {
  const config = loadConfig(testEnv({ PORT: '3042' }));
  const pool = getPool(config);
  let server;
  try {
    const fixture = await createFixtures(pool, config.installationId);
    server = await startServer({
      config,
      authenticateRequest: () => ({
        ok: true,
        principal: {
          actorId: 'test:reader',
          permissions: [PERMISSIONS.coreSalesOrderRead],
          scopes: { warehouseIds: [fixture.warehouseId] },
          sourceApp: 'test',
        },
      }),
    });
    const response = await fetch(`http://${config.host}:${config.port}/api/sales-orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `denied-${randomUUID()}` },
      body: JSON.stringify(payload(fixture)),
    });
    assert.equal(response.status, 403);
  } finally {
    if (server) await closeServer(server);
    await closePool();
  }
});
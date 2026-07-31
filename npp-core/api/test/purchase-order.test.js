import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { getPool, closePool } from '../src/db/pool.js';
import { startServer } from '../src/server.js';
import { PERMISSIONS } from '../src/request-context.js';
import { purchaseOrderInternals } from '../src/services/purchase-order.js';

function testEnv(overrides = {}) {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3032',
    INSTALLATION_ID: `purchase-order-test-${randomUUID()}`,
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

async function createFixtures(pool, installationId) {
  const actor = 'test:fixture';
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const supplierId = randomUUID();
  const unitId = randomUUID();
  const productId = randomUUID();
  const variantId = randomUUID();
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
    `INSERT INTO shared.suppliers
      (id, installation_id, code, name, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,true,$5,$5)`,
    [supplierId, installationId, `SUP-${suffix}`, `Nhà cung cấp ${suffix}`, actor],
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
  return { branchId, warehouseId, supplierId, unitId, productId, variantId, suffix };
}

function authHeaders(config, key) {
  return {
    Authorization: `Bearer ${config.backendApiToken}`,
    'Content-Type': 'application/json',
    'Idempotency-Key': key,
  };
}

test('Purchase order decimal helpers retain exact six-place arithmetic', () => {
  const { decimalToScaled, scaledToDecimal, multiplyScaled, dateOnly } = purchaseOrderInternals;
  assert.equal(scaledToDecimal(decimalToScaled('12.345678', { allowZero: false })), '12.345678');
  assert.equal(scaledToDecimal(multiplyScaled(
    decimalToScaled('2.5', { allowZero: false }),
    decimalToScaled('10000.25', { allowZero: true }),
  )), '25000.625');
  assert.equal(decimalToScaled('1.0000001', { allowZero: false }), null);
  assert.equal(dateOnly(new Date('2026-07-29T00:00:00.000Z')), '2026-07-29');
});

test('Purchase order API is idempotent, concurrency-safe and completes its lifecycle', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  let server;
  try {
    const fixture = await createFixtures(pool, config.installationId);
    server = await startServer({ config });
    const baseUrl = `http://${config.host}:${config.port}`;
    const createKey = `po-create-${randomUUID()}`;
    const createPayload = {
      supplierId: fixture.supplierId,
      warehouseId: fixture.warehouseId,
      orderDate: '2026-07-29',
      expectedDate: '2026-08-05',
      supplierReference: 'REF-PO-01',
      currencyCode: 'VND',
      note: 'Đơn thử nghiệm',
      lines: [{
        variantId: fixture.variantId,
        quantity: '2.5',
        unitPrice: '10000.25',
        discountAmount: '500',
        taxAmount: '250',
        priceOverrideReason: 'Giá nhập tay cho fixture vòng đời PO',
      }],
    };

    const create = () => fetch(`${baseUrl}/api/purchase-orders`, {
      method: 'POST',
      headers: authHeaders(config, createKey),
      body: JSON.stringify(createPayload),
    });
    const firstResponse = await create();
    assert.equal(firstResponse.status, 201);
    const first = (await firstResponse.json()).data;
    const expectedPlacedAt = createPayload.orderDate;
    assert.equal(first.status, 'draft');
    assert.equal(first.number, null);
    assert.equal(first.placedAt, expectedPlacedAt);
    assert.equal(first.total, '24750.625000');
    assert.equal(first.lines[0].baseQuantity, '2.500000');

    const replayResponse = await create();
    assert.equal(replayResponse.status, 201);
    const replay = (await replayResponse.json()).data;
    assert.equal(replay.id, first.id);

    const mismatchResponse = await fetch(`${baseUrl}/api/purchase-orders`, {
      method: 'POST',
      headers: authHeaders(config, createKey),
      body: JSON.stringify({ ...createPayload, note: 'Payload khác' }),
    });
    assert.equal(mismatchResponse.status, 409);

    const updatePayload = JSON.stringify({
      ...createPayload,
      expectedRevision: first.revision,
      lines: [{
        variantId: fixture.variantId,
        quantity: '3',
        unitPrice: '10000.25',
        discountAmount: '0',
        taxAmount: '0',
        priceOverrideReason: 'Giá nhập tay cho fixture cập nhật PO',
      }],
    });
    const concurrentUpdates = await Promise.all([
      fetch(`${baseUrl}/api/purchase-orders/${first.id}`, {
        method: 'PATCH',
        headers: authHeaders(config, `po-update-a-${randomUUID()}`),
        body: updatePayload,
      }),
      fetch(`${baseUrl}/api/purchase-orders/${first.id}`, {
        method: 'PATCH',
        headers: authHeaders(config, `po-update-b-${randomUUID()}`),
        body: updatePayload,
      }),
    ]);
    assert.deepEqual(concurrentUpdates.map((response) => response.status).sort(), [200, 409]);
    const successfulUpdate = concurrentUpdates.find((response) => response.status === 200);
    const updated = (await successfulUpdate.json()).data;
    assert.equal(updated.total, '30000.750000');
    assert.equal(updated.revision, '2');

    const staleUpdate = await fetch(`${baseUrl}/api/purchase-orders/${first.id}`, {
      method: 'PATCH',
      headers: authHeaders(config, `po-stale-${randomUUID()}`),
      body: JSON.stringify({ ...createPayload, expectedRevision: first.revision }),
    });
    assert.equal(staleUpdate.status, 409);

    const submitResponse = await fetch(`${baseUrl}/api/purchase-orders/${first.id}/submit`, {
      method: 'POST',
      headers: authHeaders(config, `po-submit-${randomUUID()}`),
      body: JSON.stringify({ expectedRevision: updated.revision }),
    });
    assert.equal(submitResponse.status, 200);
    const submitted = (await submitResponse.json()).data;
    assert.equal(submitted.status, 'pending_approval');
    assert.equal(submitted.revision, '3');

    const approveKey = `po-approve-${randomUUID()}`;
    const approve = () => fetch(`${baseUrl}/api/purchase-orders/${first.id}/approve`, {
      method: 'POST',
      headers: authHeaders(config, approveKey),
      body: JSON.stringify({ expectedRevision: submitted.revision }),
    });
    const approveResponse = await approve();
    assert.equal(approveResponse.status, 200);
    const approved = (await approveResponse.json()).data;
    assert.equal(approved.status, 'approved');
    assert.match(approved.number, /^PO-202607-\d{6}$/);
    assert.equal(approved.revision, '4');

    const approveReplay = await approve();
    assert.equal(approveReplay.status, 200);
    assert.equal((await approveReplay.json()).data.number, approved.number);

    const lockedUpdate = await fetch(`${baseUrl}/api/purchase-orders/${first.id}`, {
      method: 'PATCH',
      headers: authHeaders(config, `po-locked-${randomUUID()}`),
      body: JSON.stringify({ ...createPayload, expectedRevision: approved.revision }),
    });
    assert.equal(lockedUpdate.status, 409);

    await assert.rejects(
      pool.query(
        `UPDATE purchasing.purchase_order_lines
         SET ordered_quantity = 4
         WHERE installation_id = $1 AND purchase_order_id = $2`,
        [config.installationId, first.id],
      ),
      /purchase_order_lines_locked/,
    );

    const cancelKey = `po-cancel-${randomUUID()}`;
    const cancel = () => fetch(`${baseUrl}/api/purchase-orders/${first.id}/cancel`, {
      method: 'POST',
      headers: authHeaders(config, cancelKey),
      body: JSON.stringify({
        expectedRevision: approved.revision,
        reason: 'Hủy để kiểm thử lifecycle',
      }),
    });
    const cancelResponse = await cancel();
    assert.equal(cancelResponse.status, 200);
    const cancelled = (await cancelResponse.json()).data;
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.cancellationReason, 'Hủy để kiểm thử lifecycle');
    assert.equal(cancelled.revision, '5');
    const cancelReplay = await cancel();
    assert.equal(cancelReplay.status, 200);
    assert.equal((await cancelReplay.json()).data.revision, '5');

    const counts = await pool.query(
      `SELECT
        (SELECT count(*)::int FROM purchasing.purchase_orders WHERE installation_id = $1 AND id = $2::uuid) AS orders,
        (SELECT count(*)::int FROM purchasing.purchase_order_lines WHERE installation_id = $1 AND purchase_order_id = $2::uuid) AS lines,
        (SELECT count(*)::int FROM shared.core_audit_records WHERE installation_id = $1 AND resource_type = 'purchase_order' AND resource_id = $2::text) AS audits,
        (SELECT count(*)::int FROM shared.core_outbox_events WHERE installation_id = $1 AND aggregate_type = 'purchasing.purchase_order' AND aggregate_id = $2::text) AS events`,
      [config.installationId, first.id],
    );
    assert.deepEqual(counts.rows[0], { orders: 1, lines: 1, audits: 5, events: 5 });
  } finally {
    if (server) await closeServer(server);
    await closePool();
  }
});

test('Purchase order routes deny mutation without the required permission', async () => {
  const config = loadConfig(testEnv({ PORT: '3033' }));
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
          permissions: [PERMISSIONS.corePurchaseOrderRead],
          scopes: { warehouseIds: [fixture.warehouseId] },
          sourceApp: 'test',
        },
      }),
    });
    const response = await fetch(`http://${config.host}:${config.port}/api/purchase-orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': `denied-${randomUUID()}`,
      },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 403);
  } finally {
    if (server) await closeServer(server);
    await closePool();
  }
});

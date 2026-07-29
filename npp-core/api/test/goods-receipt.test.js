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
    PORT: '3071',
    INSTALLATION_ID: `goods-receipt-test-${randomUUID()}`,
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

function mutationHeaders(config, key) {
  return {
    Authorization: `Bearer ${config.backendApiToken}`,
    'Content-Type': 'application/json',
    'Idempotency-Key': key,
  };
}

async function data(response) {
  return (await response.json()).data;
}

async function seedFixture(pool, installationId) {
  const actor = 'test:fixture';
  const ids = {
    branchId: randomUUID(),
    warehouseId: randomUUID(),
    locationId: randomUUID(),
    supplierId: randomUUID(),
    unitId: randomUUID(),
    productId: randomUUID(),
    variantId: randomUUID(),
  };
  const suffix = randomUUID().slice(0, 8).toUpperCase();

  await pool.query(
    `INSERT INTO shared.branches
       (id, installation_id, code, name, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,true,$5,$5)`,
    [ids.branchId, installationId, `BR-${suffix}`, `Chi nhánh ${suffix}`, actor],
  );
  await pool.query(
    `INSERT INTO shared.warehouses
       (id, installation_id, branch_id, code, name, warehouse_type, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,'main',true,$6,$6)`,
    [ids.warehouseId, installationId, ids.branchId, `WH-${suffix}`, `Kho ${suffix}`, actor],
  );
  await pool.query(
    `INSERT INTO shared.warehouse_locations
       (id, installation_id, warehouse_id, code, name, location_type, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,'storage',true,$6,$6)`,
    [ids.locationId, installationId, ids.warehouseId, `LOC-${suffix}`, `Vị trí ${suffix}`, actor],
  );
  await pool.query(
    `INSERT INTO shared.suppliers
       (id, installation_id, code, name, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,true,$5,$5)`,
    [ids.supplierId, installationId, `SUP-${suffix}`, `Nhà cung cấp ${suffix}`, actor],
  );
  await pool.query(
    `INSERT INTO shared.units_of_measure
       (id, installation_id, code, name, unit_kind, allows_fractional, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,'COUNT',true,true,$5,$5)`,
    [ids.unitId, installationId, `EA${suffix.slice(0, 4)}`, `Đơn vị ${suffix}`, actor],
  );
  await pool.query(
    `INSERT INTO shared.products
       (id, installation_id, code, name, is_orderable, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,true,true,$5,$5)`,
    [ids.productId, installationId, `PR-${suffix}`, `Sản phẩm ${suffix}`, actor],
  );
  await pool.query(
    `INSERT INTO shared.product_variants
       (id, installation_id, product_id, sku, name, variant_kind,
        is_inventory_base, is_sellable, is_catalog_visible, is_active,
        unit_id, conversion_to_base, is_purchasable, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,'BASE',true,true,true,true,$6,1,true,$7,$7)`,
    [ids.variantId, installationId, ids.productId, `SKU-${suffix}`, `SKU ${suffix}`, ids.unitId, actor],
  );
  await pool.query(
    `INSERT INTO inventory.product_tracking_policies
       (installation_id, base_variant_id, lot_tracking_mode, expiry_tracking_mode,
        location_required, version, created_at, created_by, updated_at, updated_by)
     VALUES ($1,$2,'NONE','NONE',true,1,now(),$3,now(),$3)`,
    [installationId, ids.variantId, actor],
  );
  return ids;
}

async function createApprovedPo(baseUrl, config, fixture) {
  const createPayload = {
    supplierId: fixture.supplierId,
    warehouseId: fixture.warehouseId,
    orderDate: '2026-07-29',
    expectedDate: '2026-08-05',
    supplierReference: `REF-${randomUUID()}`,
    currencyCode: 'VND',
    note: 'PO cho kiểm thử nhận hàng',
    lines: [{
      variantId: fixture.variantId,
      quantity: '10',
      unitPrice: '10000',
      discountAmount: '0',
      taxAmount: '0',
    }],
  };
  const createResponse = await fetch(`${baseUrl}/api/purchase-orders`, {
    method: 'POST',
    headers: mutationHeaders(config, `po-create-${randomUUID()}`),
    body: JSON.stringify(createPayload),
  });
  assert.equal(createResponse.status, 201);
  const draft = await data(createResponse);

  const invalidReceipt = await fetch(`${baseUrl}/api/goods-receipts`, {
    method: 'POST',
    headers: mutationHeaders(config, `gr-invalid-status-${randomUUID()}`),
    body: JSON.stringify({
      purchaseOrderId: draft.id,
      receiptDate: '2026-07-29',
      lines: [{
        purchaseOrderLineId: draft.lines[0].id,
        receivedQuantity: '1',
        locationId: fixture.locationId,
      }],
    }),
  });
  assert.equal(invalidReceipt.status, 400);
  assert.equal((await invalidReceipt.json()).error.code, 'INVALID_PURCHASE_ORDER_STATUS');

  const submitResponse = await fetch(`${baseUrl}/api/purchase-orders/${draft.id}/submit`, {
    method: 'POST',
    headers: mutationHeaders(config, `po-submit-${randomUUID()}`),
    body: JSON.stringify({ expectedRevision: draft.revision }),
  });
  assert.equal(submitResponse.status, 200);
  const submitted = await data(submitResponse);

  const approveResponse = await fetch(`${baseUrl}/api/purchase-orders/${draft.id}/approve`, {
    method: 'POST',
    headers: mutationHeaders(config, `po-approve-${randomUUID()}`),
    body: JSON.stringify({ expectedRevision: submitted.revision }),
  });
  assert.equal(approveResponse.status, 200);
  return data(approveResponse);
}

function receiptPayload(po, fixture, quantity, reference) {
  return {
    purchaseOrderId: po.id,
    receiptDate: '2026-07-29',
    supplierDeliveryReference: reference,
    note: 'Phiếu nhận hàng tích hợp',
    lines: [{
      purchaseOrderLineId: po.lines[0].id,
      receivedQuantity: quantity,
      locationId: fixture.locationId,
      note: 'Dòng nhận hàng',
    }],
  };
}

test('Goods receipt posts partial/full inventory exactly once and reverses with reconciliation', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  let server;
  try {
    const fixture = await seedFixture(pool, config.installationId);
    server = await startServer({ config });
    const baseUrl = `http://${config.host}:${config.port}`;
    const approved = await createApprovedPo(baseUrl, config, fixture);
    assert.equal(approved.status, 'approved');
    assert.equal(approved.lines[0].remainingQuantity, '10.000000');

    const firstKey = `gr-create-1-${randomUUID()}`;
    const firstPayload = receiptPayload(approved, fixture, '4', 'DELIVERY-1');
    const createFirst = () => fetch(`${baseUrl}/api/goods-receipts`, {
      method: 'POST',
      headers: mutationHeaders(config, firstKey),
      body: JSON.stringify(firstPayload),
    });
    let response = await createFirst();
    assert.equal(response.status, 201);
    const firstDraft = await data(response);
    assert.equal(firstDraft.status, 'draft');
    assert.equal(firstDraft.lines[0].receivedQuantity, '4.000000');

    response = await createFirst();
    assert.equal(response.status, 201);
    assert.equal((await data(response)).id, firstDraft.id);
    response = await fetch(`${baseUrl}/api/goods-receipts`, {
      method: 'POST',
      headers: mutationHeaders(config, firstKey),
      body: JSON.stringify({ ...firstPayload, note: 'Payload khác' }),
    });
    assert.equal(response.status, 409);

    const firstPostKey = `gr-post-1-${randomUUID()}`;
    const postFirst = () => fetch(`${baseUrl}/api/goods-receipts/${firstDraft.id}/post`, {
      method: 'POST',
      headers: mutationHeaders(config, firstPostKey),
      body: JSON.stringify({ expectedRevision: firstDraft.revision }),
    });
    response = await postFirst();
    assert.equal(response.status, 200);
    const firstPosted = await data(response);
    assert.match(firstPosted.documentNumber, /^GR-202607-\d{6}$/);
    assert.ok(firstPosted.inventoryMovementId);
    response = await postFirst();
    assert.equal(response.status, 200);
    assert.equal((await data(response)).inventoryMovementId, firstPosted.inventoryMovementId);

    response = await fetch(`${baseUrl}/api/purchase-orders/${approved.id}`, {
      headers: { Authorization: `Bearer ${config.backendApiToken}` },
    });
    const partialPo = await data(response);
    assert.equal(partialPo.status, 'partially_received');
    assert.equal(partialPo.lines[0].receivedQuantity, '4.000000');
    assert.equal(partialPo.lines[0].remainingQuantity, '6.000000');

    response = await fetch(`${baseUrl}/api/goods-receipts`, {
      method: 'POST',
      headers: mutationHeaders(config, `gr-over-${randomUUID()}`),
      body: JSON.stringify(receiptPayload(partialPo, fixture, '7', 'DELIVERY-OVER')),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'RECEIPT_QUANTITY_EXCEEDS_REMAINING');

    response = await fetch(`${baseUrl}/api/goods-receipts`, {
      method: 'POST',
      headers: mutationHeaders(config, `gr-create-2-${randomUUID()}`),
      body: JSON.stringify(receiptPayload(partialPo, fixture, '6', 'DELIVERY-2')),
    });
    assert.equal(response.status, 201);
    const secondDraft = await data(response);

    const postBody = JSON.stringify({ expectedRevision: secondDraft.revision });
    const concurrent = await Promise.all([
      fetch(`${baseUrl}/api/goods-receipts/${secondDraft.id}/post`, {
        method: 'POST',
        headers: mutationHeaders(config, `gr-post-2a-${randomUUID()}`),
        body: postBody,
      }),
      fetch(`${baseUrl}/api/goods-receipts/${secondDraft.id}/post`, {
        method: 'POST',
        headers: mutationHeaders(config, `gr-post-2b-${randomUUID()}`),
        body: postBody,
      }),
    ]);
    assert.deepEqual(concurrent.map((item) => item.status).sort(), [200, 409]);
    const postedResponse = concurrent.find((item) => item.status === 200);
    const secondPosted = await data(postedResponse);

    response = await fetch(`${baseUrl}/api/purchase-orders/${approved.id}`, {
      headers: { Authorization: `Bearer ${config.backendApiToken}` },
    });
    const fullPo = await data(response);
    assert.equal(fullPo.status, 'fully_received');
    assert.equal(fullPo.lines[0].receivedQuantity, '10.000000');
    assert.equal(fullPo.lines[0].remainingQuantity, '0.000000');

    response = await fetch(`${baseUrl}/api/goods-receipts/${secondPosted.id}`, {
      method: 'PATCH',
      headers: mutationHeaders(config, `gr-locked-${randomUUID()}`),
      body: JSON.stringify({
        ...receiptPayload(fullPo, fixture, '1', 'LOCKED'),
        expectedRevision: secondPosted.revision,
      }),
    });
    assert.equal(response.status, 409);

    const reverseKey = `gr-reverse-${randomUUID()}`;
    const reverse = () => fetch(`${baseUrl}/api/goods-receipts/${secondPosted.id}/reverse`, {
      method: 'POST',
      headers: mutationHeaders(config, reverseKey),
      body: JSON.stringify({
        expectedRevision: secondPosted.revision,
        documentDate: '2026-07-29',
        reasonNote: 'Đảo lần nhận thứ hai để kiểm thử',
      }),
    });
    response = await reverse();
    assert.equal(response.status, 200);
    const reversed = await data(response);
    assert.equal(reversed.status, 'reversed');
    assert.ok(reversed.inventoryReversalMovementId);
    response = await reverse();
    assert.equal(response.status, 200);
    assert.equal((await data(response)).inventoryReversalMovementId, reversed.inventoryReversalMovementId);

    response = await fetch(`${baseUrl}/api/purchase-orders/${approved.id}`, {
      headers: { Authorization: `Bearer ${config.backendApiToken}` },
    });
    const restoredPo = await data(response);
    assert.equal(restoredPo.status, 'partially_received');
    assert.equal(restoredPo.lines[0].receivedQuantity, '4.000000');
    assert.equal(restoredPo.lines[0].remainingQuantity, '6.000000');

    const ledger = await pool.query(
      `WITH originals AS (
         SELECT id
         FROM inventory.inventory_movements
         WHERE installation_id = $1
           AND source_domain = 'PURCHASING'
           AND source_document_type = 'PURCHASE_RECEIPT'
       )
       SELECT
         COALESCE(sum(iml.base_quantity_delta), 0)::text AS ledger_quantity,
         count(DISTINCT im.id)::int AS movement_count,
         count(DISTINCT CASE WHEN im.reversal_of_movement_id IS NOT NULL THEN im.id END)::int AS reversal_count
       FROM inventory.inventory_movements im
       JOIN inventory.inventory_movement_lines iml
         ON iml.installation_id = im.installation_id AND iml.movement_id = im.id
       WHERE im.installation_id = $1
         AND (im.id IN (SELECT id FROM originals) OR im.reversal_of_movement_id IN (SELECT id FROM originals))
         AND iml.warehouse_id = $2
         AND iml.base_variant_id = $3`,
      [config.installationId, fixture.warehouseId, fixture.variantId],
    );
    assert.deepEqual(ledger.rows[0], {
      ledger_quantity: '4.000000000000',
      movement_count: 3,
      reversal_count: 1,
    });

    const evidence = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM purchasing.goods_receipts WHERE installation_id = $1) AS receipts,
         (SELECT count(*)::int FROM shared.core_audit_records WHERE installation_id = $1 AND resource_type = 'goods_receipt') AS audits,
         (SELECT count(*)::int FROM shared.core_outbox_events WHERE installation_id = $1 AND aggregate_type = 'purchasing.goods_receipt') AS events`,
      [config.installationId],
    );
    assert.deepEqual(evidence.rows[0], { receipts: 2, audits: 5, events: 5 });
  } finally {
    if (server) await closeServer(server);
    await closePool();
  }
});

test('Goods receipt routes fail closed for missing permission and empty warehouse scope', async () => {
  const config = loadConfig(testEnv({ PORT: '3072' }));
  const pool = getPool(config);
  let server;
  try {
    const fixture = await seedFixture(pool, config.installationId);
    server = await startServer({
      config,
      authenticateRequest: () => ({
        ok: true,
        principal: {
          actorId: 'test:restricted-receiver',
          permissions: [PERMISSIONS.coreGoodsReceiptRead],
          scopes: { warehouseIds: [fixture.warehouseId] },
          sourceApp: 'test',
        },
      }),
    });
    const denied = await fetch(`http://${config.host}:${config.port}/api/goods-receipts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `gr-denied-${randomUUID()}` },
      body: JSON.stringify({}),
    });
    assert.equal(denied.status, 403);
  } finally {
    if (server) await closeServer(server);
    await closePool();
  }

  const emptyConfig = loadConfig(testEnv({ PORT: '3073' }));
  getPool(emptyConfig);
  let emptyServer;
  try {
    emptyServer = await startServer({
      config: emptyConfig,
      authenticateRequest: () => ({
        ok: true,
        principal: {
          actorId: 'test:empty-scope-receiver',
          permissions: [PERMISSIONS.coreGoodsReceiptRead],
          scopes: { warehouseIds: [] },
          sourceApp: 'test',
        },
      }),
    });
    const response = await fetch(`http://${emptyConfig.host}:${emptyConfig.port}/api/goods-receipts`);
    assert.equal(response.status, 200);
    assert.deepEqual(await data(response), []);
  } finally {
    if (emptyServer) await closeServer(emptyServer);
    await closePool();
  }
});

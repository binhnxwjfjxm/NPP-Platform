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

function readHeaders(config) {
  return { Authorization: `Bearer ${config.backendApiToken}` };
}

async function data(response) {
  return (await response.json()).data;
}

async function errorCode(response) {
  return (await response.json()).error.code;
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
  assert.equal(await errorCode(invalidReceipt), 'INVALID_PURCHASE_ORDER_STATUS');

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

function receiptPayload(po, fixture, quantity, reference, options = {}) {
  return {
    purchaseOrderId: po.id,
    receiptDate: '2026-07-29',
    supplierDeliveryReference: reference,
    note: options.note ?? 'Phiếu nhận hàng tích hợp',
    lines: [{
      purchaseOrderLineId: options.purchaseOrderLineId ?? po.lines[0].id,
      receivedQuantity: quantity,
      ...(options.acceptedQuantity !== undefined ? { acceptedQuantity: options.acceptedQuantity } : {}),
      ...(options.rejectedQuantity !== undefined ? { rejectedQuantity: options.rejectedQuantity } : {}),
      ...(options.finalizeLine !== undefined ? { finalizeLine: options.finalizeLine } : {}),
      ...(options.qualityReasonCode ? { qualityReasonCode: options.qualityReasonCode } : {}),
      ...(options.qualityNote ? { qualityNote: options.qualityNote } : {}),
      ...(options.includeLocation === false ? {} : { locationId: fixture.locationId }),
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

    let response = await fetch(`${baseUrl}/api/goods-receipts`, {
      method: 'POST',
      headers: mutationHeaders(config, `gr-zero-${randomUUID()}`),
      body: JSON.stringify(receiptPayload(approved, fixture, '0', 'DELIVERY-ZERO')),
    });
    assert.equal(response.status, 400);
    assert.equal(await errorCode(response), 'INVALID_RECEIVED_QUANTITY');

    response = await fetch(`${baseUrl}/api/goods-receipts`, {
      method: 'POST',
      headers: mutationHeaders(config, `gr-wrong-line-${randomUUID()}`),
      body: JSON.stringify(receiptPayload(approved, fixture, '1', 'DELIVERY-WRONG-LINE', {
        purchaseOrderLineId: randomUUID(),
      })),
    });
    assert.equal(response.status, 404);
    assert.equal(await errorCode(response), 'PURCHASE_ORDER_LINE_NOT_FOUND');

    response = await fetch(`${baseUrl}/api/goods-receipts`, {
      method: 'POST',
      headers: mutationHeaders(config, `gr-missing-quality-${randomUUID()}`),
      body: JSON.stringify(receiptPayload(approved, fixture, '4', 'DELIVERY-MISSING-QUALITY', {
        acceptedQuantity: '3',
        rejectedQuantity: '1',
      })),
    });
    assert.equal(response.status, 400);
    assert.equal(await errorCode(response), 'INVALID_VARIANCE_REASON_CODE');



    response = await fetch(`${baseUrl}/api/goods-receipts`, {
      method: 'POST',
      headers: mutationHeaders(config, `gr-missing-shortage-reason-${randomUUID()}`),
      body: JSON.stringify(receiptPayload(approved, fixture, '2', 'DELIVERY-MISSING-SHORTAGE-REASON', {
        finalizeLine: true,
      })),
    });
    assert.equal(response.status, 400);
    assert.equal(await errorCode(response), 'INVALID_VARIANCE_REASON_CODE');

    const firstKey = `gr-create-1-${randomUUID()}`;
    const firstPayload = receiptPayload(approved, fixture, '4', 'DELIVERY-1', {
      acceptedQuantity: '3',
      rejectedQuantity: '1',
      qualityReasonCode: 'DAMAGED',
      qualityNote: 'Thùng bị móp',
    });
    const createFirst = () => fetch(`${baseUrl}/api/goods-receipts`, {
      method: 'POST',
      headers: mutationHeaders(config, firstKey),
      body: JSON.stringify(firstPayload),
    });
    response = await createFirst();
    assert.equal(response.status, 201);
    const firstDraft = await data(response);
    assert.equal(firstDraft.status, 'draft');
    assert.equal(firstDraft.lines[0].receivedQuantity, '4.000000');
    assert.equal(firstDraft.lines[0].acceptedQuantity, '3.000000');
    assert.equal(firstDraft.lines[0].rejectedQuantity, '1.000000');
    assert.equal(firstDraft.lines[0].shortageClosedQuantity, '0.000000');
    assert.equal(firstDraft.lines[0].qualityReasonCode, 'DAMAGED');
    assert.equal(firstDraft.lines[0].qualityNote, 'Thùng bị móp');

    response = await createFirst();
    assert.equal(response.status, 201);
    assert.equal((await data(response)).id, firstDraft.id);
    response = await fetch(`${baseUrl}/api/goods-receipts`, {
      method: 'POST',
      headers: mutationHeaders(config, firstKey),
      body: JSON.stringify({ ...firstPayload, note: 'Payload khác' }),
    });
    assert.equal(response.status, 409);

    const updatePayload = {
      ...firstPayload,
      note: 'Phiếu nhận hàng đã cập nhật',
      expectedRevision: firstDraft.revision,
    };
    response = await fetch(`${baseUrl}/api/goods-receipts/${firstDraft.id}`, {
      method: 'PATCH',
      headers: mutationHeaders(config, `gr-update-${randomUUID()}`),
      body: JSON.stringify(updatePayload),
    });
    assert.equal(response.status, 200);
    const updatedFirstDraft = await data(response);
    assert.equal(updatedFirstDraft.note, 'Phiếu nhận hàng đã cập nhật');
    assert.notEqual(updatedFirstDraft.revision, firstDraft.revision);

    response = await fetch(`${baseUrl}/api/goods-receipts/${firstDraft.id}`, {
      method: 'PATCH',
      headers: mutationHeaders(config, `gr-stale-${randomUUID()}`),
      body: JSON.stringify(updatePayload),
    });
    assert.equal(response.status, 409);
    assert.equal(await errorCode(response), 'CONFLICT');

    const firstPostKey = `gr-post-1-${randomUUID()}`;
    const postFirst = () => fetch(`${baseUrl}/api/goods-receipts/${updatedFirstDraft.id}/post`, {
      method: 'POST',
      headers: mutationHeaders(config, firstPostKey),
      body: JSON.stringify({ expectedRevision: updatedFirstDraft.revision }),
    });
    response = await postFirst();
    const firstPostPayload = await response.json();
    assert.equal(response.status, 200, JSON.stringify(firstPostPayload));
    const firstPosted = firstPostPayload.data;
    assert.match(firstPosted.documentNumber, /^GR-202607-\d{6}$/);
    assert.ok(firstPosted.inventoryMovementId);
    assert.equal(firstPosted.lines[0].acceptedQuantity, '3.000000');
    assert.equal(firstPosted.lines[0].rejectedQuantity, '1.000000');
    assert.equal(firstPosted.lines[0].shortageClosedQuantity, '0.000000');
    response = await postFirst();
    assert.equal(response.status, 200);
    assert.equal((await data(response)).inventoryMovementId, firstPosted.inventoryMovementId);

    response = await fetch(`${baseUrl}/api/purchase-orders/${approved.id}`, { headers: readHeaders(config) });
    const partialPo = await data(response);
    assert.equal(partialPo.status, 'partially_received');
    assert.equal(partialPo.receivedQuantityTotal, '4.000000');
    assert.equal(partialPo.acceptedQuantityTotal, '3.000000');
    assert.equal(partialPo.rejectedQuantityTotal, '1.000000');
    assert.equal(partialPo.shortageClosedQuantityTotal, '0.000000');
    assert.equal(partialPo.remainingQuantityTotal, '7.000000');
    assert.equal(partialPo.lines[0].receivedQuantity, '4.000000');
    assert.equal(partialPo.lines[0].acceptedQuantity, '3.000000');
    assert.equal(partialPo.lines[0].rejectedQuantity, '1.000000');
    assert.equal(partialPo.lines[0].shortageClosedQuantity, '0.000000');
    assert.equal(partialPo.lines[0].remainingQuantity, '7.000000');

    response = await fetch(`${baseUrl}/api/goods-receipts`, {
      method: 'POST',
      headers: mutationHeaders(config, `gr-over-${randomUUID()}`),
      body: JSON.stringify(receiptPayload(partialPo, fixture, '8', 'DELIVERY-OVER')),
    });
    assert.equal(response.status, 400);
    assert.equal(await errorCode(response), 'RECEIPT_QUANTITY_EXCEEDS_REMAINING');

    response = await fetch(`${baseUrl}/api/goods-receipts`, {
      method: 'POST',
      headers: mutationHeaders(config, `gr-tracking-${randomUUID()}`),
      body: JSON.stringify(receiptPayload(partialPo, fixture, '1', 'DELIVERY-NO-LOCATION', {
        includeLocation: false,
      })),
    });
    assert.equal(response.status, 201);
    const missingLocationDraft = await data(response);
    response = await fetch(`${baseUrl}/api/goods-receipts/${missingLocationDraft.id}/post`, {
      method: 'POST',
      headers: mutationHeaders(config, `gr-tracking-post-${randomUUID()}`),
      body: JSON.stringify({ expectedRevision: missingLocationDraft.revision }),
    });
    assert.equal(response.status, 400);
    assert.equal(await errorCode(response), 'LOCATION_REQUIRED');

    response = await fetch(`${baseUrl}/api/goods-receipts`, {
      method: 'POST',
      headers: mutationHeaders(config, `gr-create-2-${randomUUID()}`),
      body: JSON.stringify(receiptPayload(partialPo, fixture, '7', 'DELIVERY-2')),
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
    assert.match(secondPosted.documentNumber, /^GR-202607-\d{6}$/);
    assert.notEqual(secondPosted.documentNumber, firstPosted.documentNumber);

    response = await fetch(`${baseUrl}/api/purchase-orders/${approved.id}`, { headers: readHeaders(config) });
    const fullPo = await data(response);
    assert.equal(fullPo.status, 'fully_received');
    assert.equal(fullPo.receivedQuantityTotal, '11.000000');
    assert.equal(fullPo.acceptedQuantityTotal, '10.000000');
    assert.equal(fullPo.rejectedQuantityTotal, '1.000000');
    assert.equal(fullPo.shortageClosedQuantityTotal, '0.000000');
    assert.equal(fullPo.remainingQuantityTotal, '0.000000');
    assert.equal(fullPo.lines[0].receivedQuantity, '11.000000');
    assert.equal(fullPo.lines[0].acceptedQuantity, '10.000000');
    assert.equal(fullPo.lines[0].rejectedQuantity, '1.000000');
    assert.equal(fullPo.lines[0].shortageClosedQuantity, '0.000000');
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
    assert.equal(await errorCode(response), 'GOODS_RECEIPT_LOCKED');

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

    response = await fetch(`${baseUrl}/api/purchase-orders/${approved.id}`, { headers: readHeaders(config) });
    const restoredPo = await data(response);
    assert.equal(restoredPo.status, 'partially_received');
    assert.equal(restoredPo.receivedQuantityTotal, '4.000000');
    assert.equal(restoredPo.acceptedQuantityTotal, '3.000000');
    assert.equal(restoredPo.rejectedQuantityTotal, '1.000000');
    assert.equal(restoredPo.shortageClosedQuantityTotal, '0.000000');
    assert.equal(restoredPo.remainingQuantityTotal, '7.000000');
    assert.equal(restoredPo.lines[0].receivedQuantity, '4.000000');
    assert.equal(restoredPo.lines[0].acceptedQuantity, '3.000000');
    assert.equal(restoredPo.lines[0].rejectedQuantity, '1.000000');
    assert.equal(restoredPo.lines[0].shortageClosedQuantity, '0.000000');
    assert.equal(restoredPo.lines[0].remainingQuantity, '7.000000');

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
      ledger_quantity: '3.000000000000',
      movement_count: 3,
      reversal_count: 1,
    });

    const balance = await pool.query(
      `SELECT on_hand_quantity::text AS on_hand_quantity
       FROM inventory.inventory_balances
       WHERE installation_id = $1
         AND warehouse_id = $2
         AND location_id = $3
         AND base_variant_id = $4
         AND lot_id IS NULL`,
      [config.installationId, fixture.warehouseId, fixture.locationId, fixture.variantId],
    );
    assert.equal(balance.rows.length, 1);
    assert.equal(balance.rows[0].on_hand_quantity, '3.000000000000');

    const evidence = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM purchasing.goods_receipts WHERE installation_id = $1) AS receipts,
         (SELECT count(*)::int FROM shared.core_audit_records WHERE installation_id = $1 AND resource_type = 'goods_receipt') AS audits,
         (SELECT count(*)::int FROM shared.core_outbox_events WHERE installation_id = $1 AND aggregate_type = 'purchasing.goods_receipt') AS events`,
      [config.installationId],
    );
    assert.deepEqual(evidence.rows[0], { receipts: 3, audits: 7, events: 7 });
  } finally {
    if (server) await closeServer(server);
    await closePool();
  }
});



test('Goods receipt can post and reverse a fully rejected delivery without inventory movement', async () => {
  const config = loadConfig(testEnv({ PORT: '3078', INSTALLATION_ID: `goods-receipt-rejected-${randomUUID()}` }));
  const pool = getPool(config);
  let server;
  try {
    const fixture = await seedFixture(pool, config.installationId);
    server = await startServer({ config });
    const baseUrl = `http://${config.host}:${config.port}`;
    const approved = await createApprovedPo(baseUrl, config, fixture);

    let response = await fetch(`${baseUrl}/api/goods-receipts`, {
      method: 'POST',
      headers: mutationHeaders(config, `gr-rejected-${randomUUID()}`),
      body: JSON.stringify(receiptPayload(approved, fixture, '2', 'DELIVERY-REJECTED', {
        acceptedQuantity: '0',
        rejectedQuantity: '2',
        qualityReasonCode: 'DAMAGED',
        qualityNote: 'Toàn bộ hàng giao bị loại tại cửa nhận',
      })),
    });
    assert.equal(response.status, 201);
    const draft = await data(response);
    assert.equal(draft.lines[0].baseQuantity, '0.000000');

    response = await fetch(`${baseUrl}/api/goods-receipts/${draft.id}/post`, {
      method: 'POST',
      headers: mutationHeaders(config, `gr-rejected-post-${randomUUID()}`),
      body: JSON.stringify({ expectedRevision: draft.revision }),
    });
    assert.equal(response.status, 200);
    const posted = await data(response);
    assert.equal(posted.inventoryMovementId, null);

    response = await fetch(`${baseUrl}/api/purchase-orders/${approved.id}`, { headers: readHeaders(config) });
    const unchangedPo = await data(response);
    assert.equal(unchangedPo.status, 'approved');
    assert.equal(unchangedPo.acceptedQuantityTotal, '0.000000');
    assert.equal(unchangedPo.rejectedQuantityTotal, '2.000000');
    assert.equal(unchangedPo.remainingQuantityTotal, '10.000000');

    const movementCount = await pool.query(
      `SELECT count(*)::int AS count FROM inventory.inventory_movements
       WHERE installation_id = $1 AND source_document_id = $2`,
      [config.installationId, posted.id],
    );
    assert.equal(movementCount.rows[0].count, 0);

    response = await fetch(`${baseUrl}/api/goods-receipts/${posted.id}/reverse`, {
      method: 'POST',
      headers: mutationHeaders(config, `gr-rejected-reverse-${randomUUID()}`),
      body: JSON.stringify({
        expectedRevision: posted.revision,
        documentDate: '2026-07-29',
        reasonNote: 'Đảo phiếu toàn bộ bị loại',
      }),
    });
    assert.equal(response.status, 200);
    const reversed = await data(response);
    assert.equal(reversed.inventoryReversalMovementId, null);

    response = await fetch(`${baseUrl}/api/purchase-orders/${approved.id}`, { headers: readHeaders(config) });
    const restoredPo = await data(response);
    assert.equal(restoredPo.status, 'approved');
    assert.equal(restoredPo.rejectedQuantityTotal, '0.000000');
    assert.equal(restoredPo.remainingQuantityTotal, '10.000000');
  } finally {
    if (server) await closeServer(server);
    await closePool();
  }
});

test('Goods receipt variance requires explicit permission even when create is allowed', async () => {
  const config = loadConfig(testEnv({ PORT: '3076' }));
  const pool = getPool(config);
  let server;
  try {
    const fixture = await seedFixture(pool, config.installationId);
    server = await startServer({
      config,
      authenticateRequest: () => ({
        ok: true,
        principal: {
          actorId: 'test:variance-receiver',
          permissions: [
            PERMISSIONS.corePurchaseOrderRead,
            PERMISSIONS.corePurchaseOrderCreate,
            PERMISSIONS.corePurchaseOrderSubmit,
            PERMISSIONS.corePurchaseOrderApprove,
            PERMISSIONS.coreGoodsReceiptRead,
            PERMISSIONS.coreGoodsReceiptCreate,
          ],
          scopes: { warehouseIds: [fixture.warehouseId] },
          sourceApp: 'test',
        },
      }),
    });
    const baseUrl = `http://${config.host}:${config.port}`;
    const approved = await createApprovedPo(baseUrl, config, fixture);

    const denied = await fetch(`${baseUrl}/api/goods-receipts`, {
      method: 'POST',
      headers: mutationHeaders(config, `gr-variance-denied-${randomUUID()}`),
      body: JSON.stringify(receiptPayload(approved, fixture, '4', 'DELIVERY-VARIANCE', {
        acceptedQuantity: '3',
        rejectedQuantity: '1',
        qualityReasonCode: 'DAMAGED',
        qualityNote: 'Thùng bị móp',
      })),
    });
    assert.equal(denied.status, 403);
    assert.equal(await errorCode(denied), 'GOODS_RECEIPT_VARIANCE_PERMISSION_REQUIRED');
  } finally {
    if (server) await closeServer(server);
    await closePool();
  }
});

test('Goods receipt shortage closure marks the purchase order closed', async () => {
  const config = loadConfig(testEnv({ PORT: '3077', INSTALLATION_ID: `goods-receipt-closed-${randomUUID()}` }));
  const pool = getPool(config);
  let server;
  try {
    const fixture = await seedFixture(pool, config.installationId);
    server = await startServer({ config });
    const baseUrl = `http://${config.host}:${config.port}`;
    const approved = await createApprovedPo(baseUrl, config, fixture);

    const response = await fetch(`${baseUrl}/api/goods-receipts`, {
      method: 'POST',
      headers: mutationHeaders(config, `gr-close-${randomUUID()}`),
      body: JSON.stringify(receiptPayload(approved, fixture, '2', 'DELIVERY-CLOSE', {
        finalizeLine: true,
        qualityReasonCode: 'SHORTAGE',
        qualityNote: 'Nhà cung cấp xác nhận giao thiếu phần còn lại',
      })),
    });
    assert.equal(response.status, 201);
    const draft = await data(response);
    assert.equal(draft.lines[0].receivedQuantity, '2.000000');
    assert.equal(draft.lines[0].acceptedQuantity, '2.000000');
    assert.equal(draft.lines[0].shortageClosedQuantity, '8.000000');

    const postResponse = await fetch(`${baseUrl}/api/goods-receipts/${draft.id}/post`, {
      method: 'POST',
      headers: mutationHeaders(config, `gr-close-post-${randomUUID()}`),
      body: JSON.stringify({ expectedRevision: draft.revision }),
    });
    assert.equal(postResponse.status, 200);
    const posted = await data(postResponse);
    assert.equal(posted.lines[0].shortageClosedQuantity, '8.000000');

    const closed = await fetch(`${baseUrl}/api/purchase-orders/${approved.id}`, { headers: readHeaders(config) });
    const closedPo = await data(closed);
    assert.equal(closedPo.status, 'closed');
    assert.equal(closedPo.receivedQuantityTotal, '2.000000');
    assert.equal(closedPo.acceptedQuantityTotal, '2.000000');
    assert.equal(closedPo.rejectedQuantityTotal, '0.000000');
    assert.equal(closedPo.shortageClosedQuantityTotal, '8.000000');
    assert.equal(closedPo.remainingQuantityTotal, '0.000000');

    const reverseResponse = await fetch(`${baseUrl}/api/goods-receipts/${posted.id}/reverse`, {
      method: 'POST',
      headers: mutationHeaders(config, `gr-close-reverse-${randomUUID()}`),
      body: JSON.stringify({
        expectedRevision: posted.revision,
        documentDate: '2026-07-29',
        reasonNote: 'Đảo phiếu chốt thiếu để kiểm tra phục hồi projection',
      }),
    });
    assert.equal(reverseResponse.status, 200);
    const reversed = await data(reverseResponse);
    assert.equal(reversed.status, 'reversed');

    const restoredResponse = await fetch(`${baseUrl}/api/purchase-orders/${approved.id}`, { headers: readHeaders(config) });
    const restoredPo = await data(restoredResponse);
    assert.equal(restoredPo.status, 'approved');
    assert.equal(restoredPo.acceptedQuantityTotal, '0.000000');
    assert.equal(restoredPo.rejectedQuantityTotal, '0.000000');
    assert.equal(restoredPo.shortageClosedQuantityTotal, '0.000000');
    assert.equal(restoredPo.remainingQuantityTotal, '10.000000');

    const reverseResponse = await fetch(`${baseUrl}/api/goods-receipts/${posted.id}/reverse`, {
      method: 'POST',
      headers: mutationHeaders(config, `gr-close-reverse-${randomUUID()}`),
      body: JSON.stringify({
        expectedRevision: posted.revision,
        documentDate: '2026-07-29',
        reasonNote: 'Đảo phiếu chốt thiếu để kiểm tra phục hồi projection',
      }),
    });
    assert.equal(reverseResponse.status, 200);
    const reversed = await data(reverseResponse);
    assert.equal(reversed.status, 'reversed');

    const restoredResponse = await fetch(`${baseUrl}/api/purchase-orders/${approved.id}`, { headers: readHeaders(config) });
    const restoredPo = await data(restoredResponse);
    assert.equal(restoredPo.status, 'approved');
    assert.equal(restoredPo.acceptedQuantityTotal, '0.000000');
    assert.equal(restoredPo.rejectedQuantityTotal, '0.000000');
    assert.equal(restoredPo.shortageClosedQuantityTotal, '0.000000');
    assert.equal(restoredPo.remainingQuantityTotal, '10.000000');
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
    assert.equal(response.status, 403);
    assert.equal(await errorCode(response), 'WAREHOUSE_SCOPE_DENIED');
  } finally {
    if (emptyServer) await closeServer(emptyServer);
    await closePool();
  }
});

test('Goods receipt data is isolated by server-owned installation context', async () => {
  const configA = loadConfig(testEnv({ PORT: '3074', INSTALLATION_ID: `goods-receipt-a-${randomUUID()}` }));
  const configB = loadConfig(testEnv({ PORT: '3075', INSTALLATION_ID: `goods-receipt-b-${randomUUID()}` }));
  const pool = getPool(configA);
  let serverA;
  let serverB;
  try {
    const fixtureA = await seedFixture(pool, configA.installationId);
    const fixtureB = await seedFixture(pool, configB.installationId);
    serverA = await startServer({ config: configA });
    serverB = await startServer({ config: configB });
    const baseA = `http://${configA.host}:${configA.port}`;
    const baseB = `http://${configB.host}:${configB.port}`;
    const poA = await createApprovedPo(baseA, configA, fixtureA);
    const poB = await createApprovedPo(baseB, configB, fixtureB);

    let response = await fetch(`${baseA}/api/goods-receipts`, {
      method: 'POST',
      headers: mutationHeaders(configA, `gr-a-${randomUUID()}`),
      body: JSON.stringify(receiptPayload(poA, fixtureA, '1', 'INSTALLATION-A')),
    });
    assert.equal(response.status, 201);
    const receiptA = await data(response);

    response = await fetch(`${baseB}/api/goods-receipts`, {
      method: 'POST',
      headers: mutationHeaders(configB, `gr-b-${randomUUID()}`),
      body: JSON.stringify(receiptPayload(poB, fixtureB, '1', 'INSTALLATION-B')),
    });
    assert.equal(response.status, 201);
    const receiptB = await data(response);

    response = await fetch(`${baseA}/api/goods-receipts?limit=1000`, { headers: readHeaders(configA) });
    assert.equal(response.status, 200);
    const listA = await data(response);
    assert.deepEqual(listA.map((item) => item.id), [receiptA.id]);

    response = await fetch(`${baseB}/api/goods-receipts?limit=1000`, { headers: readHeaders(configB) });
    assert.equal(response.status, 200);
    const listB = await data(response);
    assert.deepEqual(listB.map((item) => item.id), [receiptB.id]);

    response = await fetch(`${baseA}/api/goods-receipts/${receiptB.id}`, { headers: readHeaders(configA) });
    assert.equal(response.status, 404);
    response = await fetch(`${baseB}/api/goods-receipts/${receiptA.id}`, { headers: readHeaders(configB) });
    assert.equal(response.status, 404);
  } finally {
    if (serverA) await closeServer(serverA);
    if (serverB) await closeServer(serverB);
    await closePool();
  }
});

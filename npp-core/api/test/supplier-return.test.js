import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { getPool, closePool } from '../src/db/pool.js';
import { startServer } from '../src/server.js';

function testEnv(overrides = {}) {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3079',
    INSTALLATION_ID: `supplier-return-test-${randomUUID()}`,
    DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://user:password@127.0.0.1:5432/npp_platform',
    DATABASE_SSL_MODE: process.env.TEST_DATABASE_SSL_MODE || process.env.DATABASE_SSL_MODE || 'disable',
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
    cartonUnitId: randomUUID(),
    productId: randomUUID(),
    baseVariantId: randomUUID(),
    cartonVariantId: randomUUID(),
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
    [ids.unitId, installationId, `EA${suffix.slice(0, 4)}`, `Đơn vị lẻ ${suffix}`, actor],
  );
  await pool.query(
    `INSERT INTO shared.units_of_measure
       (id, installation_id, code, name, unit_kind, allows_fractional, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,'PACKAGE',false,true,$5,$5)`,
    [ids.cartonUnitId, installationId, `CT${suffix.slice(0, 4)}`, `Thùng ${suffix}`, actor],
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
        unit_id, conversion_to_base, is_purchasable, created_at, updated_at, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,'BASE',true,true,true,true,NULL,NULL,true,date_trunc('milliseconds', clock_timestamp()),date_trunc('milliseconds', clock_timestamp()),$6,$6)`,
    [ids.baseVariantId, installationId, ids.productId, `BASE-${suffix}`, `Base ${suffix}`, actor],
  );
  await pool.query(
    `INSERT INTO shared.product_variants
       (id, installation_id, product_id, sku, name, variant_kind,
        is_inventory_base, is_sellable, is_catalog_visible, is_active,
        unit_id, conversion_to_base, is_purchasable, created_at, updated_at, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,'CARTON',false,true,true,true,NULL,NULL,true,date_trunc('milliseconds', clock_timestamp()),date_trunc('milliseconds', clock_timestamp()),$6,$6)`,
    [ids.cartonVariantId, installationId, ids.productId, `CTN-${suffix}`, `Carton ${suffix}`, actor],
  );
  await pool.query(
    `INSERT INTO inventory.product_tracking_policies
       (installation_id, base_variant_id, lot_tracking_mode, expiry_tracking_mode,
        location_required, version, created_at, created_by, updated_at, updated_by)
     VALUES ($1,$2,'NONE','NONE',true,1,now(),$3,now(),$3)`,
    [installationId, ids.baseVariantId, actor],
  );
  return ids;
}

async function createApprovedPurchaseOrder(baseUrl, config, fixture) {
  const createResponse = await fetch(`${baseUrl}/api/purchase-orders`, {
    method: 'POST',
    headers: mutationHeaders(config, `sr-po-create-${randomUUID()}`),
    body: JSON.stringify({
      supplierId: fixture.supplierId,
      warehouseId: fixture.warehouseId,
      orderDate: '2026-07-29',
      expectedDate: '2026-08-05',
      supplierReference: `SR-PO-${randomUUID()}`,
      currencyCode: 'VND',
      note: 'PO phuc vu supplier return',
      lines: [{
        variantId: fixture.cartonVariantId,
        quantity: '10',
        unitPrice: '10000',
        discountAmount: '0',
        taxAmount: '0',
      }],
    }),
  });
  assert.equal(createResponse.status, 201);
  const draft = await data(createResponse);

  let response = await fetch(`${baseUrl}/api/purchase-orders/${draft.id}/submit`, {
    method: 'POST',
    headers: mutationHeaders(config, `sr-po-submit-${randomUUID()}`),
    body: JSON.stringify({ expectedRevision: draft.revision }),
  });
  assert.equal(response.status, 200);
  const submitted = await data(response);

  response = await fetch(`${baseUrl}/api/purchase-orders/${draft.id}/approve`, {
    method: 'POST',
    headers: mutationHeaders(config, `sr-po-approve-${randomUUID()}`),
    body: JSON.stringify({ expectedRevision: submitted.revision }),
  });
  assert.equal(response.status, 200);
  return data(response);
}

async function createPostedGoodsReceipt(baseUrl, config, fixture, purchaseOrder) {
  const createResponse = await fetch(`${baseUrl}/api/goods-receipts`, {
    method: 'POST',
    headers: mutationHeaders(config, `sr-gr-create-${randomUUID()}`),
    body: JSON.stringify({
      purchaseOrderId: purchaseOrder.id,
      receiptDate: '2026-07-29',
      supplierDeliveryReference: `SR-GR-${randomUUID()}`,
      note: 'Phiếu nhận hàng phục vụ supplier return',
      lines: [{
        purchaseOrderLineId: purchaseOrder.lines[0].id,
        receivedQuantity: '2',
        acceptedQuantity: '2',
        rejectedQuantity: '0',
        finalizeLine: false,
        locationId: fixture.locationId,
        note: 'Dòng nhận',
      }],
    }),
  });
  assert.equal(createResponse.status, 201);
  const draft = await data(createResponse);

  let response = await fetch(`${baseUrl}/api/goods-receipts/${draft.id}/post`, {
    method: 'POST',
    headers: mutationHeaders(config, `sr-gr-post-${randomUUID()}`),
    body: JSON.stringify({ expectedRevision: draft.revision }),
  });
  assert.equal(response.status, 200);
  return data(response);
}

test('Supplier return lifecycle keeps trusted snapshots and blocks goods receipt reversal while active', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  let server;
  try {
    const fixture = await seedFixture(pool, config.installationId);
    server = await startServer({ config });
    const baseUrl = `http://${config.host}:${config.port}`;

    const baseAssign = await fetch(`${baseUrl}/api/products/${fixture.productId}/variants/${fixture.baseVariantId}/unit`, {
      method: 'PATCH',
      headers: mutationHeaders(config, `sr-base-unit-${randomUUID()}`),
      body: JSON.stringify({
        unitId: fixture.unitId,
        conversionToBase: '1',
        expectedUpdatedAt: (await pool.query(
          'SELECT updated_at FROM shared.product_variants WHERE installation_id = $1 AND id = $2',
          [config.installationId, fixture.baseVariantId],
        )).rows[0].updated_at,
      }),
    });
    assert.equal(baseAssign.status, 200);

    const cartonAssign = await fetch(`${baseUrl}/api/products/${fixture.productId}/variants/${fixture.cartonVariantId}/unit`, {
      method: 'PATCH',
      headers: mutationHeaders(config, `sr-carton-unit-${randomUUID()}`),
      body: JSON.stringify({
        unitId: fixture.cartonUnitId,
        conversionToBase: '12',
        expectedUpdatedAt: (await pool.query(
          'SELECT updated_at FROM shared.product_variants WHERE installation_id = $1 AND id = $2',
          [config.installationId, fixture.cartonVariantId],
        )).rows[0].updated_at,
      }),
    });
    assert.equal(cartonAssign.status, 200);
    const cartonAssigned = await cartonAssign.json();
    const cartonVariant = cartonAssigned.data;

    const purchaseOrder = await createApprovedPurchaseOrder(baseUrl, config, fixture);
    const goodsReceipt = await createPostedGoodsReceipt(baseUrl, config, fixture, purchaseOrder);
    assert.equal(goodsReceipt.status, 'posted');

    const sourceLinesResponse = await fetch(
      `${baseUrl}/api/supplier-returns/source-lines?goodsReceiptId=${goodsReceipt.id}`,
      { headers: readHeaders(config) },
    );
    assert.equal(sourceLinesResponse.status, 200);
    const sourceLines = await data(sourceLinesResponse);
    assert.equal(sourceLines.length, 1);
    assert.equal(sourceLines[0].returnableQuantity, '2.000000');

    const conversionChange = await fetch(`${baseUrl}/api/products/${fixture.productId}/variants/${fixture.cartonVariantId}/unit`, {
      method: 'PATCH',
      headers: mutationHeaders(config, `sr-carton-unit-change-${randomUUID()}`),
      body: JSON.stringify({
        unitId: fixture.cartonUnitId,
        conversionToBase: '24',
        expectedUpdatedAt: cartonVariant.updated_at,
      }),
    });
    assert.equal(conversionChange.status, 200);

    const createReturn = await fetch(`${baseUrl}/api/supplier-returns`, {
      method: 'POST',
      headers: mutationHeaders(config, `sr-create-${randomUUID()}`),
      body: JSON.stringify({
        supplierId: fixture.supplierId,
        warehouseId: fixture.warehouseId,
        returnDate: '2026-07-29',
        note: 'SR-RETURN-1',
        lines: [{
          sourceGoodsReceiptLineId: sourceLines[0].sourceGoodsReceiptLineId,
          returnQuantity: '1',
          reasonCode: 'DAMAGED',
          reasonNote: 'Thùng bị móp',
          note: 'Dòng trả',
        }],
      }),
    });
    assert.equal(createReturn.status, 201);
    const draftReturn = await data(createReturn);
    assert.equal(draftReturn.status, 'draft');

    let response = await fetch(`${baseUrl}/api/supplier-returns/${draftReturn.id}/submit`, {
      method: 'POST',
      headers: mutationHeaders(config, `sr-submit-${randomUUID()}`),
      body: JSON.stringify({ expectedRevision: draftReturn.revision }),
    });
    assert.equal(response.status, 200);
    const submittedReturn = await data(response);

    response = await fetch(`${baseUrl}/api/supplier-returns/${draftReturn.id}/approve`, {
      method: 'POST',
      headers: mutationHeaders(config, `sr-approve-${randomUUID()}`),
      body: JSON.stringify({ expectedRevision: submittedReturn.revision }),
    });
    assert.equal(response.status, 200);
    const approvedReturn = await data(response);

    response = await fetch(`${baseUrl}/api/supplier-returns/${draftReturn.id}/post`, {
      method: 'POST',
      headers: mutationHeaders(config, `sr-post-${randomUUID()}`),
      body: JSON.stringify({
        expectedRevision: approvedReturn.revision,
        reasonNote: 'Ghi sổ trả hàng NCC',
        documentDate: '2026-07-29',
      }),
    });
    assert.equal(response.status, 200);
    const postedReturn = await data(response);
    assert.equal(postedReturn.status, 'posted');
    assert.match(postedReturn.documentNumber, /^SR-202607-\d{6}$/);
    const postedMovement = await pool.query(
      `SELECT movement_type, direction
         FROM inventory.inventory_movements
        WHERE installation_id = $1 AND id = $2`,
      [config.installationId, postedReturn.inventoryMovementId],
    );
    assert.equal(postedMovement.rows[0].movement_type, 'SUPPLIER_RETURN_ISSUE');
    assert.equal(postedMovement.rows[0].direction, 'OUT');

    const balanceAfterPost = await pool.query(
      `SELECT on_hand_quantity::text AS on_hand_quantity
       FROM inventory.inventory_balances
       WHERE installation_id = $1
         AND warehouse_id = $2
         AND location_id = $3
         AND base_variant_id = $4
         AND lot_id IS NULL`,
      [config.installationId, fixture.warehouseId, fixture.locationId, fixture.baseVariantId],
    );
    assert.equal(balanceAfterPost.rows[0].on_hand_quantity, '12.000000000000');

    response = await fetch(`${baseUrl}/api/goods-receipts/${goodsReceipt.id}/reverse`, {
      method: 'POST',
      headers: mutationHeaders(config, `sr-gr-blocked-${randomUUID()}`),
      body: JSON.stringify({
        expectedRevision: goodsReceipt.revision,
        documentDate: '2026-07-29',
        reasonNote: 'Thử đảo phiếu nhận khi đang có phiếu trả NCC',
      }),
    });
    assert.equal(response.status, 409);
    assert.equal(await errorCode(response), 'GOODS_RECEIPT_SUPPLIER_RETURN_BLOCKED');

    response = await fetch(`${baseUrl}/api/supplier-returns/${draftReturn.id}/reverse`, {
      method: 'POST',
      headers: mutationHeaders(config, `sr-reverse-${randomUUID()}`),
      body: JSON.stringify({
        expectedRevision: postedReturn.revision,
        documentDate: '2026-07-29',
        reasonNote: 'Đảo phiếu trả để kiểm tra hoàn tác',
      }),
    });
    assert.equal(response.status, 200);
    const reversedReturn = await data(response);
    assert.equal(reversedReturn.status, 'reversed');

    const balanceAfterReverseReturn = await pool.query(
      `SELECT on_hand_quantity::text AS on_hand_quantity
       FROM inventory.inventory_balances
       WHERE installation_id = $1
         AND warehouse_id = $2
         AND location_id = $3
         AND base_variant_id = $4
         AND lot_id IS NULL`,
      [config.installationId, fixture.warehouseId, fixture.locationId, fixture.baseVariantId],
    );
    assert.equal(balanceAfterReverseReturn.rows[0].on_hand_quantity, '24.000000000000');

    response = await fetch(`${baseUrl}/api/goods-receipts/${goodsReceipt.id}/reverse`, {
      method: 'POST',
      headers: mutationHeaders(config, `sr-gr-reverse-${randomUUID()}`),
      body: JSON.stringify({
        expectedRevision: goodsReceipt.revision,
        documentDate: '2026-07-29',
        reasonNote: 'Đảo phiếu nhận sau khi phiếu trả đã được đảo',
      }),
    });
    assert.equal(response.status, 200);
    const reversedGoodsReceipt = await data(response);
    assert.equal(reversedGoodsReceipt.status, 'reversed');

    const balanceAfterReverseReceipt = await pool.query(
      `SELECT on_hand_quantity::text AS on_hand_quantity
       FROM inventory.inventory_balances
       WHERE installation_id = $1
         AND warehouse_id = $2
         AND location_id = $3
         AND base_variant_id = $4
         AND lot_id IS NULL`,
      [config.installationId, fixture.warehouseId, fixture.locationId, fixture.baseVariantId],
    );
    assert.equal(balanceAfterReverseReceipt.rows[0].on_hand_quantity, '0.000000000000');

    const activeReturns = await fetch(`${baseUrl}/api/supplier-returns?status=posted`, {
      headers: readHeaders(config),
    });
    assert.equal(activeReturns.status, 200);
    const postedList = await data(activeReturns);
    assert.equal(postedList.length, 0);
  } finally {
    if (server) await closeServer(server);
    await closePool();
  }
});


test('draft supplier return does not block receipt reversal and cannot submit afterwards', async () => {
  const config = loadConfig(testEnv({ PORT: '3080' }));
  const pool = getPool(config);
  let server;
  try {
    const fixture = await seedFixture(pool, config.installationId);
    await pool.query(
      `UPDATE shared.product_variants
          SET unit_id = CASE WHEN id = $2 THEN $4::uuid ELSE $5::uuid END,
              conversion_to_base = CASE WHEN id = $2 THEN 1 ELSE 12 END,
              updated_at = now()
        WHERE installation_id = $1 AND id IN ($2::uuid, $3::uuid)`,
      [
        config.installationId,
        fixture.baseVariantId,
        fixture.cartonVariantId,
        fixture.unitId,
        fixture.cartonUnitId,
      ],
    );
    server = await startServer({ config });
    const baseUrl = `http://${config.host}:${config.port}`;
    const purchaseOrder = await createApprovedPurchaseOrder(baseUrl, config, fixture);
    const goodsReceipt = await createPostedGoodsReceipt(baseUrl, config, fixture, purchaseOrder);
    const sourceResponse = await fetch(
      `${baseUrl}/api/supplier-returns/source-lines?goodsReceiptId=${goodsReceipt.id}`,
      { headers: readHeaders(config) },
    );
    assert.equal(sourceResponse.status, 200);
    const sourceLines = await data(sourceResponse);

    const createResponse = await fetch(`${baseUrl}/api/supplier-returns`, {
      method: 'POST',
      headers: mutationHeaders(config, `sr-draft-create-${randomUUID()}`),
      body: JSON.stringify({
        supplierId: fixture.supplierId,
        warehouseId: fixture.warehouseId,
        returnDate: '2026-07-29',
        lines: [{
          sourceGoodsReceiptLineId: sourceLines[0].sourceGoodsReceiptLineId,
          returnQuantity: '1',
          reasonCode: 'OTHER',
          reasonNote: 'Draft concurrency regression',
        }],
      }),
    });
    assert.equal(createResponse.status, 201);
    const draftReturn = await data(createResponse);

    const reverseResponse = await fetch(`${baseUrl}/api/goods-receipts/${goodsReceipt.id}/reverse`, {
      method: 'POST',
      headers: mutationHeaders(config, `sr-draft-gr-reverse-${randomUUID()}`),
      body: JSON.stringify({
        expectedRevision: goodsReceipt.revision,
        documentDate: '2026-07-29',
        reasonNote: 'Draft return must not block',
      }),
    });
    assert.equal(reverseResponse.status, 200);

    const submitResponse = await fetch(`${baseUrl}/api/supplier-returns/${draftReturn.id}/submit`, {
      method: 'POST',
      headers: mutationHeaders(config, `sr-draft-submit-${randomUUID()}`),
      body: JSON.stringify({ expectedRevision: draftReturn.revision }),
    });
    assert.equal(submitResponse.status, 409);
    assert.equal(await errorCode(submitResponse), 'SOURCE_RECEIPT_NOT_POSTED');
  } finally {
    if (server) await closeServer(server);
    await closePool();
  }
});

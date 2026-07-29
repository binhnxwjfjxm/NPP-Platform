import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { getPool, closePool } from '../src/db/pool.js';
import { startServer } from '../src/server.js';

function testEnv(overrides = {}) {
  return {
    NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '3081',
    INSTALLATION_ID: `payable-test-${randomUUID()}`,
    DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://user:password@127.0.0.1:5432/npp_platform',
    DATABASE_SSL_MODE: process.env.TEST_DATABASE_SSL_MODE || process.env.DATABASE_SSL_MODE || 'disable',
    BACKEND_API_TOKEN: 'test-token-0123456789abcdef', CORE_BOOTSTRAP_ACTOR_ID: 'test:bootstrap',
    CORS_ORIGINS: 'http://127.0.0.1:3003', ...overrides,
  };
}
function closeServer(server) { return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))); }
function mutationHeaders(config, key) { return { Authorization: `Bearer ${config.backendApiToken}`, 'Content-Type': 'application/json', 'Idempotency-Key': key }; }
function readHeaders(config) { return { Authorization: `Bearer ${config.backendApiToken}` }; }
async function data(response) { return (await response.json()).data; }

async function seedFixture(pool, installationId) {
  const actor = 'test:fixture';
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  const ids = {
    branchId: randomUUID(), warehouseId: randomUUID(), locationId: randomUUID(), supplierId: randomUUID(),
    paymentTermId: randomUUID(), unitId: randomUUID(), cartonUnitId: randomUUID(), productId: randomUUID(),
    baseVariantId: randomUUID(), cartonVariantId: randomUUID(),
  };
  await pool.query(`INSERT INTO shared.branches (id,installation_id,code,name,is_active,created_by,updated_by) VALUES ($1,$2,$3,$4,true,$5,$5)`, [ids.branchId, installationId, `PB-${suffix}`, `Chi nhánh ${suffix}`, actor]);
  await pool.query(`INSERT INTO shared.warehouses (id,installation_id,branch_id,code,name,warehouse_type,is_active,created_by,updated_by) VALUES ($1,$2,$3,$4,$5,'main',true,$6,$6)`, [ids.warehouseId, installationId, ids.branchId, `PW-${suffix}`, `Kho ${suffix}`, actor]);
  await pool.query(`INSERT INTO shared.warehouse_locations (id,installation_id,warehouse_id,code,name,location_type,is_active,created_by,updated_by) VALUES ($1,$2,$3,$4,$5,'storage',true,$6,$6)`, [ids.locationId, installationId, ids.warehouseId, `PL-${suffix}`, `Vị trí ${suffix}`, actor]);
  await pool.query(`INSERT INTO shared.suppliers (id,installation_id,code,name,is_active,created_by,updated_by) VALUES ($1,$2,$3,$4,true,$5,$5)`, [ids.supplierId, installationId, `PS-${suffix}`, `Nhà cung cấp ${suffix}`, actor]);
  await pool.query(`INSERT INTO shared.supplier_payment_terms (id,installation_id,supplier_id,payment_method,term_days,is_primary,is_active,created_by,updated_by) VALUES ($1,$2,$3,'BANK_TRANSFER',30,true,true,$4,$4)`, [ids.paymentTermId, installationId, ids.supplierId, actor]);
  await pool.query(`INSERT INTO shared.units_of_measure (id,installation_id,code,name,unit_kind,allows_fractional,is_active,created_by,updated_by) VALUES ($1,$2,$3,$4,'COUNT',true,true,$5,$5)`, [ids.unitId, installationId, `EA${suffix.slice(0, 4)}`, `Đơn vị lẻ ${suffix}`, actor]);
  await pool.query(`INSERT INTO shared.units_of_measure (id,installation_id,code,name,unit_kind,allows_fractional,is_active,created_by,updated_by) VALUES ($1,$2,$3,$4,'PACKAGE',false,true,$5,$5)`, [ids.cartonUnitId, installationId, `CT${suffix.slice(0, 4)}`, `Thùng ${suffix}`, actor]);
  await pool.query(`INSERT INTO shared.products (id,installation_id,code,name,is_orderable,is_active,created_by,updated_by) VALUES ($1,$2,$3,$4,true,true,$5,$5)`, [ids.productId, installationId, `PP-${suffix}`, `Sản phẩm ${suffix}`, actor]);
  await pool.query(`INSERT INTO shared.product_variants (id,installation_id,product_id,sku,name,variant_kind,is_inventory_base,is_sellable,is_catalog_visible,is_active,unit_id,conversion_to_base,is_purchasable,created_at,updated_at,created_by,updated_by) VALUES ($1,$2,$3,$4,$5,'BASE',true,true,true,true,NULL,NULL,true,date_trunc('milliseconds',clock_timestamp()),date_trunc('milliseconds',clock_timestamp()),$6,$6)`, [ids.baseVariantId, installationId, ids.productId, `PBASE-${suffix}`, `Base ${suffix}`, actor]);
  await pool.query(`INSERT INTO shared.product_variants (id,installation_id,product_id,sku,name,variant_kind,is_inventory_base,is_sellable,is_catalog_visible,is_active,unit_id,conversion_to_base,is_purchasable,created_at,updated_at,created_by,updated_by) VALUES ($1,$2,$3,$4,$5,'CARTON',false,true,true,true,NULL,NULL,true,date_trunc('milliseconds',clock_timestamp()),date_trunc('milliseconds',clock_timestamp()),$6,$6)`, [ids.cartonVariantId, installationId, ids.productId, `PCTN-${suffix}`, `Carton ${suffix}`, actor]);
  await pool.query(`INSERT INTO inventory.product_tracking_policies (installation_id,base_variant_id,lot_tracking_mode,expiry_tracking_mode,location_required,version,created_at,created_by,updated_at,updated_by) VALUES ($1,$2,'NONE','NONE',true,1,now(),$3,now(),$3)`, [installationId, ids.baseVariantId, actor]);
  return ids;
}

async function assignUnits(baseUrl, config, fixture, pool) {
  for (const [variantId, unitId, conversion] of [[fixture.baseVariantId, fixture.unitId, '1'], [fixture.cartonVariantId, fixture.cartonUnitId, '12']]) {
    const updatedAt = (await pool.query('SELECT updated_at FROM shared.product_variants WHERE installation_id=$1 AND id=$2', [config.installationId, variantId])).rows[0].updated_at;
    const response = await fetch(`${baseUrl}/api/products/${fixture.productId}/variants/${variantId}/unit`, {
      method: 'PATCH', headers: mutationHeaders(config, `pay-unit-${randomUUID()}`),
      body: JSON.stringify({ unitId, conversionToBase: conversion, expectedUpdatedAt: updatedAt }),
    });
    assert.equal(response.status, 200);
  }
}

async function createApprovedPurchaseOrder(baseUrl, config, fixture) {
  let response = await fetch(`${baseUrl}/api/purchase-orders`, {
    method: 'POST', headers: mutationHeaders(config, `pay-po-create-${randomUUID()}`),
    body: JSON.stringify({ supplierId: fixture.supplierId, warehouseId: fixture.warehouseId, orderDate: '2026-07-30', expectedDate: '2026-08-05', currencyCode: 'VND', lines: [{ variantId: fixture.cartonVariantId, quantity: '10', unitPrice: '10000', discountAmount: '10000', taxAmount: '20000' }] }),
  });
  assert.equal(response.status, 201);
  const draft = await data(response);
  response = await fetch(`${baseUrl}/api/purchase-orders/${draft.id}/submit`, { method: 'POST', headers: mutationHeaders(config, `pay-po-submit-${randomUUID()}`), body: JSON.stringify({ expectedRevision: draft.revision }) });
  assert.equal(response.status, 200);
  const submitted = await data(response);
  response = await fetch(`${baseUrl}/api/purchase-orders/${draft.id}/approve`, { method: 'POST', headers: mutationHeaders(config, `pay-po-approve-${randomUUID()}`), body: JSON.stringify({ expectedRevision: submitted.revision }) });
  assert.equal(response.status, 200);
  return data(response);
}

async function createPostedReceipt(baseUrl, config, fixture, purchaseOrder) {
  let response = await fetch(`${baseUrl}/api/goods-receipts`, {
    method: 'POST', headers: mutationHeaders(config, `pay-gr-create-${randomUUID()}`),
    body: JSON.stringify({ purchaseOrderId: purchaseOrder.id, receiptDate: '2026-07-30', supplierDeliveryReference: `PAY-${randomUUID()}`, lines: [{ purchaseOrderLineId: purchaseOrder.lines[0].id, receivedQuantity: '2', acceptedQuantity: '2', rejectedQuantity: '0', finalizeLine: false, locationId: fixture.locationId }] }),
  });
  assert.equal(response.status, 201);
  const draft = await data(response);
  const key = `pay-gr-post-${randomUUID()}`;
  const payload = { expectedRevision: draft.revision };
  response = await fetch(`${baseUrl}/api/goods-receipts/${draft.id}/post`, { method: 'POST', headers: mutationHeaders(config, key), body: JSON.stringify(payload) });
  assert.equal(response.status, 200);
  const posted = await data(response);
  assert.ok(posted.payableDocumentId);
  const replay = await fetch(`${baseUrl}/api/goods-receipts/${draft.id}/post`, { method: 'POST', headers: mutationHeaders(config, key), body: JSON.stringify(payload) });
  assert.equal(replay.status, 200);
  assert.equal((await data(replay)).payableDocumentId, posted.payableDocumentId);
  return posted;
}

async function createPostedSupplierReturn(baseUrl, config, fixture, goodsReceipt) {
  let response = await fetch(`${baseUrl}/api/supplier-returns/source-lines?goodsReceiptId=${goodsReceipt.id}`, { headers: readHeaders(config) });
  assert.equal(response.status, 200);
  const sourceLines = await data(response);
  response = await fetch(`${baseUrl}/api/supplier-returns`, {
    method: 'POST', headers: mutationHeaders(config, `pay-sr-create-${randomUUID()}`),
    body: JSON.stringify({ supplierId: fixture.supplierId, warehouseId: fixture.warehouseId, returnDate: '2026-07-30', lines: [{ sourceGoodsReceiptLineId: sourceLines[0].sourceGoodsReceiptLineId, returnQuantity: '1', reasonCode: 'DAMAGED', reasonNote: 'Hàng lỗi' }] }),
  });
  assert.equal(response.status, 201);
  const draft = await data(response);
  response = await fetch(`${baseUrl}/api/supplier-returns/${draft.id}/submit`, { method: 'POST', headers: mutationHeaders(config, `pay-sr-submit-${randomUUID()}`), body: JSON.stringify({ expectedRevision: draft.revision }) });
  assert.equal(response.status, 200);
  const submitted = await data(response);
  response = await fetch(`${baseUrl}/api/supplier-returns/${draft.id}/approve`, { method: 'POST', headers: mutationHeaders(config, `pay-sr-approve-${randomUUID()}`), body: JSON.stringify({ expectedRevision: submitted.revision }) });
  assert.equal(response.status, 200);
  const approved = await data(response);
  response = await fetch(`${baseUrl}/api/supplier-returns/${draft.id}/post`, { method: 'POST', headers: mutationHeaders(config, `pay-sr-post-${randomUUID()}`), body: JSON.stringify({ expectedRevision: approved.revision, documentDate: '2026-07-30', reasonNote: 'Ghi sổ trả hàng' }) });
  assert.equal(response.status, 200);
  const posted = await data(response);
  assert.ok(posted.payableDocumentId);
  return posted;
}

test('Phase 5.5 posts and reverses immutable supplier payable ledger facts', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  let server;
  try {
    const fixture = await seedFixture(pool, config.installationId);
    server = await startServer({ config });
    const baseUrl = `http://${config.host}:${config.port}`;
    await assignUnits(baseUrl, config, fixture, pool);
    const purchaseOrder = await createApprovedPurchaseOrder(baseUrl, config, fixture);
    const goodsReceipt = await createPostedReceipt(baseUrl, config, fixture, purchaseOrder);

    let response = await fetch(`${baseUrl}/api/payables/${goodsReceipt.payableDocumentId}`, { headers: readHeaders(config) });
    assert.equal(response.status, 200);
    const debit = await data(response);
    assert.equal(debit.direction, 'DEBIT');
    assert.equal(debit.originalAmount, '22000.000000');
    assert.equal(debit.paymentTermDays, 30);
    assert.equal(debit.dueDate, '2026-08-29');
    assert.equal(debit.lines[0].grossAmount, '20000.000000');
    assert.equal(debit.lines[0].discountAmount, '2000.000000');
    assert.equal(debit.lines[0].taxAmount, '4000.000000');

    const supplierReturn = await createPostedSupplierReturn(baseUrl, config, fixture, goodsReceipt);
    response = await fetch(`${baseUrl}/api/payables/${supplierReturn.payableDocumentId}`, { headers: readHeaders(config) });
    assert.equal(response.status, 200);
    const credit = await data(response);
    assert.equal(credit.direction, 'CREDIT');
    assert.equal(credit.originalAmount, '11000.000000');

    response = await fetch(`${baseUrl}/api/payables/balances`, { headers: readHeaders(config) });
    assert.equal(response.status, 200);
    let balances = await data(response);
    assert.equal(balances.length, 1);
    assert.equal(balances[0].balance, '11000.000000');

    response = await fetch(`${baseUrl}/api/supplier-returns/${supplierReturn.id}/reverse`, {
      method: 'POST', headers: mutationHeaders(config, `pay-sr-reverse-${randomUUID()}`),
      body: JSON.stringify({ expectedRevision: supplierReturn.revision, documentDate: '2026-07-30', reasonNote: 'Đảo phiếu trả' }),
    });
    assert.equal(response.status, 200);
    assert.equal((await data(response)).status, 'reversed');

    response = await fetch(`${baseUrl}/api/payables/balances`, { headers: readHeaders(config) });
    balances = await data(response);
    assert.equal(balances[0].balance, '22000.000000');

    response = await fetch(`${baseUrl}/api/goods-receipts/${goodsReceipt.id}/reverse`, {
      method: 'POST', headers: mutationHeaders(config, `pay-gr-reverse-${randomUUID()}`),
      body: JSON.stringify({ expectedRevision: goodsReceipt.revision, documentDate: '2026-07-30', reasonNote: 'Đảo phiếu nhận' }),
    });
    assert.equal(response.status, 200);
    assert.equal((await data(response)).status, 'reversed');

    response = await fetch(`${baseUrl}/api/payables/balances`, { headers: readHeaders(config) });
    balances = await data(response);
    assert.equal(balances[0].balance, '0.000000');

    const ledger = await pool.query(`SELECT entry_type,amount::text FROM accounting.payable_ledger_entries WHERE installation_id=$1 ORDER BY occurred_at,entry_type`, [config.installationId]);
    assert.equal(ledger.rowCount, 4);
    assert.deepEqual(new Set(ledger.rows.map((row) => row.entry_type)), new Set(['GOODS_RECEIPT_POST','SUPPLIER_RETURN_POST','SUPPLIER_RETURN_REVERSE','GOODS_RECEIPT_REVERSE']));

    await pool.query('SELECT accounting.rebuild_supplier_payable_balances()');
    const rebuilt = await pool.query(`SELECT balance::text FROM accounting.supplier_payable_balances WHERE installation_id=$1 AND supplier_id=$2 AND currency_code='VND'`, [config.installationId, fixture.supplierId]);
    assert.equal(rebuilt.rows[0].balance, '0.000000');

    const sourceCounts = await pool.query(`SELECT source_document_type,source_document_id,count(*)::int count FROM accounting.payable_documents WHERE installation_id=$1 GROUP BY source_document_type,source_document_id`, [config.installationId]);
    assert.ok(sourceCounts.rows.every((row) => row.count === 1));
  } finally {
    if (server) await closeServer(server);
    await closePool();
  }
});

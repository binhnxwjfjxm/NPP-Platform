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
    PORT: '3057',
    INSTALLATION_ID: `sales-entry-test-${randomUUID()}`,
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

function headers(config, key) {
  return {
    Authorization: `Bearer ${config.backendApiToken}`,
    'Content-Type': 'application/json',
    'Idempotency-Key': key,
  };
}

async function fixtures(pool, installationId) {
  const actor = 'test:fixture';
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const customerId = randomUUID();
  const addressId = randomUUID();
  const unitId = randomUUID();
  const productId = randomUUID();
  const variantId = randomUUID();
  const priceListId = randomUUID();
  const priceItemId = randomUUID();
  const barcodeId = randomUUID();
  const barcode = `893${Date.now()}${suffix.slice(0, 3)}`;

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
    [customerId, installationId, `CUS-${suffix}`, `Khách ${suffix}`, actor],
  );
  await pool.query(
    `INSERT INTO shared.customer_addresses
      (id, installation_id, customer_id, label, recipient_name, address_line1,
       country_code, is_default, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,'Giao hàng','Người nhận','123 Đường thử nghiệm',
       'VN',true,true,$4,$4)`,
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
    `INSERT INTO shared.product_barcodes
      (id, installation_id, variant_id, barcode, normalized_barcode,
       barcode_type, is_primary, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$4,'EAN13',true,true,$5,$5)`,
    [barcodeId, installationId, variantId, barcode, actor],
  );
  await pool.query(
    `INSERT INTO shared.price_lists
      (id, installation_id, code, name, list_type, currency_code, priority,
       stacking_mode, stop_processing, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,'BASE','VND',100,'EXCLUSIVE',true,true,$5,$5)`,
    [priceListId, installationId, `BASE-${suffix}`, `Giá nền ${suffix}`, actor],
  );
  await pool.query(
    `INSERT INTO shared.price_list_items
      (id, installation_id, price_list_id, variant_id, adjustment_type,
       amount_minor, min_quantity, source_kind, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,'FIXED_PRICE',10000,0,'ADMIN',true,$5,$5)`,
    [priceItemId, installationId, priceListId, variantId, actor],
  );
  await pool.query(
    `INSERT INTO shared.sales_order_settings
      (installation_id, default_tax_mode, default_tax_rate, created_by, updated_by)
     VALUES ($1,'EXCLUSIVE',10,$2,$2)`,
    [installationId, actor],
  );

  return { warehouseId, customerId, addressId, variantId, barcode };
}

function walkInPayload(fixture, overrides = {}) {
  return {
    sourceType: 'MANUAL',
    customerMode: 'WALK_IN',
    walkInDisplayName: 'Anh khách vãng lai',
    walkInPhone: '0901234567',
    warehouseId: fixture.warehouseId,
    deliveryMode: 'PICKUP',
    collectionPolicy: 'COLLECT_ON_DELIVERY',
    currency: 'VND',
    lines: [{
      variantId: fixture.variantId,
      quantity: '2',
      discountMode: 'TOTAL_AMOUNT',
      discountValue: '0',
      taxMode: 'INCLUSIVE',
      taxRate: '1',
    }],
    ...overrides,
  };
}

test('operational Sales Order entry supports walk-in, barcode search, explicit tax and Core fallback', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  let server;
  try {
    const fixture = await fixtures(pool, config.installationId);
    server = await startServer({ config });
    const baseUrl = `http://${config.host}:${config.port}`;

    const settingsResponse = await fetch(`${baseUrl}/api/sales-orders/entry-settings`, {
      headers: { Authorization: `Bearer ${config.backendApiToken}` },
    });
    assert.equal(settingsResponse.status, 200);
    const settings = (await settingsResponse.json()).data;
    assert.equal(settings.defaultTaxMode, 'EXCLUSIVE');
    assert.equal(settings.defaultTaxRate, '10.000000');

    const skuSearch = await fetch(`${baseUrl}/api/sales-orders/sku-search?search=${fixture.barcode}`, {
      headers: { Authorization: `Bearer ${config.backendApiToken}` },
    });
    assert.equal(skuSearch.status, 200);
    const skuOptions = (await skuSearch.json()).data;
    assert.equal(skuOptions.length, 1);
    assert.equal(skuOptions[0].id, fixture.variantId);
    assert.equal(skuOptions[0].barcode, fixture.barcode);
    assert.equal(skuOptions[0].eligibility.selectable, true);
    assert.equal(skuOptions[0].defaultTaxRate, '10.000000');

    const createWalkIn = (key, body = walkInPayload(fixture)) => fetch(`${baseUrl}/api/sales-orders`, {
      method: 'POST',
      headers: headers(config, key),
      body: JSON.stringify(body),
    });

    const firstResponse = await createWalkIn(`walk-in-${randomUUID()}`);
    assert.equal(firstResponse.status, 201);
    const first = (await firstResponse.json()).data;
    assert.equal(first.customerMode, 'WALK_IN');
    assert.equal(first.customerName, 'Anh khách vãng lai');
    assert.equal(first.walkInPhone, '0901234567');
    assert.equal(first.deliveryMode, 'PICKUP');
    assert.equal(first.versions[0].customerMode, 'WALK_IN');
    assert.equal(first.versions[0].lines[0].taxMode, 'INCLUSIVE');
    assert.equal(first.versions[0].lines[0].taxRate, '1.000000');
    assert.equal(first.versions[0].lines[0].taxAmount, '198.000000');
    assert.equal(first.versions[0].total, '20000.000000');

    const fallbackResponse = await createWalkIn(`walk-in-${randomUUID()}`, {
      ...walkInPayload(fixture, {
        walkInDisplayName: 'Khách dùng thuế mặc định',
        walkInPhone: '0923456789',
      }),
      lines: [{
        variantId: fixture.variantId,
        quantity: '2',
        discountMode: 'TOTAL_AMOUNT',
        discountValue: '0',
      }],
    });
    assert.equal(fallbackResponse.status, 201);
    const fallback = (await fallbackResponse.json()).data;
    assert.equal(fallback.versions[0].lines[0].taxMode, 'EXCLUSIVE');
    assert.equal(fallback.versions[0].lines[0].taxRate, '10.000000');
    assert.equal(fallback.versions[0].lines[0].taxAmount, '2000.000000');
    assert.equal(fallback.versions[0].total, '22000.000000');

    const configured = (await pool.query(
      `SELECT walk_in_customer_id FROM shared.sales_order_settings WHERE installation_id=$1`,
      [config.installationId],
    )).rows[0];
    assert.equal(configured.walk_in_customer_id, first.customerId);

    const secondResponse = await createWalkIn(`walk-in-${randomUUID()}`, walkInPayload(fixture, {
      walkInDisplayName: 'Chị khách khác',
      walkInPhone: '0912345678',
    }));
    assert.equal(secondResponse.status, 201);
    const second = (await secondResponse.json()).data;
    assert.equal(second.customerId, first.customerId);
    assert.equal(second.customerName, 'Chị khách khác');

    const customerCount = await pool.query(
      `SELECT count(*)::int AS count
       FROM shared.customers
       WHERE installation_id=$1 AND id=$2`,
      [config.installationId, first.customerId],
    );
    assert.equal(customerCount.rows[0].count, 1);

    const creditDenied = await createWalkIn(`walk-in-${randomUUID()}`, walkInPayload(fixture, {
      collectionPolicy: 'CREDIT_TERMS',
    }));
    assert.equal(creditDenied.status, 403);
    assert.equal((await creditDenied.json()).error.code, 'WALK_IN_COLLECTION_POLICY_FORBIDDEN');

    const deliveryDenied = await createWalkIn(`walk-in-${randomUUID()}`, walkInPayload(fixture, {
      deliveryMode: 'DELIVERY',
      customerAddressId: fixture.addressId,
    }));
    assert.equal(deliveryDenied.status, 400);
    assert.equal((await deliveryDenied.json()).error.code, 'WALK_IN_PICKUP_REQUIRED');
  } finally {
    if (server) await closeServer(server);
    await closePool();
  }
});

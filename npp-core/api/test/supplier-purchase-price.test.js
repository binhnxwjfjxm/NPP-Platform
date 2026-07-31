import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { loadConfig } from '../src/config.js';
import { getPool, closePool } from '../src/db/pool.js';
import { startServer } from '../src/server.js';
import { PERMISSIONS } from '../src/request-context.js';
import { projectPurchaseOrderPricing } from '../src/services/purchase-order-pricing.js';

function testEnv(overrides = {}) {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3091',
    INSTALLATION_ID: `supplier-price-test-${randomUUID()}`,
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

async function requestJson(url, init) {
  const response = await fetch(url, init);
  const body = await response.json();
  return { response, body };
}

async function seedFixture(pool, installationId) {
  const actor = 'test:fixture';
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  const ids = {
    branchId: randomUUID(),
    warehouseId: randomUUID(),
    supplierAId: randomUUID(),
    supplierBId: randomUUID(),
    supplierWithoutPriceId: randomUUID(),
    unitId: randomUUID(),
    productId: randomUUID(),
    variantId: randomUUID(),
  };

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
  for (const [id, code, name] of [
    [ids.supplierAId, `SA-${suffix}`, `Nhà cung cấp A ${suffix}`],
    [ids.supplierBId, `SB-${suffix}`, `Nhà cung cấp B ${suffix}`],
    [ids.supplierWithoutPriceId, `SN-${suffix}`, `Nhà cung cấp chưa có giá ${suffix}`],
  ]) {
    await pool.query(
      `INSERT INTO shared.suppliers
         (id, installation_id, code, name, is_active, created_by, updated_by)
       VALUES ($1,$2,$3,$4,true,$5,$5)`,
      [id, installationId, code, name, actor],
    );
  }
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
  return ids;
}

async function createPrice(baseUrl, config, payload, key = `supplier-price-${randomUUID()}`) {
  return requestJson(`${baseUrl}/api/supplier-purchase-prices`, {
    method: 'POST',
    headers: mutationHeaders(config, key),
    body: JSON.stringify(payload),
  });
}

async function resolvePrice(baseUrl, config, payload) {
  return requestJson(`${baseUrl}/api/supplier-purchase-prices/resolve`, {
    method: 'POST',
    headers: { ...readHeaders(config), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

function poPayload(fixture, supplierId, lines) {
  return {
    supplierId,
    warehouseId: fixture.warehouseId,
    orderDate: '2026-07-31',
    expectedDate: '2026-08-05',
    currencyCode: 'VND',
    note: 'PO kiểm thử giá mua',
    lines,
  };
}

function assertNoMoney(value) {
  const serialized = JSON.stringify(value);
  for (const key of [
    'unitPrice', 'discountMode', 'discountValue', 'discountAmount', 'taxRate',
    'taxAmount', 'lineTotal', 'subtotal', 'discountTotal', 'taxTotal', 'total',
    'purchasePriceId', 'purchasePriceSource', 'purchasePriceResolvedAt',
    'supplierSkuSnapshot', 'priceOverrideReason',
  ]) {
    assert.equal(serialized.includes(`"${key}"`), false, `response leaked ${key}`);
  }
}

function pricePayload(fixture, overrides = {}) {
  return {
    supplierId: fixture.supplierAId,
    variantId: fixture.variantId,
    unitId: fixture.unitId,
    currencyCode: 'VND',
    unitPrice: '100000',
    minQuantity: '0',
    effectiveFrom: '2026-07-01',
    effectiveTo: null,
    supplierSku: null,
    sourceReference: null,
    note: null,
    isActive: true,
    ...overrides,
  };
}

test('supplier purchase prices resolve by supplier, tier and effective range without Sales Pricing fallback', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  let server;
  try {
    const fixture = await seedFixture(pool, config.installationId);
    server = await startServer({ config });
    const baseUrl = `http://${config.host}:${config.port}`;

    let result = await createPrice(baseUrl, config, pricePayload(fixture));
    assert.equal(result.response.status, 201, JSON.stringify(result.body));

    result = await createPrice(baseUrl, config, pricePayload(fixture, {
      unitPrice: '90000',
      minQuantity: '10',
      supplierSku: 'NCC-A-SKU',
    }));
    assert.equal(result.response.status, 201, JSON.stringify(result.body));
    const tierPrice = result.body.data;

    result = await createPrice(baseUrl, config, pricePayload(fixture, {
      supplierId: fixture.supplierBId,
      unitPrice: '110000',
    }));
    assert.equal(result.response.status, 201, JSON.stringify(result.body));

    result = await createPrice(baseUrl, config, pricePayload(fixture, {
      unitPrice: '80000',
      minQuantity: '20',
      effectiveFrom: '2026-08-01',
    }));
    assert.equal(result.response.status, 201, JSON.stringify(result.body));

    let resolved = await resolvePrice(baseUrl, config, {
      supplierId: fixture.supplierAId,
      variantId: fixture.variantId,
      unitId: fixture.unitId,
      quantity: '5',
      currencyCode: 'VND',
      orderDate: '2026-07-31',
    });
    assert.equal(resolved.response.status, 200, JSON.stringify(resolved.body));
    assert.equal(resolved.body.data.price.unitPrice, '100000.000000');

    resolved = await resolvePrice(baseUrl, config, {
      supplierId: fixture.supplierAId,
      variantId: fixture.variantId,
      unitId: fixture.unitId,
      quantity: '10',
      currencyCode: 'VND',
      orderDate: '2026-07-31',
    });
    assert.equal(resolved.body.data.price.id, tierPrice.id);
    assert.equal(resolved.body.data.price.unitPrice, '90000.000000');
    assert.equal(resolved.body.data.price.supplierSku, 'NCC-A-SKU');

    resolved = await resolvePrice(baseUrl, config, {
      supplierId: fixture.supplierBId,
      variantId: fixture.variantId,
      unitId: fixture.unitId,
      quantity: '10',
      currencyCode: 'VND',
      orderDate: '2026-07-31',
    });
    assert.equal(resolved.body.data.price.unitPrice, '110000.000000');

    resolved = await resolvePrice(baseUrl, config, {
      supplierId: fixture.supplierAId,
      variantId: fixture.variantId,
      unitId: fixture.unitId,
      quantity: '20',
      currencyCode: 'VND',
      orderDate: '2026-07-31',
    });
    assert.equal(resolved.body.data.price.unitPrice, '90000.000000');

    resolved = await resolvePrice(baseUrl, config, {
      supplierId: fixture.supplierAId,
      variantId: fixture.variantId,
      unitId: fixture.unitId,
      quantity: '20',
      currencyCode: 'USD',
      orderDate: '2026-07-31',
    });
    assert.deepEqual(resolved.body.data, { status: 'NOT_FOUND', price: null });

    result = await createPrice(baseUrl, config, pricePayload(fixture, {
      unitPrice: '91000',
      minQuantity: '10',
    }));
    assert.equal(result.response.status, 409);
    assert.equal(result.body.error.code, 'DUPLICATE_SUPPLIER_PURCHASE_PRICE');

    const pricingSource = await readFile(new URL('../src/services/purchase-order-pricing.js', import.meta.url), 'utf8');
    const supplierSource = await readFile(new URL('../src/services/supplier-purchase-price.js', import.meta.url), 'utf8');
    assert.doesNotMatch(pricingSource, /services\/pricing|repositories\/pricing|price_lists|BASE/);
    assert.doesNotMatch(supplierSource, /services\/pricing|repositories\/pricing|price_lists|BASE/);
  } finally {
    if (server) await closeServer(server);
    await closePool();
  }
});

test('quantity-only PO resolves server-side, rejects explicit price input and redacts every amount', async () => {
  const config = loadConfig(testEnv({ PORT: '3092' }));
  const pool = getPool(config);
  let bootstrapServer;
  let quantityServer;
  let finalServer;
  try {
    const fixture = await seedFixture(pool, config.installationId);
    bootstrapServer = await startServer({ config });
    const baseUrl = `http://${config.host}:${config.port}`;

    let result = await createPrice(baseUrl, config, pricePayload(fixture, {
      unitPrice: '75000',
      supplierSku: 'SUP-A-ITEM',
      sourceReference: 'QUOTE-01',
    }));
    assert.equal(result.response.status, 201, JSON.stringify(result.body));
    const configuredPrice = result.body.data;

    result = await requestJson(`${baseUrl}/api/purchase-orders`, {
      method: 'POST',
      headers: mutationHeaders(config, `manual-without-reason-${randomUUID()}`),
      body: JSON.stringify(poPayload(fixture, fixture.supplierAId, [{
        variantId: fixture.variantId,
        quantity: '2',
        unitPrice: '70000',
        discountAmount: '0',
        taxAmount: '0',
        note: '',
      }])),
    });
    assert.equal(result.response.status, 400);
    assert.equal(result.body.error.code, 'PURCHASE_ORDER_PRICE_OVERRIDE_REASON_REQUIRED');

    result = await requestJson(`${baseUrl}/api/purchase-orders`, {
      method: 'POST',
      headers: mutationHeaders(config, `zero-price-${randomUUID()}`),
      body: JSON.stringify(poPayload(fixture, fixture.supplierAId, [{
        variantId: fixture.variantId,
        quantity: '2',
        unitPrice: '0',
        note: '',
      }])),
    });
    assert.equal(result.response.status, 400);
    assert.equal(result.body.error.code, 'INVALID_UNIT_PRICE');

    await closeServer(bootstrapServer);
    bootstrapServer = null;
    quantityServer = await startServer({
      config,
      authenticateRequest: () => ({
        ok: true,
        principal: {
          actorId: 'test:quantity-only',
          permissions: [
            PERMISSIONS.corePurchaseOrderRead,
            PERMISSIONS.corePurchaseOrderCreate,
            PERMISSIONS.corePurchaseOrderUpdate,
            PERMISSIONS.corePurchaseOrderSubmit,
          ],
          scopes: { warehouseIds: [fixture.warehouseId] },
          sourceApp: 'test',
        },
      }),
    });

    result = await requestJson(`${baseUrl}/api/purchase-orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': `quantity-only-create-${randomUUID()}`,
      },
      body: JSON.stringify(poPayload(fixture, fixture.supplierAId, [{
        variantId: fixture.variantId,
        quantity: '2',
        note: 'Chỉ nhập số lượng',
      }])),
    });
    assert.equal(result.response.status, 201, JSON.stringify(result.body));
    assert.equal(result.body.data.priceStatus, 'RESOLVED');
    assert.equal(result.body.data.lines[0].priceStatus, 'RESOLVED');
    assertNoMoney(result.body.data);
    const purchaseOrderId = result.body.data.id;

    result = await requestJson(`${baseUrl}/api/purchase-orders/${purchaseOrderId}`);
    assert.equal(result.response.status, 200, JSON.stringify(result.body));
    assertNoMoney(result.body.data);

    const countBeforeDenied = Number((await pool.query(
      'SELECT count(*) FROM purchasing.purchase_orders WHERE installation_id = $1',
      [config.installationId],
    )).rows[0].count);

    for (const [key, line] of [
      ['override', { variantId: fixture.variantId, quantity: '2', unitPrice: '72000', priceOverrideReason: 'Không được phép', note: '' }],
      ['zero', { variantId: fixture.variantId, quantity: '2', unitPrice: '0', note: '' }],
    ]) {
      result = await requestJson(`${baseUrl}/api/purchase-orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `quantity-only-${key}-${randomUUID()}`,
        },
        body: JSON.stringify(poPayload(fixture, fixture.supplierAId, [line])),
      });
      assert.equal(result.response.status, 403);
      assert.equal(result.body.error.code, 'PURCHASE_ORDER_PRICE_OVERRIDE_FORBIDDEN');
    }

    result = await requestJson(`${baseUrl}/api/purchase-orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': `missing-price-${randomUUID()}`,
      },
      body: JSON.stringify(poPayload(fixture, fixture.supplierWithoutPriceId, [{
        variantId: fixture.variantId,
        quantity: '2',
        note: '',
      }])),
    });
    assert.equal(result.response.status, 404);
    assert.equal(result.body.error.code, 'SUPPLIER_PURCHASE_PRICE_NOT_FOUND');
    const countAfterDenied = Number((await pool.query(
      'SELECT count(*) FROM purchasing.purchase_orders WHERE installation_id = $1',
      [config.installationId],
    )).rows[0].count);
    assert.equal(countAfterDenied, countBeforeDenied);

    await closeServer(quantityServer);
    quantityServer = null;
    finalServer = await startServer({ config });

    result = await requestJson(`${baseUrl}/api/supplier-purchase-prices/${configuredPrice.id}`, {
      method: 'PATCH',
      headers: { ...readHeaders(config), 'Content-Type': 'application/json' },
      body: JSON.stringify({ unitPrice: '80000', expectedRevision: configuredPrice.revision }),
    });
    assert.equal(result.response.status, 200, JSON.stringify(result.body));

    result = await requestJson(`${baseUrl}/api/purchase-orders/${purchaseOrderId}`, { headers: readHeaders(config) });
    assert.equal(result.response.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.data.lines[0].unitPrice, '75000.000000');
    assert.equal(result.body.data.lines[0].purchasePriceSource, 'SUPPLIER_PRICE');
    assert.equal(result.body.data.lines[0].purchasePriceId, configuredPrice.id);
  } finally {
    if (bootstrapServer) await closeServer(bootstrapServer);
    if (quantityServer) await closeServer(quantityServer);
    if (finalServer) await closeServer(finalServer);
    await closePool();
  }
});

test('price projection is fail closed without price-read permission', () => {
  const projected = projectPurchaseOrderPricing(
    { permissions: [PERMISSIONS.corePurchaseOrderRead] },
    {
      id: randomUUID(),
      subtotal: '100',
      discountTotal: '0',
      taxTotal: '10',
      total: '110',
      lines: [{
        variantId: randomUUID(),
        quantity: '1',
        unitPrice: '100',
        discountMode: 'TOTAL_AMOUNT',
        discountValue: '0',
        discountAmount: '0',
        taxRate: '10',
        taxAmount: '10',
        lineTotal: '110',
        purchasePriceId: randomUUID(),
        purchasePriceSource: 'SUPPLIER_PRICE',
        purchasePriceResolvedAt: new Date().toISOString(),
        supplierSkuSnapshot: 'SECRET-SKU',
        priceOverrideReason: null,
      }],
    },
  );
  assert.equal(projected.priceStatus, 'RESOLVED');
  assertNoMoney(projected);
});

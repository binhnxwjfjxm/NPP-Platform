import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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

async function envelope(response) {
  return response.json();
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
  return fetch(`${baseUrl}/api/supplier-purchase-prices`, {
    method: 'POST',
    headers: mutationHeaders(config, key),
    body: JSON.stringify(payload),
  });
}

async function resolvePrice(baseUrl, config, payload) {
  const response = await fetch(`${baseUrl}/api/supplier-purchase-prices/resolve`, {
    method: 'POST',
    headers: { ...readHeaders(config), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { response, payload: await envelope(response) };
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

test('supplier purchase prices resolve by supplier, tier and effective range without touching Sales Pricing', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  let server;
  try {
    const fixture = await seedFixture(pool, config.installationId);
    server = await startServer({ config });
    const baseUrl = `http://${config.host}:${config.port}`;

    const common = {
      variantId: fixture.variantId,
      unitId: fixture.unitId,
      currencyCode: 'VND',
      effectiveFrom: '2026-07-01',
      effectiveTo: null,
      supplierSku: null,
      sourceReference: null,
      note: null,
      isActive: true,
    };
    let response = await createPrice(baseUrl, config, {
      ...common,
      supplierId: fixture.supplierAId,
      unitPrice: '100000',
      minQuantity: '0',
    });
    assert.equal(response.status, 201, JSON.stringify(await envelope(response)));
    const priceA = (await envelope(await createPrice(baseUrl, config, {
      ...common,
      supplierId: fixture.supplierAId,
      unitPrice: '90000',
      minQuantity: '10',
      supplierSku: 'NCC-A-SKU',
    }))).data;
    response = await createPrice(baseUrl, config, {
      ...common,
      supplierId: fixture.supplierBId,
      unitPrice: '110000',
      minQuantity: '0',
    });
    assert.equal(response.status, 201, JSON.stringify(await envelope(response)));
    response = await createPrice(baseUrl, config, {
      ...common,
      supplierId: fixture.supplierAId,
      unitPrice: '80000',
      minQuantity: '20',
      effectiveFrom: '2026-08-01',
    });
    assert.equal(response.status, 201, JSON.stringify(await envelope(response)));

    let resolved = await resolvePrice(baseUrl, config, {
      supplierId: fixture.supplierAId,
      variantId: fixture.variantId,
      unitId: fixture.unitId,
      quantity: '5',
      currencyCode: 'VND',
      orderDate: '2026-07-31',
    });
    assert.equal(resolved.response.status, 200);
    assert.equal(resolved.payload.data.status, 'RESOLVED');
    assert.equal(resolved.payload.data.price.unitPrice, '100000.000000');

    resolved = await resolvePrice(baseUrl, config, {
      supplierId: fixture.supplierAId,
      variantId: fixture.variantId,
      unitId: fixture.unitId,
      quantity: '10',
      currencyCode: 'VND',
      orderDate: '2026-07-31',
    });
    assert.equal(resolved.payload.data.price.id, priceA.id);
    assert.equal(resolved.payload.data.price.unitPrice, '90000.000000');
    assert.equal(resolved.payload.data.price.supplierSku, 'NCC-A-SKU');

    resolved = await resolvePrice(baseUrl, config, {
      supplierId: fixture.supplierBId,
      variantId: fixture.variantId,
      unitId: fixture.unitId,
      quantity: '10',
      currencyCode: 'VND',
      orderDate: '2026-07-31',
    });
    assert.equal(resolved.payload.data.price.unitPrice, '110000.000000');

    resolved = await resolvePrice(baseUrl, config, {
      supplierId: fixture.supplierAId,
      variantId: fixture.variantId,
      unitId: fixture.unitId,
      quantity: '20',
      currencyCode: 'VND',
      orderDate: '2026-07-31',
    });
    assert.equal(resolved.payload.data.price.unitPrice, '90000.000000');

    resolved = await resolvePrice(baseUrl, config, {
      supplierId: fixture.supplierAId,
      variantId: fixture.variantId,
      unitId: fixture.unitId,
      quantity: '20',
      currencyCode: 'USD',
      orderDate: '2026-07-31',
    });
    assert.equal(resolved.payload.data.status, 'NOT_FOUND');
    assert.equal(Object.hasOwn(resolved.payload.data, 'price'), true);
    assert.equal(resolved.payload.data.price, null);

    response = await createPrice(baseUrl, config, {
      ...common,
      supplierId: fixture.supplierAId,
      unitPrice: '91000',
      minQuantity: '10',
    });
    assert.equal(response.status, 409);
    assert.equal((await envelope(response)).error.code, 'DUPLICATE_SUPPLIER_PURCHASE_PRICE');

    const pricingSource = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../src/services/purchase-order-pricing.js', import.meta.url), 'utf8'));
    const supplierSource = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../src/services/supplier-purchase-price.js', import.meta.url), 'utf8'));
    assert.doesNotMatch(pricingSource, /services\/pricing|repositories\/pricing|price_lists|BASE/);
    assert.doesNotMatch(supplierSource, /services\/pricing|repositories\/pricing|price_lists|BASE/);
  } finally {
    if (server) await closeServer(server);
    await closePool();
  }
});

test('quantity-only PO resolves server-side and redacts every amount and provenance field', async () => {
  const config = loadConfig(testEnv({ PORT: '3092' }));
  const pool = getPool(config);
  let bootstrapServer;
  let quantityServer;
  let finalServer;
  try {
    const fixture = await seedFixture(pool, config.installationId);
    bootstrapServer = await startServer({ config });
    const baseUrl = `http://${config.host}:${config.port}`;
    let response = await createPrice(baseUrl, config, {
      supplierId: fixture.supplierAId,
      variantId: fixture.variantId,
      unitId: fixture.unitId,
      currencyCode: 'VND',
      unitPrice: '75000',
      minQuantity: '0',
      effectiveFrom: '2026-07-01',
      effectiveTo: null,
      supplierSku: 'SUP-A-ITEM',
      sourceReference: 'QUOTE-01',
      note: null,
      isActive: true,
    });
    assert.equal(response.status, 201, JSON.stringify(await envelope(response)));
    const configuredPrice = (await envelope(response)).data;

    response = await fetch(`${baseUrl}/api/purchase-orders`, {
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
    assert.equal(response.status, 400);
    assert.equal((await envelope(response)).error.code, 'PURCHASE_ORDER_PRICE_OVERRIDE_REASON_REQUIRED');

    response = await fetch(`${baseUrl}/api/purchase-orders`, {
      method: 'POST',
      headers: mutationHeaders(config, `zero-price-${randomUUID()}`),
      body: JSON.stringify(poPayload(fixture, fixture.supplierAId, [{
        variantId: fixture.variantId,
        quantity: '2',
        unitPrice: '0',
        note: '',
      }])),
    });
    assert.equal(response.status, 400);
    assert.equal((await envelope(response)).error.code, 'INVALID_UNIT_PRICE');

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

    response = await fetch(`${baseUrl}/api/purchase-orders`, {
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
    const createBody = await envelope(response);
    assert.equal(response.status, 201, JSON.stringify(createBody));
    assert.equal(createBody.data.priceStatus, 'RESOLVED');
    assert.equal(createBody.data.lines[0].priceStatus, 'RESOLVED');
    assertNoMoney(createBody.data);
    const purchaseOrderId = createBody.data.id;

    response = await fetch(`${baseUrl}/api/purchase-orders/${purchaseOrderId}`);
    const detailBody = await envelope(response);
    assert.equal(response.status, 200, JSON.stringify(detailBody));
    assertNoMoney(detailBody.data);

    const beforeDeniedCount = Number((await pool.query(
      `SELECT count(*) FROM purchasing.purchase_orders WHERE installation_id = $1`,
      [config.installationId],
    )).rows[0].count);
    response = await fetch(`${baseUrl}/api/purchase-orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': `quantity-only-override-${randomUUID()}`,
      },
      body: JSON.stringify(poPayload(fixture, fixture.supplierAId, [{
        variantId: fixture.variantId,
        quantity: '2',
        unitPrice: '72000',
        priceOverrideReason: 'Không được phép',
        note: '',
      }])),
    });
    assert.equal(response.status, 403);
    assert.equal((await envelope(response)).error.code, 'PURCHASE_ORDER_PRICE_OVERRIDE_FORBIDDEN');

    response = await fetch(`${baseUrl}/api/purchase-orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': `quantity-only-zero-${randomUUID()}`,
      },
      body: JSON.stringify(poPayload(fixture, fixture.supplierAId, [{
        variantId: fixture.variantId,
        quantity: '2',
        unitPrice: '0',
        note: '',
      }])),
    });
    assert.equal(response.status, 403);
    assert.equal((await envelope(response)).error.code, 'PURCHASE_ORDER_PRICE_OVERRIDE_FORBIDDEN');

    response = await fetch(`${baseUrl}/api/purchase-orders`, {
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
    assert.equal(response.status, 404);
    assert.equal((await envelope(response)).error.code, 'SUPPLIER_PURCHASE_PRICE_NOT_FOUND');
    const afterDeniedCount = Number((await pool.query(
      `SELECT count(*) FROM purchasing.purchase_orders WHERE installation_id = $1`,
      [config.installationId],
    )).rows[0].count);
    assert.equal(afterDeniedCount, beforeDeniedCount);

    await closeServer(quantityServer);
    quantityServer = null;
    finalServer = await startServer({ config });

    response = await fetch(`${baseUrl}/api/supplier-purchase-prices/${configuredPrice.id}`, {
      method: 'PATCH',
      headers: { ...readHeaders(config), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        unitPrice: '80000',
        expectedRevision: configuredPrice.revision,
      }),
    });
    assert.equal(response.status, 200, JSON.stringify(await envelope(response)));

    response = await fetch(`${baseUrl}/api/purchase-orders/${purchaseOrderId}`, { headers: readHeaders(config) });
    const internalDetail = await envelope(response);
    assert.equal(response.status, 200, JSON.stringify(internalDetail));
    assert.equal(internalDetail.data.lines[0].unitPrice, '75000.000000');
    assert.equal(internalDetail.data.lines[0].purchasePriceSource, 'SUPPLIER_PRICE');
    assert.equal(internalDetail.data.lines[0].purchasePriceId, configuredPrice.id);
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

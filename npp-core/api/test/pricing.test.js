import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { getPool, closePool } from '../src/db/pool.js';
import { startServer } from '../src/server.js';
import * as productService from '../src/services/product.js';
import * as productUnitService from '../src/services/product-unit.js';
import * as customerService from '../src/services/customer.js';
import * as pricingService from '../src/services/pricing.js';

function testEnv(overrides = {}) {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3029',
    INSTALLATION_ID: `pricing-test-${randomUUID()}`,
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

async function createCatalog(pool, installationId, suffix) {
  const product = await productService.createProduct(pool, {
    installationId,
    payload: { code: `PRICE-${suffix}`, name: `Sản phẩm giá ${suffix}` },
    createdBy: 'test:user',
  });
  assert.ok(product.ok, product.message);
  const base = await productService.createProductVariant(pool, {
    installationId,
    productId: product.product.id,
    payload: { sku: `PRICE-${suffix}`, name: `SKU lẻ ${suffix}`, variantKind: 'BASE', isInventoryBase: true, isSellable: true },
    createdBy: 'test:user',
  });
  assert.ok(base.ok, base.message);
  const carton = await productService.createProductVariant(pool, {
    installationId,
    productId: product.product.id,
    payload: { sku: `PRICE-${suffix}T`, name: `SKU thùng ${suffix}`, variantKind: 'CARTON', isInventoryBase: false, isSellable: true },
    createdBy: 'test:user',
  });
  assert.ok(carton.ok, carton.message);
  const eachUnit = await productUnitService.createUnit(pool, {
    installationId,
    payload: { code: `EA-${suffix}`, name: 'Đơn vị lẻ', unitKind: 'COUNT', allowsFractional: false },
    createdBy: 'test:user',
  });
  assert.ok(eachUnit.ok, eachUnit.message);
  const cartonUnit = await productUnitService.createUnit(pool, {
    installationId,
    payload: { code: `CT-${suffix}`, name: 'Thùng', unitKind: 'PACKAGE', allowsFractional: false },
    createdBy: 'test:user',
  });
  assert.ok(cartonUnit.ok, cartonUnit.message);
  const assignedBase = await productUnitService.assignVariantUnit(pool, {
    installationId,
    productId: product.product.id,
    variantId: base.variant.id,
    payload: { unitId: eachUnit.unit.id, conversionToBase: '1', expectedUpdatedAt: base.variant.updated_at },
    updatedBy: 'test:user',
  });
  assert.ok(assignedBase.ok, assignedBase.message);
  const assignedCarton = await productUnitService.assignVariantUnit(pool, {
    installationId,
    productId: product.product.id,
    variantId: carton.variant.id,
    payload: { unitId: cartonUnit.unit.id, conversionToBase: '12', expectedUpdatedAt: carton.variant.updated_at },
    updatedBy: 'test:user',
  });
  assert.ok(assignedCarton.ok, assignedCarton.message);
  return { product: product.product, base: assignedBase.variant, carton: assignedCarton.variant };
}

async function createCustomerContext(pool, installationId, suffix) {
  const group = await customerService.createCustomerGroup(pool, {
    installationId,
    payload: { code: `VIP-${suffix}`, name: `Khách VIP ${suffix}` },
    createdBy: 'test:user',
  });
  assert.ok(group.ok, group.message);
  const customer = await customerService.createCustomer(pool, {
    installationId,
    payload: { code: `KH-${suffix}`, name: `Khách ${suffix}`, groupId: group.group.id },
    createdBy: 'test:user',
  });
  assert.ok(customer.ok, customer.message);
  return { group: group.group, customer: customer.customer };
}

async function createList(pool, installationId, payload) {
  const result = await pricingService.createPriceList(pool, { installationId, payload, createdBy: 'test:user' });
  assert.ok(result.ok, result.message);
  return result.priceList;
}

async function createItem(pool, installationId, priceListId, payload) {
  const result = await pricingService.createPriceListItem(pool, { installationId, priceListId, payload, createdBy: 'test:user' });
  assert.ok(result.ok, result.message);
  return result.item;
}

test('Pricing service — retail/carton prices are independent and rules resolve exactly', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  try {
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const catalog = await createCatalog(pool, config.installationId, suffix);
    const customerContext = await createCustomerContext(pool, config.installationId, suffix);
    const channel = await pricingService.createSalesChannel(pool, {
      installationId: config.installationId,
      payload: { code: `VENUE-${suffix}`, name: 'Kênh quán' },
      createdBy: 'test:user',
    });
    assert.ok(channel.ok, channel.message);

    const baseList = await createList(pool, config.installationId, { code: `BASE-${suffix}`, name: 'Giá nền', listType: 'BASE', priority: 100 });
    const channelList = await createList(pool, config.installationId, { code: `CHANNEL-${suffix}`, name: 'Giá kênh', listType: 'CHANNEL', channelId: channel.channel.id, priority: 200, stackingMode: 'EXCLUSIVE' });
    const groupList = await createList(pool, config.installationId, { code: `GROUP-${suffix}`, name: 'Giá nhóm VIP', listType: 'CUSTOMER_GROUP', customerGroupId: customerContext.group.id, priority: 300, stackingMode: 'EXCLUSIVE' });
    const promoList = await createList(pool, config.installationId, { code: `PROMO-${suffix}`, name: 'Khuyến mãi', listType: 'PROMOTION', channelId: channel.channel.id, priority: 400, stackingMode: 'STACKABLE' });

    await createItem(pool, config.installationId, baseList.id, { variantId: catalog.base.id, adjustmentType: 'FIXED_PRICE', amountMinor: '10000' });
    await createItem(pool, config.installationId, baseList.id, { variantId: catalog.carton.id, adjustmentType: 'FIXED_PRICE', amountMinor: '95000' });
    await createItem(pool, config.installationId, channelList.id, { variantId: catalog.base.id, adjustmentType: 'FIXED_PRICE', amountMinor: '9000' });
    await createItem(pool, config.installationId, groupList.id, { variantId: catalog.base.id, adjustmentType: 'PERCENT_DISCOUNT', rateBps: 500 });
    await createItem(pool, config.installationId, promoList.id, { variantId: catalog.base.id, adjustmentType: 'AMOUNT_DISCOUNT', amountMinor: '1000' });

    const resolved = await pricingService.resolvePrice(pool, {
      installationId: config.installationId,
      payload: { variantId: catalog.base.id, quantity: '3', channelId: channel.channel.id, customerId: customerContext.customer.id },
    });
    assert.ok(resolved.ok, resolved.message);
    assert.equal(resolved.resolution.baseUnitPriceMinor, '10000');
    assert.equal(resolved.resolution.finalUnitPriceMinor, '8550');
    assert.equal(resolved.resolution.lineTotalMinor, '25650');
    assert.equal(resolved.resolution.steps.filter((step) => step.kind === 'RULE').length, 2);
    assert.ok(resolved.resolution.steps.some((step) => step.kind === 'SKIPPED' && step.priceListCode === channelList.code));

    const carton = await pricingService.resolvePrice(pool, {
      installationId: config.installationId,
      payload: { variantId: catalog.carton.id, quantity: '1' },
    });
    assert.ok(carton.ok, carton.message);
    assert.equal(carton.resolution.finalUnitPriceMinor, '95000');

    const manual = await pricingService.resolvePrice(pool, {
      installationId: config.installationId,
      payload: { variantId: catalog.base.id, quantity: '2', manualUnitPriceMinor: '7777', manualReason: 'Giá chốt được duyệt' },
    });
    assert.ok(manual.ok, manual.message);
    assert.equal(manual.resolution.finalUnitPriceMinor, '7777');
    assert.equal(manual.resolution.lineTotalMinor, '15554');
    assert.equal(manual.resolution.steps.at(-1).kind, 'MANUAL_OVERRIDE');

    const isolated = await pricingService.resolvePrice(pool, {
      installationId: `${config.installationId}-other`,
      payload: { variantId: catalog.base.id, quantity: '1' },
    });
    assert.equal(isolated.ok, false);
    assert.equal(isolated.code, 'VARIANT_NOT_FOUND');
  } finally {
    await closePool();
  }
});

test('Pricing import — source keys replay without duplicate rows', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  try {
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const catalog = await createCatalog(pool, config.installationId, suffix);
    const payload = {
      sourceBatchId: `batch-${suffix}`,
      channels: [{ code: `VENUE-${suffix}`, name: 'Kênh quán' }],
      priceLists: [
        { code: `BASE-${suffix}`, name: 'Giá nền', listType: 'BASE' },
        { code: `VENUE-PRICE-${suffix}`, name: 'Giá quán', listType: 'CHANNEL', channelCode: `VENUE-${suffix}` },
      ],
      items: [
        { sourceKey: `base:${catalog.base.sku}`, priceListCode: `BASE-${suffix}`, sku: catalog.base.sku, adjustmentType: 'FIXED_PRICE', amountMinor: '12000' },
        { sourceKey: `venue:${catalog.base.sku}`, priceListCode: `VENUE-PRICE-${suffix}`, sku: catalog.base.sku, adjustmentType: 'FIXED_PRICE', amountMinor: '11000' },
      ],
    };
    const first = await pricingService.importPricing(pool, { installationId: config.installationId, payload, createdBy: 'test:import' });
    assert.ok(first.ok, first.message);
    assert.equal(first.import.itemsCreated, 2);
    const replayPayload = structuredClone(payload);
    replayPayload.items[1].amountMinor = '10500';
    const second = await pricingService.importPricing(pool, { installationId: config.installationId, payload: replayPayload, createdBy: 'test:import' });
    assert.ok(second.ok, second.message);
    assert.equal(second.import.itemsCreated, 0);
    assert.equal(second.import.itemsUpdated, 2);
    const counts = await pool.query(
      `SELECT count(*)::int AS count FROM shared.price_list_items WHERE installation_id = $1`,
      [config.installationId],
    );
    assert.equal(counts.rows[0].count, 2);
  } finally {
    await closePool();
  }
});

test('Pricing API — authentication, idempotency, resolution and audit are enforced', async () => {
  const config = loadConfig(testEnv({ PORT: '3030' }));
  const pool = getPool(config);
  let server;
  try {
    server = await startServer({ config });
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const catalog = await createCatalog(pool, config.installationId, suffix);
    const baseUrl = 'http://127.0.0.1:3030';
    const headers = (key) => ({
      Authorization: `Bearer ${config.backendApiToken}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
    });

    const unauthorized = await fetch(`${baseUrl}/api/price-lists`);
    assert.equal(unauthorized.status, 401);

    const listRequest = () => fetch(`${baseUrl}/api/price-lists`, {
      method: 'POST',
      headers: headers(`list-${suffix}`),
      body: JSON.stringify({ code: `BASE-${suffix}`, name: 'Giá nền', listType: 'BASE' }),
    });
    const firstList = await listRequest();
    assert.equal(firstList.status, 201);
    const list = (await firstList.json()).data;
    const replayList = await listRequest();
    assert.equal(replayList.status, 201);
    assert.equal((await replayList.json()).data.id, list.id);

    const itemRequest = () => fetch(`${baseUrl}/api/price-lists/${list.id}/items`, {
      method: 'POST',
      headers: headers(`item-${suffix}`),
      body: JSON.stringify({ variantId: catalog.base.id, adjustmentType: 'FIXED_PRICE', amountMinor: '15000' }),
    });
    const firstItem = await itemRequest();
    assert.equal(firstItem.status, 201);
    const item = (await firstItem.json()).data;
    const replayItem = await itemRequest();
    assert.equal(replayItem.status, 201);
    assert.equal((await replayItem.json()).data.id, item.id);

    const resolution = await fetch(`${baseUrl}/api/pricing/resolve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.backendApiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ variantId: catalog.base.id, quantity: '2' }),
    });
    assert.equal(resolution.status, 200);
    const resolved = (await resolution.json()).data;
    assert.equal(resolved.finalUnitPriceMinor, '15000');
    assert.equal(resolved.lineTotalMinor, '30000');

    const audit = await pool.query(
      `SELECT resource_type, count(*)::int AS count
       FROM shared.core_audit_records
       WHERE installation_id = $1 AND resource_type IN ('price_list', 'price_list_item')
       GROUP BY resource_type`,
      [config.installationId],
    );
    assert.deepEqual(new Map(audit.rows.map((row) => [row.resource_type, row.count])), new Map([['price_list', 1], ['price_list_item', 1]]));
  } finally {
    if (server) await closeServer(server);
    await closePool();
  }
});

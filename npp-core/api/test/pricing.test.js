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

    const fallbackSuffix = randomUUID().slice(0, 8).toUpperCase();
    const fallbackCatalog = await createCatalog(pool, config.installationId, fallbackSuffix);
    await createItem(pool, config.installationId, channelList.id, {
      variantId: fallbackCatalog.base.id,
      adjustmentType: 'FIXED_PRICE',
      amountMinor: '320000',
    });
    await createItem(pool, config.installationId, groupList.id, {
      variantId: fallbackCatalog.base.id,
      adjustmentType: 'PERCENT_DISCOUNT',
      rateBps: 500,
    });
    const fallbackResolved = await pricingService.resolvePrice(pool, {
      installationId: config.installationId,
      payload: {
        variantId: fallbackCatalog.base.id,
        quantity: '1',
        channelId: channel.channel.id,
        customerId: customerContext.customer.id,
      },
    });
    assert.ok(fallbackResolved.ok, fallbackResolved.message);
    assert.equal(fallbackResolved.resolution.baseUnitPriceMinor, '320000');
    assert.equal(fallbackResolved.resolution.finalUnitPriceMinor, '304000');
    assert.equal(fallbackResolved.resolution.steps[0].kind, 'RULE');
    assert.equal(fallbackResolved.resolution.steps[0].reason, 'CHANNEL_FIXED_FALLBACK');
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


test('GT01: thiếu giá nền vẫn dùng giá cố định 800000 nếu khách thuộc nhóm và kênh hợp lệ', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  try {
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const catalog = await createCatalog(pool, config.installationId, suffix);
    const eligible = await createCustomerContext(pool, config.installationId, `A${suffix}`);
    const excluded = await createCustomerContext(pool, config.installationId, `B${suffix}`);
    const channel = await pricingService.createSalesChannel(pool, {
      installationId: config.installationId,
      payload: { code: `GT-${suffix}`, name: 'Kênh Đại Lý' },
      createdBy: 'test:user',
    });
    assert.ok(channel.ok, channel.message);
    const list = await createList(pool, config.installationId, {
      code: `GT01-${suffix}`, name: 'Bảng Giá Đại Lý',
      listType: 'CUSTOMER_GROUP',
      channelIds: [channel.channel.id],
      customerGroupIds: [eligible.group.id],
      priority: 300,
    });
    await createItem(pool, config.installationId, list.id, {
      variantId: catalog.carton.id,
      adjustmentType: 'FIXED_PRICE',
      amountMinor: '800000',
    });
    const lookup = (customerId, channelId) => pricingService.resolvePrice(pool, {
      installationId: config.installationId,
      payload: { variantId: catalog.carton.id, quantity: '1', customerId, channelId },
    });
    const accepted = await lookup(eligible.customer.id, channel.channel.id);
    assert.ok(accepted.ok, accepted.message);
    assert.equal(accepted.resolution.finalUnitPriceMinor, '800000');
    assert.equal(accepted.resolution.steps[0].priceListCode, list.code);

    const denied = await lookup(excluded.customer.id, channel.channel.id);
    assert.equal(denied.ok, false);
    assert.equal(denied.code, 'BASE_PRICE_NOT_FOUND');

    const noCustomer = await pricingService.resolvePrice(pool, {
      installationId: config.installationId,
      payload: { variantId: catalog.carton.id, quantity: '1', channelId: channel.channel.id },
    });
    assert.equal(noCustomer.ok, false);
    assert.equal(noCustomer.code, 'BASE_PRICE_NOT_FOUND');
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

test('Một bảng giá áp dụng được nhiều nhóm và kênh, nhưng không rò rỉ giá ra ngoài phạm vi', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  try {
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const catalog = await createCatalog(pool, config.installationId, suffix);
    const a = await createCustomerContext(pool, config.installationId, `A${suffix}`);
    const b = await createCustomerContext(pool, config.installationId, `B${suffix}`);
    const x = await createCustomerContext(pool, config.installationId, `X${suffix}`);
    const channels = [];
    for (const code of ['A', 'B', 'X']) {
      const result = await pricingService.createSalesChannel(pool, {
        installationId: config.installationId,
        payload: { code: `CH${code}-${suffix}`, name: `Kênh ${code}` },
        createdBy: 'test:user',
      });
      assert.equal(result.ok, true, result.message);
      channels.push(result.channel);
    }
    const base = await createList(pool, config.installationId, { code: `BASE-${suffix}`, name: 'Giá nền', listType: 'BASE' });
    await createItem(pool, config.installationId, base.id, { variantId: catalog.base.id, adjustmentType: 'FIXED_PRICE', amountMinor: '10000' });
    const list = await createList(pool, config.installationId, {
      code: `GT01-${suffix}`, name: 'Giá đại lý', listType: 'CUSTOMER_GROUP',
      channelIds: [channels[0].id, channels[1].id],
      customerGroupIds: [a.group.id, b.group.id], priority: 300,
    });
    assert.deepEqual(new Set(list.channel_ids), new Set([channels[0].id, channels[1].id]));
    assert.deepEqual(new Set(list.customer_group_ids), new Set([a.group.id, b.group.id]));
    await createItem(pool, config.installationId, list.id, { variantId: catalog.base.id, adjustmentType: 'FIXED_PRICE', amountMinor: '9000' });
    async function price(customerId, channelId) {
      const value = await pricingService.resolvePrice(pool, {
        installationId: config.installationId,
        payload: { variantId: catalog.base.id, quantity: '1', customerId, channelId },
      });
      assert.equal(value.ok, true, value.message);
      return value.resolution.finalUnitPriceMinor;
    }
    for (const customer of [a.customer, b.customer]) {
      assert.equal(await price(customer.id, channels[0].id), '9000');
      assert.equal(await price(customer.id, channels[1].id), '9000');
      assert.equal(await price(customer.id, channels[2].id), '10000');
    }
    assert.equal(await price(x.customer.id, channels[0].id), '10000');
    const updated = await pricingService.updatePriceList(pool, {
      installationId: config.installationId, id: list.id, updatedBy: 'test:user',
      payload: { channelIds: [channels[1].id], customerGroupIds: [b.group.id], expectedUpdatedAt: list.updated_at },
    });
    assert.equal(updated.ok, true, updated.message);
    assert.deepEqual(updated.priceList.channel_ids, [channels[1].id]);
    assert.deepEqual(updated.priceList.customer_group_ids, [b.group.id]);
    assert.equal(await price(a.customer.id, channels[1].id), '10000');
    assert.equal(await price(b.customer.id, channels[1].id), '9000');
    assert.equal(await price(b.customer.id, channels[0].id), '10000');
    await createItem(pool, config.installationId, base.id, {
      variantId: catalog.carton.id, adjustmentType: 'FIXED_PRICE', amountMinor: '10000',
    });
    const channelList = await createList(pool, config.installationId, {
      code: `MULTI-${suffix}`, name: 'Giá nhiều kênh', listType: 'CHANNEL',
      channelIds: [channels[0].id, channels[1].id],
    });
    assert.equal(channelList.channel_ids.length, 2);
    await createItem(pool, config.installationId, channelList.id, {
      variantId: catalog.carton.id, adjustmentType: 'FIXED_PRICE', amountMinor: '9500',
    });
    for (const channel of channels.slice(0, 2)) {
      const result = await pricingService.resolvePrice(pool, {
        installationId: config.installationId,
        payload: { variantId: catalog.carton.id, quantity: '1', channelId: channel.id, customerId: x.customer.id },
      });
      assert.equal(result.ok, true, result.message);
      assert.equal(result.resolution.finalUnitPriceMinor, '9500');
    }
    const outside = await pricingService.resolvePrice(pool, {
      installationId: config.installationId,
      payload: { variantId: catalog.carton.id, quantity: '1', channelId: channels[2].id, customerId: x.customer.id },
    });
    assert.equal(outside.ok, true, outside.message);
    assert.equal(outside.resolution.finalUnitPriceMinor, '10000');
  } finally {
    await closePool(pool);
  }
});

test('Đại lý: chặn giá trùng đúng thời điểm, thay thế có xác nhận, giữ lịch sử và mức số lượng khác', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  let client;
  try {
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const catalog = await createCatalog(pool, config.installationId, suffix);
    const list = await createList(pool, config.installationId, {
      code: `DAILY-${suffix}`, name: 'Giá đại lý', listType: 'CUSTOM',
    });
    const appliedAt = '2026-11-15T00:00:00.000Z';
    const old = await createItem(pool, config.installationId, list.id, {
      variantId: catalog.base.id, adjustmentType: 'FIXED_PRICE',
      amountMinor: '9000', effectiveFrom: '2026-01-01T00:00:00.000Z',
    });
    const sameStart = await createItem(pool, config.installationId, list.id, {
      variantId: catalog.base.id, adjustmentType: 'FIXED_PRICE',
      amountMinor: '8500', effectiveFrom: appliedAt,
    });
    const tier = await createItem(pool, config.installationId, list.id, {
      variantId: catalog.base.id, adjustmentType: 'FIXED_PRICE',
      amountMinor: '8000', minQuantity: '10', effectiveFrom: '2026-01-01T00:00:00.000Z',
    });
    const payload = {
      matchBySku: true, replaceFrom: true, applyAt: appliedAt,
      items: [{ priceListCode: list.code, sku: catalog.base.sku, adjustmentType: 'FIXED_PRICE',
        amountMinor: '8100', minQuantity: '0', sourceKind: 'ADMIN' }],
    };
    client = await pool.connect();
    await client.query('BEGIN');
    const blocked = await pricingService.importPricing(client, {
      installationId: config.installationId, payload, createdBy: 'test:price-adjust',
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.code, 'IMPORT_IDENTITY_CONFLICT');
    assert.equal(blocked.details.conflictingItems.length, 2);
    assert.deepEqual(new Set(blocked.details.conflictingItems.map((item) => item.id)), new Set([old.id, sameStart.id]));
    await client.query('ROLLBACK');

    // A stale or incomplete acknowledgement cannot alter any rule.
    await client.query('BEGIN');
    const stale = await pricingService.importPricing(client, {
      installationId: config.installationId,
      payload: { ...payload, items: [{ ...payload.items[0], resolveConflicts: [
        { id: old.id, expectedUpdatedAt: '2025-01-01T00:00:00.000Z' },
        { id: sameStart.id, expectedUpdatedAt: sameStart.updated_at },
      ] }] },
      createdBy: 'test:price-adjust',
    });
    assert.equal(stale.ok, false);
    assert.equal(stale.code, 'IMPORT_IDENTITY_CONFLICT');
    await client.query('ROLLBACK');

    await client.query('BEGIN');
    const confirmed = await pricingService.importPricing(client, {
      installationId: config.installationId,
      payload: { ...payload, items: [{ ...payload.items[0], resolveConflicts: [
        { id: old.id, expectedUpdatedAt: old.updated_at },
        { id: sameStart.id, expectedUpdatedAt: sameStart.updated_at },
      ] }] },
      createdBy: 'test:price-adjust',
    });
    assert.equal(confirmed.ok, true, confirmed.message);
    assert.equal(confirmed.import.itemsReplaced, 1);
    assert.equal(confirmed.import.itemsUpdated, 2);
    assert.equal(confirmed.import.itemsCreated, 1);
    await client.query('COMMIT');

    const records = (await pool.query(
      'SELECT id, is_active, effective_from, effective_to, amount_minor, min_quantity, source_metadata FROM shared.price_list_items WHERE installation_id = $1 AND price_list_id = $2 AND variant_id = $3 ORDER BY created_at, id',
      [config.installationId, list.id, catalog.base.id],
    )).rows;
    assert.equal(records.length, 4);
    assert.equal(new Date(records.find((item) => item.id === old.id).effective_to).toISOString(), appliedAt);
    assert.equal(records.find((item) => item.id === sameStart.id).is_active, false);
    assert.equal(records.find((item) => item.id === tier.id).is_active, true);
    assert.equal(records.find((item) => item.id === tier.id).amount_minor, '8000');
    const updated = records.find((item) => item.amount_minor === '8100');
    assert.equal(updated.is_active, true);
    assert.equal(new Date(updated.effective_from).toISOString(), appliedAt);
    assert.deepEqual(new Set(updated.source_metadata.replacesPriceItemIds), new Set([old.id, sameStart.id]));
    // Exact customer shape: an open-ended rule without a start and another
    // rule from 09/10/2026, both with the same quantity scope and active now.
    const legacyRule = await createItem(pool, config.installationId, list.id, {
      variantId: catalog.carton.id, adjustmentType: 'FIXED_PRICE',
      amountMinor: '565000', effectiveFrom: null, effectiveTo: null,
    });
    const octoberRule = await createItem(pool, config.installationId, list.id, {
      variantId: catalog.carton.id, adjustmentType: 'FIXED_PRICE',
      amountMinor: '525000', effectiveFrom: '2026-10-09T13:46:52.000Z', effectiveTo: null,
    });
    // Force non-zero milliseconds. PostgreSQL returns Date objects while
    // HTTP JSON confirmations arrive as strings. String(Date) discards ".789".
    const oldRevision = '2026-10-30T14:13:03.789Z';
    const octoberRevision = '2026-10-30T14:13:04.456Z';
    await pool.query(
      'UPDATE shared.price_list_items SET updated_at = CASE WHEN id = $2 THEN $4::timestamptz ELSE $5::timestamptz END WHERE installation_id = $1 AND id IN ($2, $3)',
      [config.installationId, legacyRule.id, octoberRule.id, oldRevision, octoberRevision],
    );
    legacyRule.updated_at = new Date(oldRevision);
    octoberRule.updated_at = new Date(octoberRevision);
    const immediateAt = '2026-10-30T14:33:00.000Z';
    const cartonPayload = {
      matchBySku: true, replaceFrom: true, applyAt: immediateAt,
      items: [{
        priceListCode: list.code, sku: catalog.carton.sku,
        adjustmentType: 'FIXED_PRICE', amountMinor: '530000', minQuantity: '0',
        sourceKind: 'ADMIN',
        resolveConflicts: [
          { id: legacyRule.id, expectedUpdatedAt: legacyRule.updated_at },
          { id: octoberRule.id, expectedUpdatedAt: octoberRule.updated_at },
        ],
      }],
    };
    await client.query('BEGIN');
    const octoberChange = await pricingService.importPricing(client, {
      installationId: config.installationId,
      payload: JSON.parse(JSON.stringify(cartonPayload)), createdBy: 'test:price-adjust',
    });
    assert.equal(octoberChange.ok, true, octoberChange.message);
    assert.equal(octoberChange.import.itemsUpdated, 2);
    assert.equal(octoberChange.import.itemsCreated, 1);
    await client.query('COMMIT');
    const cartonRows = (await pool.query(
      'SELECT id, is_active, effective_from, effective_to, amount_minor FROM shared.price_list_items WHERE installation_id = $1 AND price_list_id = $2 AND variant_id = $3',
      [config.installationId, list.id, catalog.carton.id],
    )).rows;
    assert.equal(cartonRows.length, 3);
    assert.equal(cartonRows.filter((item) => item.is_active && (!item.effective_to || new Date(item.effective_to).getTime() > Date.parse(immediateAt))).length, 1);
    for (const prior of [legacyRule, octoberRule]) {
      const closed = cartonRows.find((item) => item.id === prior.id);
      assert.equal(new Date(closed.effective_to).toISOString(), immediateAt);
    }
    assert.equal(cartonRows.find((item) => item.amount_minor === '530000').is_active, true);

  } finally {
    if (client) { await client.query('ROLLBACK').catch(() => {}); client.release(); }
    await closePool();
  }
});

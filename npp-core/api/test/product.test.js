import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { getPool, closePool } from '../src/db/pool.js';
import { startServer } from '../src/server.js';
import * as productService from '../src/services/product.js';

function testEnv(overrides = {}) {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3025',
    INSTALLATION_ID: `product-test-${randomUUID()}`,
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

async function createCategory(pool, installationId, suffix) {
  const result = await productService.createProductCategory(pool, {
    installationId,
    payload: { code: `cat-${suffix}`, name: `Loại ${suffix}`, isCatalogVisible: true },
    createdBy: 'test:user',
  });
  assert.ok(result.ok, result.message);
  return result.category;
}

async function createBrand(pool, installationId, suffix) {
  const result = await productService.createProductBrand(pool, {
    installationId,
    payload: { code: `brand-${suffix}`, name: `Nhãn ${suffix}`, isCatalogVisible: true },
    createdBy: 'test:user',
  });
  assert.ok(result.ok, result.message);
  return result.brand;
}

async function createProduct(pool, installationId, suffix, extras = {}) {
  const result = await productService.createProduct(pool, {
    installationId,
    payload: { code: `sp-${suffix}`, name: `Sản phẩm ${suffix}`, ...extras },
    createdBy: 'test:user',
  });
  assert.ok(result.ok, result.message);
  return result.product;
}

test('Product service — hierarchy, lifecycle and immutable identity are enforced', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  try {
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const root = await createCategory(pool, config.installationId, `ROOT-${suffix}`);
    const childResult = await productService.createProductCategory(pool, {
      installationId: config.installationId,
      payload: { code: `CHILD-${suffix}`, name: `Loại con ${suffix}`, parentCategoryId: root.id },
      createdBy: 'test:user',
    });
    assert.ok(childResult.ok, childResult.message);

    const cycle = await productService.updateProductCategory(pool, {
      id: root.id,
      installationId: config.installationId,
      payload: { parentCategoryId: childResult.category.id, expectedUpdatedAt: root.updated_at },
      updatedBy: 'test:user',
    });
    assert.equal(cycle.ok, false);
    assert.equal(cycle.code, 'INVALID_CATEGORY_HIERARCHY');

    const brand = await createBrand(pool, config.installationId, suffix);
    const rejectedOrderable = await productService.createProduct(pool, {
      installationId: config.installationId,
      payload: { code: `ORDER-${suffix}`, name: 'Không được bật sớm', isOrderable: true },
      createdBy: 'test:user',
    });
    assert.equal(rejectedOrderable.ok, false);
    assert.equal(rejectedOrderable.code, 'INVALID_ORDERABLE_STATUS');

    const product = await createProduct(pool, config.installationId, suffix, { categoryId: root.id, brandId: brand.id });
    const variantResult = await productService.createProductVariant(pool, {
      installationId: config.installationId,
      productId: product.id,
      payload: { sku: `SKU-${suffix}`, name: `SKU ${suffix}`, variantKind: 'BASE', isInventoryBase: true, isSellable: true },
      createdBy: 'test:user',
    });
    assert.ok(variantResult.ok, variantResult.message);

    const enabled = await productService.updateProduct(pool, {
      id: product.id,
      installationId: config.installationId,
      payload: { isOrderable: true, expectedUpdatedAt: product.updated_at },
      updatedBy: 'test:user',
    });
    assert.ok(enabled.ok, enabled.message);
    assert.equal(enabled.product.is_orderable, true);

    const stale = await productService.updateProduct(pool, {
      id: product.id,
      installationId: config.installationId,
      payload: { name: 'Ghi đè cũ', expectedUpdatedAt: product.updated_at },
      updatedBy: 'test:user',
    });
    assert.equal(stale.ok, false);
    assert.equal(stale.code, 'CONFLICT');

    const immutableCode = await productService.updateProduct(pool, {
      id: product.id,
      installationId: config.installationId,
      payload: { code: `OTHER-${suffix}`, expectedUpdatedAt: enabled.product.updated_at },
      updatedBy: 'test:user',
    });
    assert.equal(immutableCode.ok, false);
    assert.equal(immutableCode.code, 'IMMUTABLE_CODE');

    const removeLastSellable = await productService.updateProductVariant(pool, {
      productId: product.id,
      variantId: variantResult.variant.id,
      installationId: config.installationId,
      payload: { isSellable: false, expectedUpdatedAt: variantResult.variant.updated_at },
      updatedBy: 'test:user',
    });
    assert.equal(removeLastSellable.ok, false);
    assert.equal(removeLastSellable.code, 'INVALID_ORDERABLE_STATUS');

    const isolated = await productService.getProduct(pool, {
      installationId: `${config.installationId}-other`,
      id: product.id,
    });
    assert.equal(isolated.ok, false);
    assert.equal(isolated.code, 'NOT_FOUND');
  } finally {
    await closePool();
  }
});

test('Product import — normalized snapshot is atomic and re-import updates the same identities', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  try {
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const category = await createCategory(pool, config.installationId, suffix);
    const brand = await createBrand(pool, config.installationId, suffix);
    const payload = {
      products: [{
        code: `IMP-${suffix}`,
        name: `Sản phẩm import ${suffix}`,
        catalogName: `Catalog ${suffix}`,
        categoryId: category.id,
        brandId: brand.id,
        isCatalogVisible: true,
        isOrderable: true,
        isActive: true,
        variants: [{
          sku: `IMP-SKU-${suffix}`,
          name: `SKU import ${suffix}`,
          variantKind: 'BASE',
          isInventoryBase: true,
          isSellable: true,
          isCatalogVisible: true,
          isActive: true,
        }],
      }],
    };

    const first = await productService.importProducts(pool, { installationId: config.installationId, payload, createdBy: 'test:import' });
    assert.ok(first.ok, first.message);
    assert.deepEqual({ imported: first.imported, created: first.created, updated: first.updated }, { imported: 1, created: 1, updated: 0 });

    const product = await pool.query('SELECT id FROM shared.products WHERE installation_id = $1 AND code = $2', [config.installationId, payload.products[0].code]);
    const variant = await pool.query('SELECT id FROM shared.product_variants WHERE installation_id = $1 AND sku = $2', [config.installationId, payload.products[0].variants[0].sku]);
    const replayPayload = structuredClone(payload);
    replayPayload.products[0].id = product.rows[0].id;
    replayPayload.products[0].variants[0].id = variant.rows[0].id;
    replayPayload.products[0].name = `Sản phẩm import ${suffix} cập nhật`;

    const second = await productService.importProducts(pool, { installationId: config.installationId, payload: replayPayload, createdBy: 'test:import' });
    assert.ok(second.ok, second.message);
    assert.deepEqual({ imported: second.imported, created: second.created, updated: second.updated }, { imported: 1, created: 0, updated: 1 });

    const counts = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM shared.products WHERE installation_id = $1 AND code = $2) AS products,
         (SELECT count(*)::int FROM shared.product_variants WHERE installation_id = $1 AND sku = $3) AS variants`,
      [config.installationId, payload.products[0].code, payload.products[0].variants[0].sku],
    );
    assert.deepEqual(counts.rows[0], { products: 1, variants: 1 });
  } finally {
    await closePool();
  }
});

test('Product API — idempotent creates, duplicate race, import replay and audit', async () => {
  const config = loadConfig(testEnv({ PORT: '3026' }));
  const pool = getPool(config);
  let server;
  try {
    server = await startServer({ config });
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const headers = (key) => ({
      Authorization: `Bearer ${config.backendApiToken}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
    });

    const unauthorized = await fetch('http://127.0.0.1:3026/api/products');
    assert.equal(unauthorized.status, 401);

    const categoryRequest = () => fetch('http://127.0.0.1:3026/api/product-categories', {
      method: 'POST', headers: headers(`category-${suffix}`),
      body: JSON.stringify({ code: `CAT-${suffix}`, name: `Loại ${suffix}` }),
    });
    const categoryFirst = await categoryRequest();
    assert.equal(categoryFirst.status, 201);
    const categoryBody = await categoryFirst.json();
    const categoryReplay = await categoryRequest();
    assert.equal(categoryReplay.status, 201);
    assert.equal((await categoryReplay.json()).data.id, categoryBody.data.id);

    const brandResponse = await fetch('http://127.0.0.1:3026/api/product-brands', {
      method: 'POST', headers: headers(`brand-${suffix}`),
      body: JSON.stringify({ code: `BR-${suffix}`, name: `Nhãn ${suffix}` }),
    });
    assert.equal(brandResponse.status, 201);
    const brand = (await brandResponse.json()).data;

    const productPayload = { code: `SP-${suffix}`, name: `Sản phẩm ${suffix}`, categoryId: categoryBody.data.id, brandId: brand.id };
    const race = await Promise.all([
      fetch('http://127.0.0.1:3026/api/products', { method: 'POST', headers: headers(`product-a-${suffix}`), body: JSON.stringify(productPayload) }),
      fetch('http://127.0.0.1:3026/api/products', { method: 'POST', headers: headers(`product-b-${suffix}`), body: JSON.stringify(productPayload) }),
    ]);
    assert.deepEqual(race.map((response) => response.status).sort(), [201, 409]);
    const successResponse = race.find((response) => response.status === 201);
    const product = (await successResponse.json()).data;

    const variantResponse = await fetch(`http://127.0.0.1:3026/api/products/${product.id}/variants`, {
      method: 'POST', headers: headers(`variant-${suffix}`),
      body: JSON.stringify({ sku: `SKU-${suffix}`, name: `SKU ${suffix}`, variantKind: 'BASE', isInventoryBase: true, isSellable: true }),
    });
    assert.equal(variantResponse.status, 201);
    const variant = (await variantResponse.json()).data;

    const importPayload = { products: [{
      id: product.id,
      code: product.code,
      name: product.name,
      catalogName: null,
      categoryId: categoryBody.data.id,
      brandId: brand.id,
      isCatalogVisible: true,
      isOrderable: true,
      isActive: true,
      variants: [{ id: variant.id, sku: variant.sku, name: variant.name, variantKind: 'BASE', isInventoryBase: true, isSellable: true, isCatalogVisible: true, isActive: true }],
    }] };
    const importRequest = () => fetch('http://127.0.0.1:3026/api/products/import', {
      method: 'POST', headers: headers(`import-${suffix}`), body: JSON.stringify(importPayload),
    });
    const importFirst = await importRequest();
    assert.equal(importFirst.status, 201);
    const importReplay = await importRequest();
    assert.equal(importReplay.status, 201);

    const audit = await pool.query(
      `SELECT resource_type, count(*)::int AS count
       FROM shared.core_audit_records
       WHERE installation_id = $1
         AND resource_type IN ('product_category', 'product_brand', 'product', 'product_variant', 'product_import')
       GROUP BY resource_type`,
      [config.installationId],
    );
    const auditMap = new Map(audit.rows.map((row) => [row.resource_type, row.count]));
    assert.equal(auditMap.get('product_category'), 1);
    assert.equal(auditMap.get('product_brand'), 1);
    assert.equal(auditMap.get('product'), 1);
    assert.equal(auditMap.get('product_variant'), 1);
    assert.equal(auditMap.get('product_import'), 1);
  } finally {
    if (server) await closeServer(server);
    await closePool();
  }
});

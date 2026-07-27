import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { getPool, closePool } from '../src/db/pool.js';
import { startServer } from '../src/server.js';
import * as productService from '../src/services/product.js';
import * as productUnitService from '../src/services/product-unit.js';

function testEnv(overrides = {}) {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3027',
    INSTALLATION_ID: `product-unit-test-${randomUUID()}`,
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
  const productResult = await productService.createProduct(pool, {
    installationId,
    payload: { code: `PU-${suffix}`, name: `Sản phẩm quy đổi ${suffix}` },
    createdBy: 'test:user',
  });
  assert.ok(productResult.ok, productResult.message);
  const baseResult = await productService.createProductVariant(pool, {
    installationId,
    productId: productResult.product.id,
    payload: { sku: `PU-${suffix}`, name: `SKU lẻ ${suffix}`, variantKind: 'BASE', isInventoryBase: true, isSellable: true },
    createdBy: 'test:user',
  });
  assert.ok(baseResult.ok, baseResult.message);
  const cartonResult = await productService.createProductVariant(pool, {
    installationId,
    productId: productResult.product.id,
    payload: { sku: `PU-${suffix}T`, name: `SKU thùng ${suffix}`, variantKind: 'CARTON', isInventoryBase: false, isSellable: true },
    createdBy: 'test:user',
  });
  assert.ok(cartonResult.ok, cartonResult.message);
  return { product: productResult.product, base: baseResult.variant, carton: cartonResult.variant };
}

async function createUnit(pool, installationId, code, name, unitKind = 'COUNT', allowsFractional = false) {
  const result = await productUnitService.createUnit(pool, {
    installationId,
    payload: { code, name, unitKind, allowsFractional },
    createdBy: 'test:user',
  });
  assert.ok(result.ok, result.message);
  return result.unit;
}

test('Product units — exact conversion, base invariants, barcode uniqueness and isolation', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  try {
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const catalog = await createCatalog(pool, config.installationId, suffix);
    const each = await createUnit(pool, config.installationId, `EA-${suffix}`, 'Đơn vị lẻ');
    const carton = await createUnit(pool, config.installationId, `CT-${suffix}`, 'Thùng', 'PACKAGE');

    const baseAssigned = await productUnitService.assignVariantUnit(pool, {
      installationId: config.installationId,
      productId: catalog.product.id,
      variantId: catalog.base.id,
      payload: { unitId: each.id, conversionToBase: '1', expectedUpdatedAt: catalog.base.updated_at },
      updatedBy: 'test:user',
    });
    assert.ok(baseAssigned.ok, baseAssigned.message);

    const badBase = await productUnitService.assignVariantUnit(pool, {
      installationId: config.installationId,
      productId: catalog.product.id,
      variantId: catalog.base.id,
      payload: { unitId: each.id, conversionToBase: '2', expectedUpdatedAt: baseAssigned.variant.updated_at },
      updatedBy: 'test:user',
    });
    assert.equal(badBase.ok, false);
    assert.equal(badBase.code, 'INVALID_BASE_CONVERSION');

    const cartonAssigned = await productUnitService.assignVariantUnit(pool, {
      installationId: config.installationId,
      productId: catalog.product.id,
      variantId: catalog.carton.id,
      payload: { unitId: carton.id, conversionToBase: '12', expectedUpdatedAt: catalog.carton.updated_at },
      updatedBy: 'test:user',
    });
    assert.ok(cartonAssigned.ok, cartonAssigned.message);

    const normalized = await productUnitService.normalizeQuantity(pool, {
      installationId: config.installationId,
      productId: catalog.product.id,
      variantId: catalog.carton.id,
      payload: { quantity: '2' },
    });
    assert.ok(normalized.ok, normalized.message);
    assert.equal(normalized.normalization.baseQuantity, '24');
    assert.equal(productUnitService.multiplyDecimalStrings('0.1', '2.5').value, '0.25');

    const fractional = await productUnitService.normalizeQuantity(pool, {
      installationId: config.installationId,
      productId: catalog.product.id,
      variantId: catalog.carton.id,
      payload: { quantity: '1.5' },
    });
    assert.equal(fractional.ok, false);
    assert.equal(fractional.code, 'FRACTIONAL_QUANTITY_NOT_ALLOWED');

    const barcode = await productUnitService.createBarcode(pool, {
      installationId: config.installationId,
      productId: catalog.product.id,
      variantId: catalog.carton.id,
      payload: { barcode: `internal-${suffix}`, barcodeType: 'INTERNAL', isPrimary: true },
      createdBy: 'test:user',
    });
    assert.ok(barcode.ok, barcode.message);
    assert.equal(barcode.barcode.normalized_barcode, `INTERNAL-${suffix}`);

    const duplicate = await productUnitService.createBarcode(pool, {
      installationId: config.installationId,
      productId: catalog.product.id,
      variantId: catalog.base.id,
      payload: { barcode: `INTERNAL-${suffix}`, barcodeType: 'INTERNAL' },
      createdBy: 'test:user',
    });
    assert.equal(duplicate.ok, false);
    assert.equal(duplicate.code, 'DUPLICATE_BARCODE');

    const isolated = await productUnitService.getVariantUnit(pool, {
      installationId: `${config.installationId}-other`,
      productId: catalog.product.id,
      variantId: catalog.carton.id,
    });
    assert.equal(isolated.ok, false);
    assert.equal(isolated.code, 'NOT_FOUND');
  } finally {
    await closePool();
  }
});

test('Product unit import — reviewed rows are repeatable and blocking rows reject atomically', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  try {
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const catalog = await createCatalog(pool, config.installationId, suffix);
    const row = {
      productCode: catalog.product.code,
      sourceRow: 2,
      baseVariant: {
        sku: catalog.base.sku,
        unit: { code: `EA-${suffix}`, name: 'Đơn vị lẻ', unitKind: 'COUNT', allowsFractional: false, sourceLabel: 'LẺ' },
        conversionToBase: '1',
        isPurchasable: true,
      },
      convertedVariant: {
        sku: catalog.carton.sku,
        unit: { code: `CT-${suffix}`, name: 'Thùng', unitKind: 'PACKAGE', allowsFractional: false, sourceLabel: 'THÙNG' },
        conversionToBase: '24',
        isPurchasable: true,
        barcode: `BAR-${suffix}`,
        barcodeType: 'INTERNAL',
      },
      source: { workbook: 'reviewed.xlsx', sheet: 'CAP_NHAT_DS_SP' },
      warnings: [],
      blockingReview: [],
    };

    const first = await productUnitService.importProductUnits(pool, {
      installationId: config.installationId,
      payload: { rows: [row] },
      createdBy: 'test:import',
    });
    assert.ok(first.ok, first.message);
    assert.deepEqual(first.import, { rows: 1, unitsCreated: 2, variantsAssigned: 2, barcodesCreated: 1, barcodesReused: 0 });

    const second = await productUnitService.importProductUnits(pool, {
      installationId: config.installationId,
      payload: { rows: [row] },
      createdBy: 'test:import',
    });
    assert.ok(second.ok, second.message);
    assert.equal(second.import.unitsCreated, 0);
    assert.equal(second.import.barcodesCreated, 0);
    assert.equal(second.import.barcodesReused, 1);

    const blocked = await productUnitService.importProductUnits(pool, {
      installationId: config.installationId,
      payload: { rows: [{ ...row, blockingReview: ['BASE_UNIT_LABEL_IS_THUNG'] }] },
      createdBy: 'test:import',
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.code, 'IMPORT_REVIEW_REQUIRED');

    const counts = await pool.query(
      `SELECT
        (SELECT count(*)::int FROM shared.units_of_measure WHERE installation_id = $1) AS units,
        (SELECT count(*)::int FROM shared.product_barcodes WHERE installation_id = $1) AS barcodes`,
      [config.installationId],
    );
    assert.deepEqual(counts.rows[0], { units: 2, barcodes: 1 });
  } finally {
    await closePool();
  }
});

test('Product unit API — authentication, idempotency and audit are enforced', async () => {
  const config = loadConfig(testEnv({ PORT: '3028' }));
  const pool = getPool(config);
  let server;
  try {
    server = await startServer({ config });
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const catalog = await createCatalog(pool, config.installationId, suffix);
    const baseUrl = 'http://127.0.0.1:3028';
    const headers = (key) => ({
      Authorization: `Bearer ${config.backendApiToken}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
    });

    const unauthorized = await fetch(`${baseUrl}/api/units`);
    assert.equal(unauthorized.status, 401);

    const unitRequest = () => fetch(`${baseUrl}/api/units`, {
      method: 'POST',
      headers: headers(`unit-${suffix}`),
      body: JSON.stringify({ code: `EA-${suffix}`, name: 'Đơn vị lẻ', unitKind: 'COUNT', allowsFractional: false }),
    });
    const firstUnit = await unitRequest();
    assert.equal(firstUnit.status, 201);
    const unit = (await firstUnit.json()).data;
    const replayUnit = await unitRequest();
    assert.equal(replayUnit.status, 201);
    assert.equal((await replayUnit.json()).data.id, unit.id);

    const assignResponse = await fetch(`${baseUrl}/api/products/${catalog.product.id}/variants/${catalog.base.id}/unit`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${config.backendApiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ unitId: unit.id, conversionToBase: '1', expectedUpdatedAt: catalog.base.updated_at }),
    });
    assert.equal(assignResponse.status, 200);

    const barcodeRequest = () => fetch(`${baseUrl}/api/products/${catalog.product.id}/variants/${catalog.base.id}/barcodes`, {
      method: 'POST',
      headers: headers(`barcode-${suffix}`),
      body: JSON.stringify({ barcode: `BAR-${suffix}`, barcodeType: 'INTERNAL', isPrimary: true }),
    });
    const firstBarcode = await barcodeRequest();
    assert.equal(firstBarcode.status, 201);
    const barcode = (await firstBarcode.json()).data;
    const replayBarcode = await barcodeRequest();
    assert.equal(replayBarcode.status, 201);
    assert.equal((await replayBarcode.json()).data.id, barcode.id);

    const normalized = await fetch(`${baseUrl}/api/products/${catalog.product.id}/variants/${catalog.base.id}/normalize-quantity`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.backendApiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity: '3' }),
    });
    assert.equal(normalized.status, 200);
    assert.equal((await normalized.json()).data.baseQuantity, '3');

    const audit = await pool.query(
      `SELECT resource_type, count(*)::int AS count
       FROM shared.core_audit_records
       WHERE installation_id = $1 AND resource_type IN ('unit_of_measure', 'product_variant_unit', 'product_barcode')
       GROUP BY resource_type`,
      [config.installationId],
    );
    assert.deepEqual(
      new Map(audit.rows.map((row) => [row.resource_type, row.count])),
      new Map([['unit_of_measure', 1], ['product_variant_unit', 1], ['product_barcode', 1]]),
    );
  } finally {
    if (server) await closeServer(server);
    await closePool();
  }
});

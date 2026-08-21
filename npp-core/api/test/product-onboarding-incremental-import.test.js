import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { getPool, closePool } from '../src/db/pool.js';
import { PERMISSIONS } from '../src/access/permissions.js';
import { importProductOnboardingRows } from '../src/services/product-onboarding-file.js';

function testEnv() {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3098',
    INSTALLATION_ID: `product-incremental-${randomUUID()}`,
    DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://user:password@127.0.0.1:5432/npp_platform',
    DATABASE_SSL_MODE: 'disable',
    BACKEND_API_TOKEN: 'test-token-0123456789abcdef',
    CORE_BOOTSTRAP_ACTOR_ID: 'test:bootstrap',
    CORS_ORIGINS: 'http://127.0.0.1:3003',
  };
}

function requestContext(installationId, suffix) {
  return Object.freeze({
    installationId,
    actorId: 'test:product-import',
    employeeId: null,
    sourceApp: 'test',
    requestId: `product-incremental-${suffix}`,
    receivedAt: new Date().toISOString(),
    permissions: Object.freeze([PERMISSIONS.coreInventoryTrackingPolicyManage]),
    roles: Object.freeze(['bootstrap']),
    scopes: Object.freeze({ branchIds: Object.freeze([]), warehouseIds: Object.freeze([]), territoryIds: Object.freeze([]) }),
  });
}

async function createUnit(pool, installationId, code) {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO shared.units_of_measure (
       id, installation_id, code, name, symbol, unit_kind, allows_fractional, is_active,
       created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$3,'PACKAGE',false,true,'test:product-import','test:product-import')`,
    [id, installationId, code, `Đơn vị ${code}`],
  );
  return id;
}

function productFields(productCode, productName) {
  return {
    productCode,
    productName,
    catalogName: '',
    categoryCode: '',
    brandCode: '',
    description: '',
    notes: '',
    productIsCatalogVisible: true,
    productIsOrderable: true,
    productIsActive: true,
  };
}

function skuRow(fields, {
  sku,
  skuName,
  unitCode,
  conversionToBase,
  isInventoryBase,
}) {
  return {
    ...fields,
    sku,
    skuName,
    variantKind: 'BASE',
    isInventoryBase,
    isSellable: true,
    isCatalogVisible: true,
    isActive: true,
    unitCode,
    conversionToBase,
    lotTrackingMode: isInventoryBase ? 'NONE' : '',
    expiryTrackingMode: isInventoryBase ? 'NONE' : '',
    locationRequired: isInventoryBase ? false : '',
  };
}

test('product onboarding import supports sequential files, base changes and unit swaps without raw database conflicts', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  try {
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const productCode = `P${suffix}`;
    const skuA = `SKU-A-${suffix}`;
    const skuB = `SKU-B-${suffix}`;
    const unitA = `UA${suffix.slice(0, 6)}`;
    const unitB = `UB${suffix.slice(0, 6)}`;
    await createUnit(pool, config.installationId, unitA);
    await createUnit(pool, config.installationId, unitB);

    const fields = productFields(productCode, `Sản phẩm ${suffix}`);
    const firstRows = [
      skuRow(fields, { sku: skuA, skuName: 'SKU A', unitCode: unitA, conversionToBase: '1', isInventoryBase: true }),
      skuRow(fields, { sku: skuB, skuName: 'SKU B', unitCode: unitB, conversionToBase: '12', isInventoryBase: false }),
    ];
    const first = await importProductOnboardingRows(pool, {
      requestContext: requestContext(config.installationId, `${suffix}-first`),
      payload: { format: 'tabular', rows: firstRows },
    });
    assert.equal(first.ok, true, `${first.code ?? 'UNKNOWN'}: ${first.message ?? 'first import failed'}`);

    const partial = await importProductOnboardingRows(pool, {
      requestContext: requestContext(config.installationId, `${suffix}-partial`),
      payload: {
        format: 'tabular',
        rows: [skuRow(fields, { sku: skuB, skuName: 'SKU B cập nhật', unitCode: unitB, conversionToBase: '12', isInventoryBase: false })],
      },
    });
    assert.equal(partial.ok, true, `${partial.code ?? 'UNKNOWN'}: ${partial.message ?? 'partial import failed'}`);

    const switchBase = await importProductOnboardingRows(pool, {
      requestContext: requestContext(config.installationId, `${suffix}-switch-base`),
      payload: {
        format: 'tabular',
        rows: [skuRow(fields, { sku: skuB, skuName: 'SKU B tồn chuẩn', unitCode: unitB, conversionToBase: '1', isInventoryBase: true })],
      },
    });
    assert.equal(switchBase.ok, true, `${switchBase.code ?? 'UNKNOWN'}: ${switchBase.message ?? 'base switch failed'}`);

    const afterBaseSwitch = await pool.query(
      `SELECT sku, is_inventory_base
         FROM shared.product_variants
        WHERE installation_id = $1 AND sku = ANY($2::text[])
        ORDER BY sku`,
      [config.installationId, [skuA, skuB]],
    );
    assert.deepEqual(afterBaseSwitch.rows, [
      { sku: skuA, is_inventory_base: false },
      { sku: skuB, is_inventory_base: true },
    ]);

    const swapUnits = await importProductOnboardingRows(pool, {
      requestContext: requestContext(config.installationId, `${suffix}-swap-units`),
      payload: {
        format: 'tabular',
        rows: [
          skuRow(fields, { sku: skuA, skuName: 'SKU A', unitCode: unitB, conversionToBase: '2', isInventoryBase: false }),
          skuRow(fields, { sku: skuB, skuName: 'SKU B tồn chuẩn', unitCode: unitA, conversionToBase: '1', isInventoryBase: true }),
        ],
      },
    });
    assert.equal(swapUnits.ok, true, `${swapUnits.code ?? 'UNKNOWN'}: ${swapUnits.message ?? 'unit swap failed'}`);

    const invalidDuplicateUnit = await importProductOnboardingRows(pool, {
      requestContext: requestContext(config.installationId, `${suffix}-duplicate-unit`),
      payload: {
        format: 'tabular',
        rows: [skuRow(fields, { sku: skuA, skuName: 'SKU A', unitCode: unitA, conversionToBase: '2', isInventoryBase: false })],
      },
    });
    assert.equal(invalidDuplicateUnit.ok, false);
    assert.equal(invalidDuplicateUnit.statusCode, 409);
    assert.equal(invalidDuplicateUnit.code, 'PRODUCT_UNIT_CONFLICT');
    assert.match(invalidDuplicateUnit.message, /nhiều SKU hoạt động/);

    const persistedUnits = await pool.query(
      `SELECT pv.sku, u.code AS unit_code
         FROM shared.product_variants pv
         LEFT JOIN shared.units_of_measure u
           ON u.installation_id = pv.installation_id
          AND u.id = pv.unit_id
        WHERE pv.installation_id = $1 AND pv.sku = ANY($2::text[])
        ORDER BY pv.sku`,
      [config.installationId, [skuA, skuB]],
    );
    assert.deepEqual(persistedUnits.rows, [
      { sku: skuA, unit_code: unitB },
      { sku: skuB, unit_code: unitA },
    ]);
  } finally {
    await closePool();
  }
});

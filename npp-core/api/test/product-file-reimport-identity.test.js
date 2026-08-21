import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { getPool, closePool } from '../src/db/pool.js';
import { importProductRows } from '../src/services/file-operations.js';

function testEnv() {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3098',
    INSTALLATION_ID: `product-file-reimport-${randomUUID()}`,
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
    actorId: 'test:import',
    employeeId: null,
    sourceApp: 'test',
    requestId: `product-file-reimport-${suffix}`,
    receivedAt: new Date().toISOString(),
  });
}

test('Product file re-import updates existing product and SKU without internal IDs', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  try {
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const productCode = `FILE-${suffix}`;
    const sku = `FILE-SKU-${suffix}`;
    const row = {
      productCode,
      productName: `Sản phẩm ${suffix}`,
      catalogName: '',
      categoryCode: '',
      brandCode: '',
      description: '',
      notes: '',
      productIsCatalogVisible: true,
      productIsOrderable: false,
      productIsActive: true,
      sku,
      skuName: `SKU ${suffix}`,
      variantKind: 'BASE',
      isInventoryBase: true,
      isSellable: true,
      isCatalogVisible: true,
      isActive: true,
    };

    const first = await importProductRows(pool, {
      requestContext: requestContext(config.installationId, `${suffix}-first`),
      payload: { format: 'tabular', rows: [row] },
    });
    assert.ok(first.ok, first.message);

    const second = await importProductRows(pool, {
      requestContext: requestContext(config.installationId, `${suffix}-second`),
      payload: {
        format: 'tabular',
        rows: [{ ...row, productName: `Sản phẩm ${suffix} cập nhật`, skuName: `SKU ${suffix} cập nhật` }],
      },
    });
    assert.ok(second.ok, `${second.code ?? 'UNKNOWN'}: ${second.message ?? 'Import failed'}`);
    assert.deepEqual(second.import, { imported: 1, created: 0, updated: 1 });

    const persisted = await pool.query(
      `SELECT p.name AS product_name,
              count(DISTINCT p.id)::int AS product_count,
              count(DISTINCT pv.id)::int AS variant_count,
              max(pv.name) AS sku_name
         FROM shared.products p
         JOIN shared.product_variants pv
           ON pv.installation_id = p.installation_id
          AND pv.product_id = p.id
        WHERE p.installation_id = $1
          AND p.code = $2
          AND pv.sku = $3
        GROUP BY p.name`,
      [config.installationId, productCode, sku],
    );
    assert.deepEqual(persisted.rows[0], {
      product_name: `Sản phẩm ${suffix} cập nhật`,
      product_count: 1,
      variant_count: 1,
      sku_name: `SKU ${suffix} cập nhật`,
    });
  } finally {
    await closePool();
  }
});

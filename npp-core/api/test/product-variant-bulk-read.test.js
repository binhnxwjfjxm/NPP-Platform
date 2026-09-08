import test from 'node:test';
import assert from 'node:assert/strict';
import { listProductVariantsForProducts, productVariantBulkReadInternals } from '../src/services/product-variant-bulk-read.js';

const PRODUCT_A = '11111111-1111-4111-8111-111111111111';
const PRODUCT_B = '22222222-2222-4222-8222-222222222222';

test('bulk variant read uses one installation-scoped query and deduplicates product ids', async () => {
  const calls = [];
  const client = {
    async query(text, params) {
      calls.push({ text, params });
      return { rows: [{ id: 'variant-1', product_id: PRODUCT_A, sku: 'SKU-A' }] };
    },
  };

  const result = await listProductVariantsForProducts(client, {
    installationId: 'installation-test',
    payload: { productIds: [PRODUCT_A, PRODUCT_B, PRODUCT_A] },
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].params[0], 'installation-test');
  assert.deepEqual(calls[0].params[1], [PRODUCT_A, PRODUCT_B]);
  assert.match(calls[0].text, /pv\.installation_id = \$1/);
  assert.match(calls[0].text, /pv\.product_id = ANY\(\$2::uuid\[\]\)/);
  assert.deepEqual(result.variants, [{ id: 'variant-1', product_id: PRODUCT_A, sku: 'SKU-A' }]);
});

test('bulk variant read rejects invalid and oversized product batches before querying DB', async () => {
  let queries = 0;
  const client = { async query() { queries += 1; return { rows: [] }; } };

  const invalid = await listProductVariantsForProducts(client, {
    installationId: 'installation-test',
    payload: { productIds: ['not-a-uuid'] },
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.code, 'INVALID_PRODUCT_ID');

  const oversized = await listProductVariantsForProducts(client, {
    installationId: 'installation-test',
    payload: { productIds: Array.from({ length: productVariantBulkReadInternals.MAX_PRODUCT_IDS + 1 }, () => PRODUCT_A) },
  });
  assert.equal(oversized.ok, false);
  assert.equal(oversized.code, 'PRODUCT_VARIANT_QUERY_TOO_LARGE');
  assert.equal(queries, 0);
});

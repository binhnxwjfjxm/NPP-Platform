import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { listInventoryTrackingPolicyCandidates } from '../src/services/inventory-tracking-policy-candidates.js';

const routeWrapper = readFileSync(new URL('../src/routes/inventory.js', import.meta.url), 'utf8');
const candidateRepository = readFileSync(new URL('../src/db/repositories/inventory-tracking-policy-candidates.js', import.meta.url), 'utf8');

test('10.2 tracking policy candidates are installation-scoped canonical inventory base SKUs', async () => {
  const queries = [];
  const client = {
    async query(sql, params) {
      queries.push({ sql, params });
      return {
        rows: [{
          base_variant_id: '11111111-1111-4111-8111-111111111111',
          base_sku: 'SKU-001',
          base_variant_name: 'Base',
          base_variant_active: true,
          is_inventory_base: true,
          product_code: 'P-001',
          product_name: 'Sản phẩm 001',
          product_active: true,
          has_policy: false,
        }],
      };
    },
  };
  const result = await listInventoryTrackingPolicyCandidates(client, {
    requestContext: {
      installationId: 'installation-1',
      permissions: ['core.inventory.tracking-policy.read'],
    },
    search: 'SKU',
    limit: 100,
    offset: 0,
  });
  assert.equal(result.ok, true);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].base_sku, 'SKU-001');
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].params, ['installation-1', '%SKU%', 100, 0]);
  assert.match(queries[0].sql, /variant\.installation_id = \$1/);
  assert.match(queries[0].sql, /variant\.is_inventory_base = true/);
  assert.match(queries[0].sql, /LEFT JOIN inventory\.product_tracking_policies/);
});

test('10.2 candidate service stays deny-by-default', async () => {
  let queried = false;
  const result = await listInventoryTrackingPolicyCandidates({
    async query() { queried = true; return { rows: [] }; },
  }, {
    requestContext: { installationId: 'installation-1', permissions: [] },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PERMISSION_DENIED');
  assert.equal(queried, false);
});

test('10.2 candidate route is dispatched before legacy tracking-policy detail parsing', () => {
  assert.match(routeWrapper, /pathname === '\/api\/inventory\/tracking-policies\/candidates'/);
  assert.match(routeWrapper, /handleInventoryTrackingPolicyCandidateRoutes/);
  const dispatch = routeWrapper.indexOf("pathname === '/api/inventory/tracking-policies/candidates'");
  const fallback = routeWrapper.lastIndexOf('return handleInventoryCoreRoutes');
  assert.ok(dispatch >= 0 && fallback > dispatch);
  assert.match(candidateRepository, /ORDER BY variant\.is_active DESC, product\.is_active DESC, variant\.sku ASC/);
});

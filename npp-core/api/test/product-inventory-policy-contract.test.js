import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { productInventoryPolicyInternals } from '../src/services/product-inventory-policy.js';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('product inventory policy reuses canonical shared flag and guards transitions', async () => {
  const [migration, service, route] = await Promise.all([
    read('../../database/migrations/shared/093_product_inventory_management_policy.sql'),
    read('src/services/product-inventory-policy.js'),
    read('src/routes/product-inventory-policy.js'),
  ]);
  assert.match(migration, /is_inventory_managed/);
  assert.match(migration, /DEFAULT true/);
  assert.match(service, /PRODUCT_INVENTORY_POLICY_HAS_OPEN_OPERATIONS/);
  assert.match(service, /ACTIVE_INVENTORY_BASE_SKU_REQUIRED/);
  assert.match(route, /executeRequestWithIdempotency/);
  assert.match(route, /product_inventory_policy/);
});

test('standard purchasing blocks products marked Không qua kho', async () => {
  const repository = await read('src/db/repositories/purchase-order.js');
  assert.match(repository, /is_inventory_managed/);
  assert.match(repository, /is_purchasable: row\.is_purchasable === true && managedByProduct\.get\(row\.product_id\) === true/);
});

test('zero detection treats decimal zero as empty inventory and non-zero as blocker', () => {
  assert.equal(productInventoryPolicyInternals.hasNonZeroDecimal('0'), false);
  assert.equal(productInventoryPolicyInternals.hasNonZeroDecimal('0.000000000000'), false);
  assert.equal(productInventoryPolicyInternals.hasNonZeroDecimal('1.000000000000'), true);
});

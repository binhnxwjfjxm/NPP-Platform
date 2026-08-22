import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { productWithInventoryPolicyInternals } from '../src/services/product-with-inventory-policy.js';

const serviceUrl = new URL('../src/services/product-with-inventory-policy.js', import.meta.url);
const routeUrl = new URL('../src/routes/products-core.js', import.meta.url);

test('product CRUD inventory policy input is optional, boolean-only and defaults to managed', () => {
  const { requestedPolicy, mergeProduct } = productWithInventoryPolicyInternals;
  assert.deepEqual(requestedPolicy({}, true), { ok: true, present: false, value: true });
  assert.deepEqual(requestedPolicy({ isInventoryManaged: false }, true), { ok: true, present: true, value: false });
  assert.equal(requestedPolicy({ isInventoryManaged: 'false' }, true).code, 'INVALID_INVENTORY_POLICY');
  assert.equal(mergeProduct({ id: 'p1', updated_at: 'old' }, false, 'new').is_inventory_managed, false);
  assert.equal(mergeProduct({ id: 'p1', updated_at: 'old' }, true, 'new').updated_at, 'new');
});

test('standard Product CRUD owns the inventory policy while import stays on the existing import service', async () => {
  const [service, route] = await Promise.all([
    readFile(serviceUrl, 'utf8'),
    readFile(routeUrl, 'utf8'),
  ]);

  assert.match(route, /productCrudService\.listProducts/);
  assert.match(route, /productCrudService\.createProduct/);
  assert.match(route, /productCrudService\.getProduct/);
  assert.match(route, /productCrudService\.updateProduct/);
  assert.match(route, /productService\.importProducts/);

  assert.match(service, /productService\.createProduct/);
  assert.match(service, /productService\.updateProduct/);
  assert.match(service, /inventoryPolicyService\.updateProductInventoryPolicy/);
  assert.match(service, /expectedUpdatedAt: base\.product\.updated_at/);
  assert.match(service, /if \(!policy\.ok\) return policy/);
});
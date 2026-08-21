import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Danh mục sản phẩm exposes office-language Kho policy control', async () => {
  const [page, panel] = await Promise.all([
    read('app/products/page.tsx'),
    read('app/products/product-inventory-policy-panel.tsx'),
  ]);
  assert.match(page, /ProductInventoryPolicyPanel/);
  assert.match(panel, /Qua kho \/ Không qua kho/);
  assert.match(panel, /Không qua kho/);
  assert.match(panel, /Hàng mua dùm/);
});

test('Kho policy mutations use the shared canonical idempotency generator and reuse the operation key', async () => {
  const panel = await read('app/products/product-inventory-policy-panel.tsx');
  assert.match(panel, /createIdempotencyKey\('product-inventory-policy'\)/);
  assert.match(panel, /keys\.current\.get\(slot\)/);
  assert.match(panel, /Idempotency-Key/);
});

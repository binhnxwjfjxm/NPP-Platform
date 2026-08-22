import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Danh mục sản phẩm exposes Quản lý tồn kho inside the standard product form', async () => {
  const [page, workspace, types] = await Promise.all([
    read('app/products/page.tsx'),
    read('app/products/product-workspace.tsx'),
    read('lib/product-types.ts'),
  ]);
  assert.doesNotMatch(page, /ProductInventoryPolicyPanel/);
  assert.match(workspace, /product-inventory-managed-input/);
  assert.match(workspace, /Quản lý tồn kho/);
  assert.match(workspace, /isInventoryManaged: true/);
  assert.match(workspace, /isInventoryManaged: product\.is_inventory_managed !== false/);
  assert.match(types, /is_inventory_managed\?: boolean/);
  assert.match(types, /isInventoryManaged: boolean/);
});

test('standard product Save sends the inventory-management field with the rest of the product form', async () => {
  const workspace = await read('app/products/product-workspace.tsx');
  assert.match(workspace, /const body = \{\s*\.\.\.productForm,/);
  assert.match(workspace, /checked=\{productForm\.isInventoryManaged\}/);
  assert.match(workspace, /setProductForm\(\{ \.\.\.productForm, isInventoryManaged: event\.target\.checked \}\)/);
});
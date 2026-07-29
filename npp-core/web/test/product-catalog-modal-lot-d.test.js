import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path) {
  return readFile(new URL(path, import.meta.url), 'utf8');
}

test('product catalog uses the shared React modal for every editor', async () => {
  const workspace = await source('../app/products/product-workspace.tsx');
  assert.match(workspace, /import Modal from '\.\.\/components\/modal'/);
  assert.match(workspace, /open=\{showProductForm\}[\s\S]*testId="product-form"/);
  assert.match(workspace, /open=\{showVariantForm\}[\s\S]*testId="variant-form"/);
  assert.match(workspace, /open=\{showCategoryForm\}[\s\S]*testId="category-form"/);
  assert.match(workspace, /open=\{showBrandForm\}[\s\S]*testId="brand-form"/);
  assert.doesNotMatch(workspace, /function CatalogModal|modalBackdrop|document\.querySelector|MutationObserver/);
});

test('catalog modal dismissal clears form-scoped errors and respects busy saves', async () => {
  const workspace = await source('../app/products/product-workspace.tsx');
  assert.match(workspace, /function closeEditors\(\) \{[\s\S]*if \(busy\) return;[\s\S]*setError\(null\);[\s\S]*\}/);
  assert.match(workspace, /error && !editorOpen/);
  assert.match(workspace, /disabled=\{busy \|\| !productForm\.code\.trim\(\) \|\| !productForm\.name\.trim\(\)\}/);
  assert.match(workspace, /disabled=\{busy \|\| !variantForm\.sku\.trim\(\) \|\| !variantForm\.name\.trim\(\)\}/);
});

test('catalog editors cannot open while another operation is busy', async () => {
  const workspace = await source('../app/products/product-workspace.tsx');
  for (const name of [
    'openProductCreate',
    'openProductEdit',
    'openCategoryCreate',
    'openCategoryEdit',
    'openBrandCreate',
    'openBrandEdit',
    'openVariantCreate',
    'openVariantEdit',
  ]) {
    assert.match(workspace, new RegExp(`(?:async )?function ${name}\\([^)]*\\) \\{\\s*if \\(busy\\) return;`));
  }
});

test('product editing fails closed when the SKU list cannot be loaded', async () => {
  const workspace = await source('../app/products/product-workspace.tsx');
  assert.match(workspace, /async function loadVariants\(product: Product\): Promise<boolean>/);
  assert.match(workspace, /setSelectedProduct\(null\);[\s\S]*setVariants\(\[\]\);[\s\S]*return false;/);
  assert.match(workspace, /const loaded = await loadVariants\(product\);[\s\S]*if \(!loaded\) return;/);
  assert.doesNotMatch(workspace, /await loadVariants\(product\);[\s\S]*setError\(null\);[\s\S]*setShowProductForm\(true\)/);
});

test('shared modal keeps focus behavior stable while parent callbacks change', async () => {
  const modal = await source('../app/components/modal.tsx');
  assert.match(modal, /const onCloseRef = useRef\(onClose\)/);
  assert.match(modal, /onCloseRef\.current = onClose/);
  assert.match(modal, /onCloseRef\.current\(\)/);
  assert.match(modal, /\}, \[open\]\);/);
});

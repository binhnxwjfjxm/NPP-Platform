import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('product page renders one integrated workspace without detached sidebar compensation', async () => {
  const [page, workspace, unitWorkspace, styles] = await Promise.all([
    source('../app/products/page.tsx'),
    source('../app/products/product-workspace.tsx'),
    source('../app/products/product-unit-workspace.tsx'),
    source('../app/products/products.module.css'),
  ]);

  assert.match(page, /<ProductWorkspace/);
  assert.match(page, /initialUnits=\{initialUnits\}/);
  assert.doesNotMatch(page, /detachedUnitWorkspace|<ProductUnitWorkspace/);

  assert.match(workspace, /type Tab = 'products' \| 'updates' \| 'categories' \| 'brands' \| 'units'/);
  assert.match(workspace, /data-testid="product-updates-tab"/);
  assert.match(workspace, /data-testid="units-tab"/);
  assert.match(workspace, /data-testid=\{`manage-units-\$\{variant\.sku\}`\}/);
  assert.match(workspace, /<ProductUnitWorkspace initialProducts=\{products\} initialUnits=\{initialUnits\} selection=\{unitSelection\}/);
  assert.match(workspace, /data-testid="add-product-button"/);
  assert.match(workspace, /data-testid="add-variant-button"/);

  assert.match(unitWorkspace, /data-testid="unit-catalog-tab"/);
  assert.match(unitWorkspace, /data-testid="sku-conversion-tab"/);
  assert.match(unitWorkspace, /data-testid="selected-sku-summary"/);
  assert.match(unitWorkspace, /<UnitCatalogPanel/);
  assert.match(unitWorkspace, /<VariantUnitPanel/);

  assert.match(styles, /\.skuWorkspaceGrid/);
  assert.match(styles, /\.unitSelectorBar/);
  assert.match(styles, /\.subTabActive/);
  assert.doesNotMatch(styles, /detachedUnitWorkspace|margin-left:\s*280px|width:\s*calc\(100% - 280px\)/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workspacePath = new URL('../app/products/product-workspace.tsx', import.meta.url);
const updaterPath = new URL('../app/products/product-bulk-update-workspace.tsx', import.meta.url);
const gatewayPath = new URL('../lib/product-gateway.ts', import.meta.url);

test('Issue #806 UI — Cập nhật SP là tab riêng và SKU mở modal', async () => {
  const source = await readFile(workspacePath, 'utf8');
  assert.match(source, /data-testid="product-updates-tab">Cập nhật SP<\/button>/);
  assert.match(source, /<ProductBulkUpdateWorkspace \/>/);
  assert.match(source, /open=\{showVariantManager\}[\s\S]*testId="variant-panel"/);
  assert.match(source, /openVariantManager\(product\)/);
  assert.doesNotMatch(source, /selectedProduct \? <div className=\{styles\.variantPanel\}/);
});

test('Issue #806 UI — updater dùng PATCH riêng, không gọi import full-snapshot và reuse operation key', async () => {
  const updater = await readFile(updaterPath, 'utf8');
  const gateway = await readFile(gatewayPath, 'utf8');
  assert.match(updater, /fetch\('\/api\/products\/variants\/bulk-update'/);
  assert.doesNotMatch(updater, /\/api\/products\/import/);
  assert.match(updater, /'Idempotency-Key': operationKey/);
  assert.match(updater, /setOperationKey\(envelope\.data\.operationKey/);
  assert.match(gateway, /requiredMutationKey\(key, 'product-variants-bulk-update'\)/);
});

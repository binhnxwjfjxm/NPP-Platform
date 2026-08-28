import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workspacePath = new URL('../app/products/product-workspace.tsx', import.meta.url);
const updaterPath = new URL('../app/products/product-bulk-update-workspace.tsx', import.meta.url);
const gatewayPath = new URL('../lib/product-gateway.ts', import.meta.url);
const identifyRoutePath = new URL('../app/api/products/variants/identify/route.ts', import.meta.url);
const coreRoutePath = new URL('../../api/src/routes/products-core.js', import.meta.url);

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

test('Cập nhật SP — chọn tệp là hiện dữ liệu và nhận diện SKU trước khi xem thay đổi', async () => {
  const updater = await readFile(updaterPath, 'utf8');
  const gateway = await readFile(gatewayPath, 'utf8');
  const identifyRoute = await readFile(identifyRoutePath, 'utf8');
  const coreRoute = await readFile(coreRoutePath, 'utf8');

  assert.match(updater, /fetch\('\/api\/products\/variants\/identify'/);
  assert.match(updater, /method: 'POST'/);
  assert.match(updater, /Bỏ dòng đầu nếu là tiêu đề/);
  assert.doesNotMatch(updater, />Dòng đầu là tiêu đề</);
  assert.match(updater, /data-testid="product-update-source-preview"/);
  assert.match(updater, /Cột 1 · SKU/);
  assert.match(updater, /Khóa truy vấn/);
  assert.match(updater, /Tên sản phẩm/);
  assert.match(updater, /Tự nhận diện từ SKU/);
  assert.match(updater, /const index = offset \+ 1;[\s\S]*aria-label=\{`Thuộc tính cột \$\{index \+ 1\}`\}/);

  const sourcePreview = updater.indexOf('data-testid="product-update-source-preview"');
  const previewButton = updater.indexOf('data-testid="product-update-preview"');
  const changePreview = updater.indexOf('data-testid="product-update-change-preview"');
  assert.ok(sourcePreview >= 0 && previewButton > sourcePreview, 'bảng dữ liệu phải xuất hiện trước nút Xem trước thay đổi');
  assert.ok(changePreview > previewButton, 'bảng cũ → mới chỉ xuất hiện ở bước sau');

  assert.match(gateway, /method: 'POST', path: '\/api\/products\/variants\/identify'/);
  assert.match(identifyRoute, /identifyProductVariants/);
  assert.match(coreRoute, /pathname === '\/api\/products\/variants\/identify' && method === 'POST'/);
  assert.match(coreRoute, /isReadOperation = method === 'GET' \|\| \(method === 'POST' && pathname === '\/api\/products\/variants\/identify'\)/);
});

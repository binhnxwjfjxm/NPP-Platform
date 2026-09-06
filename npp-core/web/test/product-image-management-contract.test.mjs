import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path) {
  return readFile(new URL(path, import.meta.url), 'utf8');
}

test('Công Ty quản lý ảnh sản phẩm dùng chung theo mã sản phẩm', async () => {
  const [workspace, quickSetup, imageControl, imageUtil, proxyRoute, apiRoute, storage] = await Promise.all([
    source('../app/products/product-workspace.tsx'),
    source('../app/products/product-quick-setup-workspace.tsx'),
    source('../app/products/product-image-control.tsx'),
    source('../lib/product-images.ts'),
    source('../app/api/products/images/route.ts'),
    source('../../api/src/routes/product-images.js'),
    source('../../api/src/storage/product-images.js'),
  ]);

  assert.match(workspace, /ProductImageStatusIcon/);
  assert.match(workspace, /requestJson<ProductImageIndex>\('\/api\/products\/images'\)/);
  assert.match(workspace, /imageCodes=\{imageCodes\}/);
  assert.match(quickSetup, /ProductImageControl/);
  assert.doesNotMatch(quickSetup, /primary_image_url|image_url/);

  assert.match(imageControl, /createIdempotencyKey/);
  assert.match(imageControl, /pendingKeys\.current\.get\(fingerprint\)/);
  assert.match(imageControl, /product-image-commit/);
  assert.match(imageControl, /product-image-delete/);

  assert.match(imageUtil, /PRODUCT_IMAGE_MAX_EDGE = 1600/);
  assert.match(imageUtil, /PRODUCT_IMAGE_WEBP_QUALITY = 0\.82/);
  assert.match(imageUtil, /'image\/webp'/);

  assert.match(proxyRoute, /\/api\/products\/images/);
  assert.match(apiRoute, /coreProductRead/);
  assert.match(apiRoute, /coreProductWrite/);
  assert.match(apiRoute, /executeRequestWithIdempotency/);

  assert.match(storage, /SHARED_PRODUCT_IMAGE_PREFIX = 'app-customer\/products\/'/);
  assert.match(storage, /sharedProductImageKey\(productCode\)/);
  assert.match(storage, /ListObjectsV2Command/);
  assert.match(storage, /PutObjectCommand/);
});

test('trạng thái ảnh không biến lỗi kho ảnh thành thiếu ảnh giả', async () => {
  const [workspace, statusIcon] = await Promise.all([
    source('../app/products/product-workspace.tsx'),
    source('../app/products/product-image-status-icon.tsx'),
  ]);

  assert.match(workspace, /const \[imageCodes, setImageCodes\] = useState<Set<string> \| null>\(null\)/);
  assert.match(workspace, /setImageCodes\(null\)/);
  assert.match(statusIcon, /'Chưa kiểm tra ảnh'/);
  assert.match(statusIcon, /'Có ảnh'/);
  assert.match(statusIcon, /'Thiếu ảnh'/);
  assert.match(statusIcon, /data-image-status/);
});

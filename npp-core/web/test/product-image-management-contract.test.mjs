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
  assert.match(imageControl, /product-image-upload/);
  assert.match(imageControl, /product-image-delete/);
  assert.match(imageControl, /method: 'PUT'/);
  assert.doesNotMatch(imageControl, /prepared\.uploadUrl|fetch\(prepared\.uploadUrl|ProductImagePrepare/);

  assert.match(imageUtil, /PRODUCT_IMAGE_MAX_EDGE = 1600/);
  assert.match(imageUtil, /PRODUCT_IMAGE_WEBP_QUALITY = 0\.82/);
  assert.match(imageUtil, /'image\/webp'/);

  assert.match(proxyRoute, /export async function PUT/);
  assert.match(proxyRoute, /request\.arrayBuffer\(\)/);
  assert.match(proxyRoute, /\/image\/upload/);
  assert.match(apiRoute, /coreProductRead/);
  assert.match(apiRoute, /coreProductWrite/);
  assert.match(apiRoute, /executeRequestWithIdempotency/);
  assert.match(apiRoute, /handleUpload/);
  assert.match(apiRoute, /contentSha256/);

  assert.match(storage, /SHARED_PRODUCT_IMAGE_PREFIX = 'app-customer\/products\/'/);
  assert.match(storage, /sharedProductImageKey\(productCode\)/);
  assert.match(storage, /ListObjectsV2Command/);
  assert.match(storage, /async function putImage/);
  assert.match(storage, /Body: bytes/);
});

test('ảnh vẫn chọn được khi trạng thái kho ảnh tạm thời chưa tải xong', async () => {
  const imageControl = await source('../app/products/product-image-control.tsx');
  assert.doesNotMatch(imageControl, /disabled=\{busy \|\| !imageStatusKnown\}/);
  assert.match(imageControl, /disabled=\{busy\}/);
  assert.match(imageControl, /!imageStatusKnown \? 'Chọn ảnh'/);
  assert.match(imageControl, /'Chưa kiểm tra ảnh'/);
});

test('trạng thái ảnh phân biệt rõ có ảnh, thiếu ảnh và chưa kiểm tra', async () => {
  const [workspace, statusIcon] = await Promise.all([
    source('../app/products/product-workspace.tsx'),
    source('../app/products/product-image-status-icon.tsx'),
  ]);

  assert.match(workspace, /const \[imageCodes, setImageCodes\] = useState<Set<string> \| null>\(null\)/);
  assert.match(workspace, /setImageCodes\(null\)/);
  assert.match(statusIcon, /'Chưa kiểm tra ảnh'/);
  assert.match(statusIcon, /'Có ảnh'/);
  assert.match(statusIcon, /'Thiếu ảnh'/);
  assert.match(statusIcon, /state === 'present'/);
  assert.match(statusIcon, /state === 'missing'/);
  assert.match(statusIcon, /data-image-status=\{state\}/);
});

test('tìm sản phẩm trong Thiết lập nhanh có vùng cuộn riêng trên desktop', async () => {
  const css = await source('../app/products/product-quick-setup.module.css');
  assert.match(css, /\.sidebar\s*\{[\s\S]*grid-template-rows:\s*auto minmax\(0, 1fr\);[\s\S]*min-height:\s*0;/);
  assert.match(css, /\.productList\s*\{[\s\S]*min-height:\s*0;[\s\S]*overflow-y:\s*auto;[\s\S]*overflow-x:\s*hidden;[\s\S]*overscroll-behavior:\s*contain;/);
});

test('production R2 gate tái sử dụng đúng kho ảnh đang chạy và không cần CORS ghi trực tiếp từ browser', async () => {
  const [workflow, configScript] = await Promise.all([
    source('../../../.github/workflows/company-product-image-r2-config-manual.yml'),
    source('../../api/scripts/production-product-image-r2-config.js'),
  ]);

  assert.match(workflow, /github\.event\.issue\.number == 5/);
  assert.match(workflow, /github\.event\.comment\.body == '\/configure-company-product-images-r2'/);
  assert.match(workflow, /R2_SOURCE_APP: hung-phat-mcp/);
  assert.match(workflow, /R2_TARGET_APP: hung-phat/);
  assert.match(configScript, /R2_BUCKET_NAME/);
  assert.match(configScript, /CLOUDFLARE_R2_PUBLIC_URL/);
  assert.match(configScript, /R2_BUCKET: r2\.bucket/);
  assert.match(configScript, /R2_PUBLIC_BASE_URL: r2\.publicBaseUrl/);
  assert.match(configScript, /COMPANY_PRODUCT_IMAGE_INDEX_COUNT/);
  assert.doesNotMatch(configScript, /PutBucketCorsCommand|GetBucketCorsCommand|CLOUDFLARE_ACCOUNT_API_TOKEN|DATABASE_URL/);
});

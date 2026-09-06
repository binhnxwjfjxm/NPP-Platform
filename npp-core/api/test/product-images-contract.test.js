import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

async function source(path) {
  return readFile(new URL(path, import.meta.url), 'utf8');
}

function assertSyntax(path) {
  const absolute = fileURLToPath(new URL(path, import.meta.url));
  const result = spawnSync(process.execPath, ['--check', absolute], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout || `syntax check failed: ${path}`);
}

test('product image upload stays server-side and uses canonical idempotency payload', async () => {
  const [route, storage] = await Promise.all([
    source('../src/routes/product-images.js'),
    source('../src/storage/product-images.js'),
  ]);

  assert.match(route, /handleUpload/);
  assert.match(route, /contentSha256/);
  assert.match(route, /executeIdempotentImageMutation/);
  assert.match(route, /match\(\/\^\\\/api\\\/products/);
  assert.match(storage, /async function putImage/);
  assert.match(storage, /PutObjectCommand/);
  assert.match(storage, /Body: bytes/);
  assert.match(storage, /SHARED_PRODUCT_IMAGE_PREFIX = 'app-customer\/products\/'/);
});

test('production product image R2 config script is syntax-safe and does not contain provider secrets', async () => {
  const script = await source('../scripts/production-product-image-r2-config.js');
  assert.match(script, /SOURCE_APP = 'hung-phat-mcp'/);
  assert.match(script, /TARGET_APP = 'hung-phat'/);
  assert.match(script, /R2_ENABLED: 'true'/);
  assert.match(script, /waitForProductImageIndex/);
  assert.doesNotMatch(script, /CLOUDFLARE_ACCOUNT_API_TOKEN|DATABASE_URL|PutBucketCorsCommand/);

  for (const path of [
    '../src/routes/product-images.js',
    '../src/storage/product-images.js',
    '../scripts/production-product-image-r2-config.js',
  ]) assertSyntax(path);
});

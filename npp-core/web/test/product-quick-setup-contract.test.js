import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path) {
  return readFile(new URL(path, import.meta.url), 'utf8');
}

test('product workspace exposes quick setup as a first-class tab on the existing products route', async () => {
  const workspace = await source('../app/products/product-workspace.tsx');
  assert.match(workspace, /type Tab = 'products' \| 'quick' \| 'updates' \| 'categories' \| 'brands' \| 'units'/);
  assert.match(workspace, /data-testid="product-quick-setup-tab">Thiết lập nhanh<\/button>/);
  assert.match(workspace, /<ProductQuickSetupWorkspace[\s\S]*products=\{products\}[\s\S]*categories=\{categories\}[\s\S]*brands=\{brands\}[\s\S]*units=\{initialUnits\}/);
});

test('quick setup reuses canonical product, unit, barcode, pricing and inventory APIs', async () => {
  const quick = await source('../app/products/product-quick-setup-workspace.tsx');
  for (const contract of [
    '/api/products',
    '/variants',
    '/unit',
    '/barcodes',
    '/api/price-lists',
    '/items',
    '/api/inventory/balances',
  ]) {
    assert.ok(quick.includes(contract), `missing canonical contract ${contract}`);
  }
  assert.doesNotMatch(quick, /\/api\/product-quick-setup|\/api\/quick-sku|product_quick_setup|quick_setup_/i);
  assert.doesNotMatch(quick, /supabase|S3Client|PutObjectCommand|R2_ACCESS|CLOUDFLARE/i);
});

test('quick setup uses the shared idempotency generator and reuses keys while a POST is pending', async () => {
  const quick = await source('../app/products/product-quick-setup-workspace.tsx');
  assert.match(quick, /import \{ createIdempotencyKey \} from '@npp\/contracts'/);
  assert.match(quick, /pendingPostKeys = useRef\(new Map<string, string>\(\)\)/);
  assert.match(quick, /pendingPostKeys\.current\.get\(fingerprint\)/);
  assert.match(quick, /createIdempotencyKey\(operation\)/);
  assert.match(quick, /headers: \{ 'Content-Type': 'application\/json', 'Idempotency-Key': pending\.key \}/);
  assert.doesNotMatch(quick, /Idempotency-Key': `|Idempotency-Key": `|Math\.random\(/);
});

test('price editing stays inside existing price lists and refuses ambiguous direct-price rows', async () => {
  const quick = await source('../app/products/product-quick-setup-workspace.tsx');
  assert.match(quick, /PRICE_LIST_LABELS/);
  assert.match(quick, /adjustmentType: 'FIXED_PRICE'/);
  assert.match(quick, /directPriceItems\.length > 1/);
  assert.match(quick, /href="\/pricing"/);
  assert.doesNotMatch(quick, /125000[^\n]*amountMinor|amountMinor:\s*'125000'/);
});

test('inventory is read only and image preview stays compact without inventing media storage', async () => {
  const quick = await source('../app/products/product-quick-setup-workspace.tsx');
  const css = await source('../app/products/product-quick-setup.module.css');
  assert.match(quick, /href="\/inventory\/balances"/);
  assert.match(quick, /requestJson<InventoryBalance\[]>\(`\/api\/inventory\/balances\?/);
  assert.doesNotMatch(quick, /method:\s*'(?:POST|PATCH|DELETE)'[\s\S]{0,180}\/api\/inventory\/balances/);
  assert.match(quick, /data-testid="quick-product-image-preview"/);
  assert.match(css, /\.imagePreview\s*\{[\s\S]*?width:\s*72px;[\s\S]*?height:\s*72px;/);
});

test('quick setup UI uses office language and keeps advanced destinations reachable', async () => {
  const quick = await source('../app/products/product-quick-setup-workspace.tsx');
  assert.doesNotMatch(quick, /\bCore\b|\bNPP\b/);
  assert.match(quick, /Quản lý giá đầy đủ/);
  assert.match(quick, /Mở tra cứu tồn kho/);
  assert.match(quick, /Tạo sản phẩm → tạo SKU → gắn đơn vị\/quy đổi → mã vạch → giá/);
});

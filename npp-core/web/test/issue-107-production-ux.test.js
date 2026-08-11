import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), 'utf8');

test('deactivate conflicts accept the structured backend contract and stay actionable in Vietnamese', async () => {
  const source = await readSource('../lib/deactivate-conflict-message.ts');

  assert.match(source, /conflictCode\?: string/);
  assert.match(source, /ACTIVE_DEPENDENTS/);
  assert.match(source, /STALE_VERSION/);
  assert.match(source, /dependency\?\.path/);
  assert.match(source, /Không thể ngừng sử dụng vì vẫn còn dữ liệu đang hoạt động/);
  assert.match(source, /Bấm Làm mới rồi thực hiện lại thao tác/);
});

test('pricing resolution keeps error metadata and maps known business conflicts to guidance', async () => {
  const [helper, boundary] = await Promise.all([
    readSource('../lib/pricing-resolution-error.ts'),
    readSource('../app/pricing/pricing-idempotency-boundary.tsx'),
  ]);

  for (const code of [
    'BASE_PRICE_NOT_FOUND',
    'CUSTOMER_GROUP_MISMATCH',
    'VARIANT_UNIT_MISSING',
    'VARIANT_NOT_PRICEABLE',
  ]) {
    assert.match(helper, new RegExp(code));
  }
  assert.match(helper, /\.\.\.payload\.error/);
  assert.match(helper, /details/);
  assert.match(boundary, /normalizePricingResolutionResponse/);
  assert.match(boundary, /url\.pathname === '\/api\/pricing\/resolve'/);
  assert.match(boundary, /\/api\\\/pricing\\\/import/);
});

test('purchase-order layout gives discovery results dedicated height and keeps totals visible', async () => {
  const [layout, root] = await Promise.all([
    readSource('../app/issue-107-purchase-order-layout.css'),
    readSource('../app/layout.tsx'),
  ]);

  assert.match(root, /issue-107-purchase-order-layout\.css/);
  assert.match(layout, /purchase-order-editor-title/);
  assert.match(layout, /po-header-title/);
  assert.match(layout, /po-entry-title/);
  assert.match(layout, /\[role="listbox"\][\s\S]*min-height:\s*270px/);
  assert.match(layout, /Tổng tiền đơn đặt hàng/);
  assert.match(layout, /position:\s*sticky/);
});

test('multi-SKU pricing previews conflicts and persists one SKU-keyed idempotent import batch', async () => {
  const [page, overlay] = await Promise.all([
    readSource('../app/pricing/page.tsx'),
    readSource('../app/pricing/pricing-bulk-overlay.tsx'),
  ]);

  assert.match(page, /PricingBulkOverlay/);
  assert.match(overlay, /Chọn kết quả/);
  assert.match(overlay, /SKIP_EXISTING/);
  assert.match(overlay, /UPSERT_SKU/);
  assert.match(overlay, /không tạo dòng chồng lấn âm thầm/);
  assert.match(overlay, /matchBySku:\s*true/);
  assert.match(overlay, /sourceBatchId/);
  assert.match(overlay, /'Idempotency-Key': sourceBatchId/);
  assert.match(overlay, /requestJson<ImportResult>\('\/api\/pricing\/import'/);
  assert.equal((overlay.match(/\/api\/pricing\/import/g) ?? []).length, 1);
  assert.doesNotMatch(overlay, /wildcard/i);
  assert.match(overlay, /adjustmentType === 'FIXED_PRICE'[\s\S]*fixedPrices\[row\.sku\]/);
  assert.match(overlay, /listAllPriceListItems/);
  assert.match(overlay, /role="alert"/);
});

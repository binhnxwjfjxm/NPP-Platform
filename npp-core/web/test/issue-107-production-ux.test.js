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
  const [page, overview, overlay, fileAdjustment] = await Promise.all([
    readSource('../app/pricing/page.tsx'),
    readSource('../app/pricing/pricing-overview.tsx'),
    readSource('../app/pricing/pricing-bulk-overlay.tsx'),
    readSource('../app/pricing/pricing-file-adjustment.tsx'),
  ]);

  assert.doesNotMatch(page, /PricingBulkOverlay/);
  assert.match(overview, /PricingBulkOverlay/);
  assert.match(overview, /PricingFileAdjustment/);
  assert.match(overlay, /Điều chỉnh trực tiếp/);
  assert.match(overlay, /Cập nhật ngay/);
  assert.match(overlay, /Áp dụng từ ngày/);
  assert.match(overlay, /replaceFrom:\s*true/);
  assert.match(overlay, /createIdempotencyKey\('pricing_adjust'\)/);
  assert.match(overlay, /sourceBatchId:\s*operationKey/);
  assert.match(overlay, /'Idempotency-Key': operationKey/);
  assert.match(overlay, /requestJson<ImportResult>\('\/api\/pricing\/import'/);
  assert.equal((overlay.match(/\/api\/pricing\/import/g) ?? []).length, 1);
  assert.match(overlay, /listAllPriceListItems/);
  assert.match(overlay, /role="alert"/);
  assert.match(fileAdjustment, /Tải file mẫu/);
  assert.match(fileAdjustment, /Nhập từ file/);
  assert.match(fileAdjustment, /replaceFrom:\s*true/);
  assert.match(fileAdjustment, /createIdempotencyKey\('pricing_adjust_file'\)/);
  assert.match(overlay, /testId="bulk-pricing-modal" size="workspace"/);
  assert.match(fileAdjustment, /testId="pricing-file-adjustment-modal" size="workspace"/);
});

test('direct pricing conflict displays all rows and cannot submit without explicit confirmation', async () => {
  const [overlay, backendRoute] = await Promise.all([
    readSource('../app/pricing/pricing-bulk-overlay.tsx'),
    readSource('../../api/src/routes/pricing.js'),
  ]);
  assert.match(overlay, /const conflicts = simultaneouslyEffective\.length > 1/);
  assert.match(overlay, /confirmedConflicts/);
  assert.match(overlay, /hasUnconfirmedConflicts/);
  assert.match(overlay, /disabled=\{busy \|\| loading \|\| loadFailed \|\| !selectedSkus\.size \|\| hasUnconfirmedConflicts \|\| savePhase !== 'idle'\}/);
  assert.match(overlay, /resolveConflicts: confirmedConflicts\[sku\]/);
  assert.match(overlay, /expectedUpdatedAt: item\.updated_at/);
  assert.match(overlay, /Các mức giá đang cùng hiệu lực/);
  assert.match(overlay, /Tôi đã kiểm tra và đồng ý kết thúc/);
  assert.match(overlay, /setConfirmedConflicts\(\{\}\)/);
  assert.match(backendRoute, /details: tx\.failed\.details \?\? \{\}/);
});

test('price adjustment distinguishes mutation success from a failed refresh and prevents duplicate writes', async () => {
  const [overlay, service] = await Promise.all([
    readSource('../app/pricing/pricing-bulk-overlay.tsx'),
    readSource('../../api/src/services/pricing.js'),
  ]);
  assert.match(overlay, /setSavedReceipt\(\{ priceListId: list\.id, totalItems: result\.totalItems \}\)/);
  assert.match(overlay, /await verifySavedPrice\(list\.id, result\.totalItems\)/);
  assert.match(overlay, /savePhase !== 'idle'/);
  assert.match(overlay, /setSavePhase\('verified'\)/);
  assert.match(overlay, /Kiểm tra lại kết quả/);
  assert.match(overlay, /Không bấm lưu thêm/);
  assert.match(overlay, /className=\{styles\.footerError\} role="alert"/);
  assert.match(service, /verifySkuReplacement\(client,/);
  assert.match(service, /PRICING_REPLACEMENT_INCOMPLETE/);
});

test('price confirmation snapshots exact row revisions on checkbox click, not on submit', async () => {
  const overlay = await readSource('../app/pricing/pricing-bulk-overlay.tsx');
  assert.match(overlay, /function ruleSnapshot\(rows: PriceListItem\[\]\)/);
  assert.match(overlay, /const checked = event\.currentTarget\.checked/);
  assert.match(overlay, /const snapshot = checked \? ruleSnapshot\(row\.conflicts\) : null/);
  assert.match(overlay, /approvalMatches\(row\.conflicts, confirmedConflicts\[row\.sku\]\)/);
  assert.match(overlay, /resolveConflicts: confirmedConflicts\[sku\]/);
  assert.doesNotMatch(overlay, /resolveConflicts: preview\.find/);
});

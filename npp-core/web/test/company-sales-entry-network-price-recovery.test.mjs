import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const api = readFileSync(new URL('../app/sales/sales-orders/sales-order-ui.ts', import.meta.url), 'utf8');
const form = readFileSync(new URL('../app/sales/sales-orders/SalesOrderCommercialForm.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../app/sales/sales-orders/sales-orders.module.css', import.meta.url), 'utf8');

test('browser transport error is classified, localized and remains retryable', () => {
  assert.match(api, /try \{\s*response = await fetch\(path,/);
  assert.match(api, /catch \{\s*if \(requestInit\.signal\?\.aborted\)/);
  assert.match(api, /SALES_ORDER_REQUEST_ABORTED/);
  assert.match(api, /SALES_ORDER_NETWORK_UNAVAILABLE/);
  assert.match(api, /Chưa xác minh kết quả, hãy kiểm tra đơn trước khi gửi lại/);
  assert.match(api, /isReadOnly[\s\S]*requestMethod === 'GET'/);
  assert.match(api, /SALES_ORDER_NETWORK_UNAVAILABLE[\s\S]*true,/);
  assert.doesNotMatch(api, /throw new Error\('Failed to fetch'\)/);
});

test('price 0 is valid only for resolved or authorized manual-price intent', () => {
  assert.match(form, /function hasConfirmedLinePrice\(/);
  assert.match(form, /if \(line\.resolvingPrice\) return false;/);
  assert.match(form, /line\.pricingErrorCode === 'BASE_PRICE_NOT_FOUND' && hasValidManualPrice\(line\)/);
  assert.match(form, /return !line\.priceError && \/\^\\d\+\$\/\.test\(finalUnitPrice\(line\)\) && Boolean\(/);
  assert.match(form, /line\.pricingFingerprint \|\| line\.savedUnitPriceMinor !== null/);
  assert.match(form, /manualUnitPriceMinor: line\.priceSource === 'MANUAL_OVERRIDE' \? line\.unitPrice : ''/);
  assert.match(form, /return line\.manualUnitPriceMinor\.trim\(\) \|\| \(line\.resetManualPrice\s*\? line\.systemUnitPriceMinor : \(line\.savedUnitPriceMinor \?\? line\.systemUnitPriceMinor\)\);/);
  assert.match(form, /hasConfirmedLinePrice\(line\) \? \[\] : \[\{ line, index \}\]/);
});

test('SKU preview failure has a finished unavailable state and a user retry', () => {
  assert.match(form, /const \[skuSearchError, setSkuSearchError\]/);
  assert.match(form, /const \[skuPreviewError, setSkuPreviewError\]/);
  assert.match(form, /setSkuPreviewError\(error instanceof Error/);
  assert.match(form, /pricePreview: \{ status: 'UNAVAILABLE', unitPriceMinor: null/);
  assert.match(form, /inventoryPreview: \{ \.\.\.option\.inventoryPreview, status: 'UNAVAILABLE' \}/);
  assert.match(form, /Tải lại giá và tồn/);
  assert.match(form, /Tìm lại hàng/);
  assert.match(form, /skuSearchAttempt, warehouseId/);
});

test('pricing/reprice failures never appear as a payable 0 total', () => {
  assert.match(form, /const unresolvedPriceLines = useMemo\(/);
  assert.match(form, /const priceReady = hasConfirmedLinePrice\(line\);/);
  assert.match(form, /priceReady \? vnd\(estimate\.details\[index\]\?\.total \?\? 0n\) : '—'/);
  assert.match(form, /unresolvedPriceLines\.length \? 'Chưa đủ giá' : vnd\(estimate\.total\)/);
  assert.doesNotMatch(form, /priceRecoveryBanner|Tính lại các dòng lỗi|Tổng tiền chỉ hiện sau khi đủ giá hợp lệ/);
  assert.match(form, /className=\{styles\.linePriceFeedback\}/);
  assert.match(form, /!priceReady && !line\.resolvingPrice/);
  assert.match(form, /Tính lại giá/);
  assert.match(css, /\.linePriceFeedback\{[^}]*height:1\.8rem/);
  assert.match(css, /\.linePriceFeedback small\{[^}]*text-overflow:ellipsis;white-space:nowrap/);
  assert.doesNotMatch(css, /\.priceRecoveryBanner\{/);
});

test('SKU add, unit changes and split lines use guarded price generations', () => {
  assert.match(form, /pricingGenerationRef\.current\.get\(line\.clientLineId\)/);
  assert.match(form, /pricingGenerationRef\.current\.get\(line\.clientLineId\) !== result\.pricingGeneration/);
  assert.match(form, /await repriceLines\(\[pending\], pricingAt\);/);
  assert.match(form, /await repriceLines\(\[changed\], pricingAt\);/);
  assert.match(form, /await repriceLines\(\[split\], pricingAt\);/);
  assert.match(form, /loadProductVariants\(line\.productId\)/);
  assert.match(form, /resolveLineProduct\(line\)/);
  assert.match(form, /Tải lại ĐVT/);
});

test('a debounced quantity change cannot accept a stale price response before the next quote', () => {
  assert.match(form, /const quotedByLineId = new Map\(snapshot\.map/);
  assert.match(form, /line\.quantity !== quoted\.quantity \|\| line\.variantId !== quoted\.variantId/);
  assert.match(form, /pricingGenerationRef\.current\.get\(line\.clientLineId\) !== result\.pricingGeneration/);
  assert.match(form, /const effectiveAt = pricingAt;\s*void repriceLines\(changedLines, effectiveAt\)/);
  const quantityEffect = form.slice(form.indexOf('const quantitySignature ='), form.indexOf('function focusLineQuantity'));
  assert.doesNotMatch(quantityEffect, /setPricingAt\(/);
});

test('clearing a legacy manual override does not erase the persisted price context', () => {
  const priceInput = form.slice(form.indexOf('className={styles.directPriceInput}'), form.indexOf('className={styles.manualBadge}'));
  assert.match(priceInput, /manualUnitPriceMinor: value/);
  assert.match(priceInput, /resetManualPrice: value === ''/);
  assert.doesNotMatch(priceInput, /savedUnitPriceMinor: value/);
  assert.match(form, /line\.savedUnitPriceMinor !== null && !line\.resetManualPrice && !line\.manualUnitPriceMinor/);
});

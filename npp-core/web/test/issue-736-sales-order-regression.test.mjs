import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const wrapperPath = fileURLToPath(new URL('../app/sales/sales-orders/SalesOrderForm.tsx', import.meta.url));
const formPath = fileURLToPath(new URL('../app/sales/sales-orders/SalesOrderCommercialForm.tsx', import.meta.url));
const uiPath = fileURLToPath(new URL('../app/sales/sales-orders/sales-order-ui.ts', import.meta.url));

test('Issue #736 restores VND manual prices from decimal API strings without dropping commercial metadata', async () => {
  const [wrapper, form] = await Promise.all([
    readFile(wrapperPath, 'utf8'),
    readFile(formPath, 'utf8'),
  ]);

  assert.match(wrapper, /export function normalizeVndMinor/);
  assert.match(wrapper, /baseUnitPrice: normalizeVndMinor\(line\.baseUnitPrice\)/);
  assert.match(wrapper, /systemUnitPrice: normalizeVndMinor\(line\.systemUnitPrice\)/);
  assert.match(wrapper, /unitPrice: normalizeVndMinor\(line\.unitPrice\)/);
  assert.match(wrapper, /fraction && \/\[1-9\]\//);
  assert.match(form, /manualUnitPriceMinor: line\.priceSource === 'MANUAL_OVERRIDE' \? line\.unitPrice : ''/);
  assert.match(form, /manualReason: line\.manualOverrideReason \?\? ''/);
  assert.match(form, /pricingFingerprint: resolutionFingerprint\(line\.pricingTrace \?\? \[\]\)/);
  assert.match(form, /const price = \/\^\\d\+\$\/\.test\(finalUnitPrice\(line\)\) \? BigInt\(finalUnitPrice\(line\)\) : 0n/);
});

test('Issue #736 makes missing Công Ty price a preview business state while preserving save price guards', async () => {
  const [ui, form] = await Promise.all([
    readFile(uiPath, 'utf8'),
    readFile(formPath, 'utf8'),
  ]);

  assert.match(ui, /path !== '\/api\/pricing\/resolve'/);
  assert.match(ui, /allowMissingBasePrice: true/);
  assert.match(ui, /resolutionStatus === 'MANUAL_PRICE_REQUIRED'/);
  assert.match(ui, /previewState\.code \?\? 'BASE_PRICE_NOT_FOUND'/);
  assert.match(form, /line\.pricingErrorCode !== 'BASE_PRICE_NOT_FOUND' \|\| !hasValidManualPrice\(line\)/);
  assert.match(form, /!canPriceOverride \|\| !hasValidManualPrice\(line\)/);
  assert.match(form, /expectedSystemUnitPriceMinor: line\.systemUnitPriceMinor/);
  assert.match(form, /expectedPricingFingerprint: line\.pricingFingerprint/);
});

test('Issue #736 shows save errors inside the popup and keeps both draft delivery directions', async () => {
  const [wrapper, form] = await Promise.all([
    readFile(wrapperPath, 'utf8'),
    readFile(formPath, 'utf8'),
  ]);

  assert.match(wrapper, /createPortal/);
  assert.match(wrapper, /styles\.orderEditorFooter/);
  assert.match(wrapper, /role="alert"/);
  assert.match(wrapper, /data-testid="sales-order-form-error"/);
  assert.match(form, /<option value="TRIP">Giao theo chuyến<\/option>/);
  assert.match(form, /<option value="MANUAL">Giao thủ công<\/option>/);
  assert.match(form, /deliveryExecutionMode: deliveryExecutionMode \?\? 'TRIP'/);
  assert.match(form, /onError\(error instanceof Error \? error\.message : 'Không lưu được đơn bán hàng'\)/);
});

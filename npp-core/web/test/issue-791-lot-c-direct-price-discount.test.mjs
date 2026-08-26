import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const formPath = new URL('../app/sales/sales-orders/SalesOrderCommercialForm.tsx', import.meta.url);
const typesPath = new URL('../lib/sales-order-types.ts', import.meta.url);

test('Issue #791 Lô C edits unit price directly without a reason panel', async () => {
  const form = await readFile(formPath, 'utf8');
  assert.match(form, /aria-label={`Đơn giá \${line\.sku}`}/);
  assert.match(form, /onFocus=\{\(event\) => event\.currentTarget\.select\(\)\}/);
  assert.match(form, /manualUnitPriceMinor: value/);
  assert.doesNotMatch(form, /Lý do điều chỉnh giá \*/);
  assert.doesNotMatch(form, /finishManualPrice/);
  assert.doesNotMatch(form, /manualPriceEditor/);
  assert.doesNotMatch(form, /manualReason: line\.manualReason/);
});

test('Issue #791 Lô C sends direct per-line discount through the canonical sales-order payload', async () => {
  const [form, types] = await Promise.all([readFile(formPath, 'utf8'), readFile(typesPath, 'utf8')]);
  assert.match(types, /SalesOrderLineDiscountMode = 'TOTAL_AMOUNT' \| 'PER_UNIT' \| 'PERCENT'/);
  assert.match(types, /discountMode\?: SalesOrderLineDiscountMode/);
  assert.match(form, /aria-label={`Chiết khấu \${line\.sku}`}/);
  assert.match(form, /discountMode: line\.discountMode/);
  assert.match(form, /discountValue: line\.discountValue \|\| '0'/);
  assert.match(form, /estimate\.mixedScope/);
});


test('Issue #791 Lô C keeps line discount independent from whole-order reason', async () => {
  const form = await readFile(formPath, 'utf8');
  assert.match(form, /estimate\.documentDiscountTotal > 0n && \(!canDiscountOverride \|\| !documentDiscountReason\.trim\(\)\)/);
  assert.doesNotMatch(form, /estimate\.discount > 0n && \(!canDiscountOverride \|\| !documentDiscountReason\.trim\(\)\)/);
});

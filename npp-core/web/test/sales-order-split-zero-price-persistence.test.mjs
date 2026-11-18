import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Công Ty Ra đơn: giữ đúng dòng giá 0 khi lưu và mở lại sau Tách dòng', async () => {
  const [form, types] = await Promise.all([
    read('app/sales/sales-orders/SalesOrderCommercialForm.tsx'),
    read('lib/sales-order-types.ts'),
  ]);
  assert.match(form, /manualUnitPriceMinor: line.priceSource === 'MANUAL_OVERRIDE' \? line.unitPrice : ''/);
  assert.match(form, /clientLineId: crypto.randomUUID\(\)/);
  assert.match(form, /resetManualPrice: false,[\s\S]*?baseUnitPriceMinor: '0'/);
  assert.match(form, /props.mode !== 'create' && savedLineIds.has\(line.clientLineId\)/);
  assert.match(form, /sourceLineId: line.clientLineId/);
  assert.match(form, /line.resetManualPrice && savedLineIds.has\(line.clientLineId\)/);
  assert.match(form, /resetManualPrice: true,[\s\S]*?\} : line\)\);/);
  assert.match(form, /resetManualPrice: value === ''/);
  assert.match(types, /export type SalesOrderLineDraft = \{[\s\S]*?resetManualPrice\?: boolean;/);
});

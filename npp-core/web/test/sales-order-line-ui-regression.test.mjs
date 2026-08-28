import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const wrapperPath = fileURLToPath(new URL('../app/sales/sales-orders/SalesOrderForm.tsx', import.meta.url));

test('Sales order line UI keeps price and discount columns centered and trims stored decimal zeros', async () => {
  const wrapper = await readFile(wrapperPath, 'utf8');

  assert.match(wrapper, /export function normalizeEditableDecimal/);
  assert.match(wrapper, /discountValue: normalizeEditableDecimal\(line\.discountValue\)/);
  assert.match(wrapper, /styles\.lineTableHeader}>span:nth-child\(5\)/);
  assert.match(wrapper, /styles\.lineTableHeader}>span:nth-child\(6\)/);
  assert.match(wrapper, /styles\.directPriceInput}\{text-align:center!important\}/);
  assert.match(wrapper, /styles\.discountControls} select\{text-align:center!important;text-align-last:center\}/);
  assert.match(wrapper, /styles\.discountControls} input\{text-align:center!important\}/);
});

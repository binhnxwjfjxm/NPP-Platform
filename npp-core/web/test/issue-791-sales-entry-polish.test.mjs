import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const layoutPath = new URL('../app/layout.tsx', import.meta.url);
const polishPath = new URL('../app/sales-order-entry-polish.css', import.meta.url);

test('Issue #791 follow-up aligns sales-order columns and product search business data', async () => {
  const [layout, css] = await Promise.all([
    readFile(layoutPath, 'utf8'),
    readFile(polishPath, 'utf8'),
  ]);

  assert.match(layout, /import '\.\/sales-order-entry-polish\.css';/);
  assert.match(css, /section\[aria-label="Hàng hóa trong đơn"\] > header/);
  assert.match(css, /article\[data-testid\^="sales-order-line-"\]/);
  assert.match(css, /span:nth-child\(7\)[\s\S]*text-align: right/);
  assert.match(css, /:nth-child\(7\) strong \{[\s\S]*font-weight: 800/);
  assert.match(css, /section\[aria-label="Nhập hàng hóa"\] \[role="listbox"\] > button/);
  assert.match(css, /color: #157347/);
  assert.match(css, /content: "Giá "/);
  assert.match(css, /small \+ small::before \{[\s\S]*content: "\|"/);
  assert.match(css, /button:disabled[\s\S]*small:last-child/);
});

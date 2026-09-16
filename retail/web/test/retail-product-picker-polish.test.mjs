import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Retail product picker loads final polish after existing styles', async () => {
  const layout = await read('app/layout.tsx');
  assert.match(layout, /import '\.\/retail-print-professional\.css';\nimport '\.\/retail-product-picker-polish\.css';/);
});

test('Retail product picker keeps fast search and removes category pills from the visible UI', async () => {
  const page = await read('app/retail-workspace.tsx');
  const css = await read('app/retail-product-picker-polish.css');
  assert.match(page, /className="product-search"/);
  assert.match(page, /placeholder="Tìm tên, SKU, quy cách"/);
  assert.match(css, /\.product-sheet \.filter-tabs \{\s*display: none !important;/);
});

test('Retail product card keeps current height, enlarges text and moves price plus availability to two right rows', async () => {
  const css = await read('app/retail-product-picker-polish.css');
  assert.match(css, /\.choose-products \{[\s\S]*width: min\(82%, 360px\);[\s\S]*min-height: 58px;[\s\S]*border: 0;[\s\S]*box-shadow:/);
  assert.match(css, /\.lot7-product-row \{[\s\S]*grid-template-columns: 56px minmax\(0, 1fr\);[\s\S]*min-height: 90px;[\s\S]*overflow: hidden;/);
  assert.match(css, /\.lot7-product-row \.product-copy \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) minmax\(118px, auto\);[\s\S]*grid-template-rows: auto auto;/);
  assert.match(css, /\.product-copy strong \{[\s\S]*grid-column: 1;[\s\S]*font-size: 16px;/);
  assert.match(css, /\.product-copy b \{[\s\S]*grid-column: 2;[\s\S]*grid-row: 1;[\s\S]*font-size: 16px;/);
  assert.match(css, /\.product-copy em \{[\s\S]*grid-column: 2;[\s\S]*grid-row: 2;/);
});

test('Retail search result hides plus and quantity stepper because the whole card is the add action', async () => {
  const css = await read('app/retail-product-picker-polish.css');
  assert.match(css, /\.lot7-product-row \.add-product,[\s\S]*\.lot7-product-row \.quantity-stepper \{\s*display: none !important;/);
  assert.match(css, /\.lot7-product-row \{[\s\S]*cursor: pointer;/);
});

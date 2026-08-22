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

test('Retail product actions are centered, borderless and keep product price/action inside each card', async () => {
  const css = await read('app/retail-product-picker-polish.css');
  assert.match(css, /\.choose-products \{[\s\S]*width: min\(82%, 360px\);[\s\S]*min-height: 58px;[\s\S]*border: 0;[\s\S]*box-shadow:/);
  assert.match(css, /\.lot7-product-row \{[\s\S]*grid-template-columns: 56px minmax\(0, 1fr\) auto;[\s\S]*align-items: center;[\s\S]*overflow: hidden;/);
  assert.match(css, /\.lot7-product-row \.product-copy b \{[\s\S]*display: block;[\s\S]*white-space: nowrap;/);
  assert.match(css, /\.lot7-product-row \.add-product \{[\s\S]*align-self: center;[\s\S]*justify-self: end;/);
});

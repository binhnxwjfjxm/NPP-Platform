import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Retail product picker stylesheet owns picker geometry after POS styles', async () => {
  const layout = await read('app/layout.tsx');
  assert.match(layout, /import '\.\/retail-pos-entry\.css';\nimport '\.\/retail-product-picker-polish\.css';\nimport '\.\/retail-orders-polish\.css';/);
});

test('Retail product picker keeps fast search and removes category pills from the visible UI', async () => {
  const page = await read('app/retail-workspace.tsx');
  const css = await read('app/retail-product-picker-polish.css');
  assert.match(page, /className="product-search"/);
  assert.match(page, /placeholder="Nhập tên, SKU, Barcode"/);
  assert.match(page, />Tất cả loại sản phẩm<\/option>/);
  assert.match(css, /\.product-sheet \.filter-tabs \{\s*display: none !important;/);
});

test('Retail product card giữ nguyên chiều cao, tên dễ đọc và số lượng gọn một chữ số thập phân', async () => {
  const [page, css, posCss] = await Promise.all([
    read('app/retail-workspace.tsx'),
    read('app/retail-product-picker-polish.css'),
    read('app/retail-pos-entry.css'),
  ]);
  assert.match(css, /\.choose-products \{[\s\S]*width: min\(82%, 360px\);[\s\S]*min-height: 58px;[\s\S]*border: 0;[\s\S]*box-shadow:/);
  assert.match(css, /\.lot7-product-row \{[\s\S]*grid-template-columns: 56px minmax\(0, 1fr\) 28px;[\s\S]*height: 90px;[\s\S]*min-height: 90px;[\s\S]*overflow: hidden;/);
  assert.match(css, /@media \(max-width: 480px\)[\s\S]*\.lot7-product-row \{[\s\S]*height: 86px;[\s\S]*min-height: 86px;/);
  assert.match(css, /\.product-copy strong \{[\s\S]*-webkit-line-clamp: 2;[\s\S]*white-space: normal;[\s\S]*text-overflow: clip;/);
  assert.match(css, /\.product-unit \{[\s\S]*font-size: 14px;/);
  assert.match(css, /\.product-availability \{[\s\S]*font-size: 16px;[\s\S]*font-weight: 900;[\s\S]*font-variant-numeric: tabular-nums;/);
  assert.match(page, /pickerQuantityNumber = new Intl\.NumberFormat\('vi-VN', \{ maximumFractionDigits: 1 \}\)/);
  assert.match(page, /className="product-unit"/);
  assert.match(page, /className="product-availability"/);
  assert.doesNotMatch(page, /· Khả dụng:/);
  const posRuleStart = posCss.indexOf('.retail-issue675 .product-sheet .lot7-product-row.pos-product-row {');
  const posRule = posCss.slice(posRuleStart, posCss.indexOf('}', posRuleStart) + 1);
  assert.doesNotMatch(posRule, /grid-template-columns|min-height|height:/);
});

test('Retail search result: chế độ đơn chọn/bỏ; Chọn nhiều chạm lặp để tăng số lượng', async () => {
  const [page, css] = await Promise.all([read('app/retail-workspace.tsx'), read('app/retail-product-picker-polish.css')]);
  assert.match(page, /role="option"/);
  assert.match(page, /if \(multiSelectRef\.current\)/);
  assert.match(page, /Number\(row\.quantity\) \+ 1/);
  assert.match(page, /className="multi-selection-count"/);
  assert.match(page, /className="selection-mark"/);
  assert.match(page, /className="selection-mark empty"/);
  assert.match(css, /\.lot7-product-row \{[\s\S]*cursor: pointer;/);
  assert.match(css, /\.lot7-product-row:focus-visible \{[\s\S]*outline:/);
});

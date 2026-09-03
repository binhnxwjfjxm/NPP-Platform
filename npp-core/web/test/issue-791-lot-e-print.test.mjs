import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const salesPrint = read('app/sales/sales-orders/SalesOrderPrintSheet.tsx');
const businessPrint = read('app/components/business-document-print.tsx');
const businessCss = read('app/components/business-document-print.module.css');
const printSource = read('app/components/print-document.tsx');
const printCss = read('app/components/print-document.module.css');

test('Issue #791 Lô E keeps product, SKU, quantity and unit independent on Sales Order print', () => {
  assert.match(salesPrint, /key: 'itemName'.*fieldKey: 'line_item'.*label: 'Tên sản phẩm'/);
  assert.match(salesPrint, /key: 'sku', fieldKey: 'line_sku', label: 'SKU'/);
  assert.match(salesPrint, /key: 'quantity'.*fieldKey: 'line_quantity'.*label: 'SL'/);
  assert.match(salesPrint, /key: 'unit'.*fieldKey: 'line_unit'.*label: 'ĐVT'/);
  assert.match(salesPrint, /itemName: <strong>\{line\.itemName\}<\/strong>/);
  assert.match(salesPrint, /sku: line\.sku/);
  assert.match(salesPrint, /quantity: formatQuantity\(line\.quantity\)/);
  assert.match(salesPrint, /unit: line\.unitName \|\| line\.unitCode/);
  assert.doesNotMatch(salesPrint, /key: 'sku', fieldKey: 'line_item'/);
  assert.doesNotMatch(salesPrint, /label: 'Sản phẩm \/ SKU'/);
  assert.doesNotMatch(salesPrint, /quantity:\s*`\$\{formatQuantity\(line\.quantity\)\}\s+\$\{line\.unitCode\}`/);
});

test('Issue #791 Lô E uses clean browser headers and a safe narrow app margin', () => {
  assert.match(salesPrint, /headingFallback="Hưng Phát Company"/);
  assert.match(salesPrint, /showSubtitle=\{false\}/);
  assert.match(salesPrint, /showNumber=\{false\}/);
  assert.match(salesPrint, /suppressBrowserHeaders/);
  assert.match(salesPrint, /narrowMargins/);
  assert.doesNotMatch(salesPrint, /subtitle="Chứng từ bán hàng"/);
  assert.match(businessPrint, /showSubtitle \? \(template\?\.subtitle\?\.trim\(\) \|\| subtitle\) : null/);
  assert.match(businessPrint, /showNumber \? <p>Số:/);
  assert.match(businessPrint, /narrowMargins=\{narrowMargins\}/);
  assert.match(printSource, /data-print-suppress-browser-headers/);
  assert.match(printSource, /data-print-narrow-margins/);
  assert.match(printCss, /@page document-a4-clean\s*\{[\s\S]*margin:\s*0/);
  assert.match(printCss, /data-print-size='A4'\]\[data-print-suppress-browser-headers='true'\]\[data-print-narrow-margins='true'\][\s\S]*padding:\s*5mm/);
});

test('Issue #791 Lô E lets A4 sales columns size to actual content instead of stale fixed percentages', () => {
  assert.match(salesPrint, /tableLayout="auto"/);
  assert.match(salesPrint, /label: 'Đơn giá'.*wrap: 'nowrap'/);
  assert.match(salesPrint, /label: 'CK'.*wrap: 'nowrap'/);
  assert.match(salesPrint, /label: 'Thành tiền'.*wrap: 'nowrap'/);
  assert.doesNotMatch(salesPrint, /width: '\d+%'/);
  assert.match(businessPrint, /tableLayout\?: 'auto' \| 'fixed'/);
  assert.match(businessPrint, /<colgroup>/);
  assert.match(businessPrint, /column\.width/);
  assert.match(businessCss, /\.table\s*\{[\s\S]*width:\s*100%/);
  assert.match(businessCss, /\.noWrap\s*\{[\s\S]*white-space:\s*nowrap/);
  assert.match(printCss, /size:\s*A4 portrait/);
});

test('Issue #791 Lô E preserves browser print as presentation-only and does not add 80 mm behavior', () => {
  assert.match(printSource, /cloneNode\(true\)/);
  assert.match(printSource, /window\.print\(\)/);
  assert.match(printSource, /data-print-active/);
  assert.doesNotMatch(salesPrint, /method:\s*['"](?:POST|PATCH|PUT|DELETE)['"]/);
  assert.doesNotMatch(salesPrint, /Idempotency-Key/);
  assert.doesNotMatch(salesPrint, /80\s*mm|80mm|thermal/i);
});

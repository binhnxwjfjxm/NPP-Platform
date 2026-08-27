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
  assert.match(salesPrint, /key: 'quantity'.*fieldKey: 'line_quantity'.*label: 'Số lượng'/);
  assert.match(salesPrint, /key: 'unit'.*fieldKey: 'line_unit'.*label: 'ĐVT'/);
  assert.match(salesPrint, /itemName: <strong>\{line\.itemName\}<\/strong>/);
  assert.match(salesPrint, /sku: line\.sku/);
  assert.match(salesPrint, /quantity: formatQuantity\(line\.quantity\)/);
  assert.match(salesPrint, /unit: line\.unitCode/);
  assert.doesNotMatch(salesPrint, /key: 'sku', fieldKey: 'line_item'/);
  assert.doesNotMatch(salesPrint, /label: 'Sản phẩm \/ SKU'/);
  assert.doesNotMatch(salesPrint, /quantity:\s*`\$\{formatQuantity\(line\.quantity\)\}\s+\$\{line\.unitCode\}`/);
});

test('Issue #791 Lô E uses a clean two-sided heading without browser print clutter', () => {
  assert.match(salesPrint, /headingFallback="Hưng Phát Company"/);
  assert.match(salesPrint, /showSubtitle=\{false\}/);
  assert.match(salesPrint, /showNumber=\{false\}/);
  assert.match(salesPrint, /suppressBrowserHeaders/);
  assert.doesNotMatch(salesPrint, /subtitle="Chứng từ bán hàng"/);
  assert.match(businessPrint, /showSubtitle \? \(template\?\.subtitle\?\.trim\(\) \|\| subtitle\) : null/);
  assert.match(businessPrint, /showNumber \? <p>Số:/);
  assert.match(printSource, /data-print-suppress-browser-headers/);
  assert.match(printCss, /@page document-a4-clean\s*\{[\s\S]*margin:\s*0/);
  assert.match(printCss, /data-print-size='A4'\]\[data-print-suppress-browser-headers='true'\][\s\S]*padding:\s*11mm 10mm 12mm/);
});

test('Issue #791 Lô E keeps price, discount and amount readable in an A4 fixed table', () => {
  assert.match(salesPrint, /tableLayout="fixed"/);
  assert.match(salesPrint, /label: 'Đơn giá'.*width: '13%'/);
  assert.match(salesPrint, /label: 'CK'.*width: '10%'/);
  assert.match(salesPrint, /label: 'Thành tiền'.*width: '14%'/);
  assert.match(businessPrint, /tableLayout\?: 'auto' \| 'fixed'/);
  assert.match(businessPrint, /<colgroup>/);
  assert.match(businessPrint, /column\.width/);
  assert.match(businessCss, /\.fixedTable\s*\{[\s\S]*table-layout:\s*fixed/);
  assert.match(businessCss, /\.fixedTable th,[\s\S]*\.fixedTable td[\s\S]*overflow-wrap:\s*anywhere/);
  assert.match(businessCss, /\.fixedTable th\s*\{[\s\S]*font-size:\s*9\.5pt/);
  assert.match(businessCss, /\.table th\s*\{[\s\S]*font-size:\s*9pt/);
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

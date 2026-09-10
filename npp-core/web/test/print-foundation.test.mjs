import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function read(relative) {
  return readFileSync(new URL(relative, import.meta.url), 'utf8');
}

test('shared print foundation uses browser print and print-only surface', () => {
  const component = read('../app/components/print-document.tsx');
  const css = read('../app/components/print-document.module.css');
  assert.match(component, /window\.print\(\)/);
  assert.match(component, /data-print-surface/);
  assert.match(css, /@media print/);
  assert.match(css, /@page/);
  assert.match(css, /size: A4 portrait/);
});

test('shared print footer stays compact and counts every page in one document', () => {
  const css = read('../app/components/print-document.module.css');
  assert.match(css, /@bottom-right\s*\{/);
  assert.match(css, /content:\s*counter\(page\)\s*"\/"\s*counter\(pages\)/);
  assert.match(css, /font-size:\s*8px/);
  assert.match(css, /line-height:\s*1/);
  assert.match(css, /@page document-a4-clean\s*\{[\s\S]*?margin:\s*0 0 3mm 0/);
  assert.doesNotMatch(css, /content:\s*["']Trang/);
});

test('Sales Order print is exposed for numbered immutable confirmed, closed or cancelled orders', () => {
  const detail = read('../app/sales/sales-orders/SalesOrderDetail.tsx');
  const sheet = read('../app/sales/sales-orders/SalesOrderPrintSheet.tsx');
  assert.match(detail, /order\.number && \['confirmed', 'closed', 'cancelled'\]\.includes\(order\.status\)/);
  assert.match(detail, /SalesOrderPrintSheet order=\{order\} version=\{current\}/);
  assert.match(sheet, /PHIẾU XUẤT KHO/);
  assert.match(sheet, /customerAddress/);
  assert.match(sheet, /collectionLabels/);
  assert.match(sheet, /version\.lines/);
  assert.match(sheet, /TỔNG CỘNG/);
});

test('Sales Order mutation keys use the shared canonical generator', () => {
  const source = read('../app/sales/sales-orders/sales-order-ui.ts');
  assert.match(source, /import \{[\s\S]*?\bcreateIdempotencyKey\b[\s\S]*?\} from '@npp\/contracts'/);
  assert.match(source, /return createIdempotencyKey\(prefix\)/);
  assert.doesNotMatch(source, /`\$\{prefix\}-\$\{crypto\.randomUUID\(\)\}`/);
});

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

test('Sales Order print is only exposed from an immutable numbered confirmed version', () => {
  const detail = read('../app/sales/sales-orders/SalesOrderDetail.tsx');
  const sheet = read('../app/sales/sales-orders/SalesOrderPrintSheet.tsx');
  assert.match(detail, /order\.number && \['confirmed', 'closed'\]\.includes\(order\.status\)/);
  assert.match(detail, /SalesOrderPrintSheet order=\{order\} version=\{current\}/);
  assert.match(sheet, /ĐƠN BÁN HÀNG/);
  assert.match(sheet, /customerAddress/);
  assert.match(sheet, /collectionLabels/);
  assert.match(sheet, /version\.lines/);
  assert.match(sheet, /TỔNG CỘNG/);
});

test('Sales Order mutation keys use the shared canonical generator', () => {
  const source = read('../app/sales/sales-orders/sales-order-ui.ts');
  assert.match(source, /import \{ createIdempotencyKey \} from '@npp\/contracts'/);
  assert.match(source, /return createIdempotencyKey\(prefix\)/);
  assert.doesNotMatch(source, /`\$\{prefix\}-\$\{crypto\.randomUUID\(\)\}`/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('SKU form exposes shipment weight in office language', () => {
  const source = readFileSync(new URL('../app/products/product-workspace.tsx', import.meta.url), 'utf8');
  assert.match(source, /Khối lượng/);
  assert.match(source, /variant-weight-input/);
  assert.match(source, /variant-weight-uom-select/);
});

test('sales print shows order weight in header and no per-line weight column', () => {
  const source = readFileSync(new URL('../app/sales/sales-orders/SalesOrderPrintSheet.tsx', import.meta.url), 'utf8');
  assert.match(source, /key: 'total_weight', label: 'Khối lượng'/);
  assert.match(source, /Chưa đủ dữ liệu/);
  assert.doesNotMatch(source, /fieldKey: 'line_weight'/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../app/sales/sales-orders/SalesOrderCommercialForm.tsx', import.meta.url), 'utf8');

test('Công Ty exposes the shared Giao tại quầy sales flow', () => {
  assert.match(source, /<option value="PICKUP">Giao tại quầy<\/option>/);
  assert.match(source, /setDeliveryMode\('PICKUP'\)/);
  assert.match(source, /setDeliveryExecutionMode\(null\)/);
  assert.match(source, /<span>Giá áp dụng \*<\/span>/);
  assert.match(source, /<option value="LAST_PURCHASE"[^>]*>Giá lần mua trước<\/option>/);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('../app/sales/sales-orders/ManualSalesOrderReturns.tsx', import.meta.url),
  'utf8',
);

test('Đơn đã xuất kho: API gửi lượng 12 chữ số thập phân phải hiện các mã có thể trả', () => {
  const declaration = source.split('\n').find((line) => line.startsWith('const DECIMAL = /'));
  assert.ok(declaration);
  const match = declaration.match(/^const DECIMAL = \/(.+)\/;$/);
  assert.ok(match);
  const pattern = new RegExp(match[1]);

  for (const remaining of [
    '1.000000000000',
    '0.500000000000',
    '252.000000000000',
    '7202.000000000000',
  ]) {
    assert.equal(pattern.test(remaining), true, remaining);
  }
  assert.equal(pattern.test('0.000000000000'), true);
  assert.equal(pattern.test('1.0000000000000'), false);
  assert.match(source, /quantity\(line\.remainingBaseQuantity\)/);
  assert.match(source, /Trả nguyên đơn/);
  assert.match(source, /Trả một phần/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROUTES = [
  '../src/routes/inventory-stocktakes.js',
  '../src/routes/inventory-adjustments.js',
];

for (const routePath of ROUTES) {
  test(`${routePath} sends the canonical idempotency response envelope`, () => {
    const source = readFileSync(new URL(routePath, import.meta.url), 'utf8');
    assert.match(source, /execution\.response\.statusCode/);
    assert.match(source, /execution\.response\.body/);
    assert.match(source, /execution\.response\.contentType/);
    assert.match(source, /execution\.response\.requestId/);
    assert.doesNotMatch(source, /sendJson\(res, execution\.statusCode/);
  });
}

test('Inventory mutation fallback messages stay in office-language Vietnamese', () => {
  const stocktake = readFileSync(new URL('../src/routes/inventory-stocktakes.js', import.meta.url), 'utf8');
  const adjustment = readFileSync(new URL('../src/routes/inventory-adjustments.js', import.meta.url), 'utf8');
  assert.match(stocktake, /Không thể hoàn tất thao tác kiểm kê kho\./);
  assert.match(adjustment, /Không thể hoàn tất thao tác điều chỉnh tồn\./);
  assert.doesNotMatch(stocktake, /Stocktake operation failed/);
  assert.doesNotMatch(adjustment, /Inventory adjustment operation failed/);
});

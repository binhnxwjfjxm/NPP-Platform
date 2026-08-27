import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../app/retail-workspace.tsx', import.meta.url), 'utf8');

test('Retail price override follows Công Ty permission and canonical payload', () => {
  assert.match(source, /canPriceOverride/);
  assert.match(source, /manualUnitPriceMinor: manualPrice/);
  assert.match(source, /priceSource === 'MANUAL_OVERRIDE'/);
  assert.match(source, /aria-label={`Đơn giá \$\{line\.sku\}`}/);
});

test('Retail shortage gate defers controlled negative stock authority to Công Ty backend', () => {
  assert.match(source, /canNegativeStockIssue/);
  assert.match(source, /const stockBlocked = shortageRows\.length > 0 && !canNegativeStockIssue/);
  assert.match(source, /Công Ty sẽ kiểm tra quyền xuất vượt tồn và chính sách kho/);
  assert.doesNotMatch(source, /const stockBlocked = shortageRows\.length > 0;/);
});

test('Retail mutations keep canonical idempotency generator', () => {
  assert.match(source, /createIdempotencyKey/);
  assert.match(source, /createIdempotencyKey\(`retail-\$\{action\}`\)/);
});

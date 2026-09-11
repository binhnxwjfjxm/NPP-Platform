import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const api = source('../lib/fulfillment-api.ts');
const page = source('../app/picking/[demandId]/page.tsx');

test('Delivery does not expose SKU location policy and names null scope as Tồn chung', () => {
  assert.doesNotMatch(api, /locationRequired/);
  assert.match(page, /if \(scope\.locationId === null\) return 'Tồn chung'/);
  assert.match(page, /locationId === null \? \{ \.\.\.allocation, locationCode: 'Tồn chung' \} : allocation/);
  assert.doesNotMatch(page, /Không bắt buộc vị trí/);
});

test('Delivery uses office language for picking workflow', () => {
  assert.doesNotMatch(page, /Core Fulfillment|NPP Core/);
  assert.match(page, /Đã soạn đủ mã này/);
  assert.match(page, /trạng thái chuẩn bị hàng tại Công Ty/);
});

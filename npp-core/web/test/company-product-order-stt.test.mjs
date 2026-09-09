import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { productCreationSequence, sortProductsNewestFirst } from '../lib/product-list-order.js';
import { collectAllProductPages } from '../lib/product-catalog-client-pagination.js';

function product(id, code, createdAt) {
  return { id, code, created_at: createdAt };
}

test('STT sản phẩm giữ theo thứ tự tạo và không bị đánh lại khi lọc', () => {
  const rows = [
    product('p2', 'SP002', '2026-01-02T00:00:00.000Z'),
    product('p1', 'SP001', '2026-01-01T00:00:00.000Z'),
    product('p3', 'SP003', '2026-01-03T00:00:00.000Z'),
  ];
  const sequence = productCreationSequence(rows);
  assert.equal(sequence.get('p1'), 1);
  assert.equal(sequence.get('p2'), 2);
  assert.equal(sequence.get('p3'), 3);
  assert.deepEqual(sortProductsNewestFirst(rows).map((item) => item.id), ['p3', 'p2', 'p1']);

  const filtered = rows.filter((item) => item.id === 'p2');
  assert.equal(sequence.get(filtered[0].id), 2);
});

test('STT sản phẩm có cùng thời điểm tạo vẫn ổn định theo id, không phụ thuộc mã có thể sửa', () => {
  const rows = [
    product('b-id', 'AAA', '2026-01-01T00:00:00.000Z'),
    product('a-id', 'ZZZ', '2026-01-01T00:00:00.000Z'),
  ];
  const sequence = productCreationSequence(rows);
  assert.equal(sequence.get('a-id'), 1);
  assert.equal(sequence.get('b-id'), 2);
});

test('Làm mới danh mục tải tiếp sau 1.000 sản phẩm', async () => {
  const calls = [];
  const rows = await collectAllProductPages(async ({ limit, offset }) => {
    calls.push({ limit, offset });
    if (offset === 0) return Array.from({ length: 1000 }, (_, index) => ({ id: `p-${index}` }));
    if (offset === 1000) return [{ id: 'p-1000' }, { id: 'p-1001' }];
    return [];
  });
  assert.equal(rows.length, 1002);
  assert.deepEqual(calls, [{ limit: 1000, offset: 0 }, { limit: 1000, offset: 1000 }]);
});

test('Danh mục và Thiết lập nhanh dùng chung hợp đồng tìm hàng linh hoạt', () => {
  const productWorkspace = readFileSync(new URL('../app/products/product-workspace.tsx', import.meta.url), 'utf8');
  const quickSetup = readFileSync(new URL('../app/products/product-quick-setup-workspace.tsx', import.meta.url), 'utf8');
  assert.match(productWorkspace, /productSearchMatches/);
  assert.match(productWorkspace, /productCreationSequence/);
  assert.match(productWorkspace, /sortProductsNewestFirst/);
  assert.match(productWorkspace, /collectAllProductPages/);
  assert.match(productWorkspace, /value=\{productSequence\.get\(product\.id\)\}/);
  assert.match(quickSetup, /productSearchMatches/);
  assert.doesNotMatch(productWorkspace, /function normalizeSearch/);
  assert.doesNotMatch(quickSetup, /function normalizeSearch/);
});

test('Đơn bán giữ hàng mới trên cùng nhưng lưu và in theo thứ tự nhập', () => {
  const form = readFileSync(new URL('../app/sales/sales-orders/SalesOrderCommercialForm.tsx', import.meta.url), 'utf8');
  const print = readFileSync(new URL('../app/sales/sales-orders/SalesOrderPrintSheet.tsx', import.meta.url), 'utf8');
  assert.match(form, /setLines\(\(current\) => \[pending, \.\.\.current\]\)/);
  assert.match(form, /value=\{lines\.length - index\}/);
  assert.match(form, /lines: \[\.\.\.lines\]\.reverse\(\)\.map/);
  assert.match(form, /return \[\.\.\.\(version\?\.lines \?\? \[\]\)\]\.reverse\(\)\.map/);
  assert.match(form, /const canonicalLines = \[\.\.\.lines\]\.reverse\(\)/);
  assert.match(form, /details: \[\.\.\.canonicalDetails\]\.reverse\(\)/);
  assert.match(form, /current\.slice\(0, sourceIndex\), split, \.\.\.current\.slice\(sourceIndex\)/);
  assert.match(print, /no: line\.lineNumber/);
});

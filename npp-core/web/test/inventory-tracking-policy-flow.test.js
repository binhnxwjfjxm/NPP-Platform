import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path) {
  return readFile(new URL(path, import.meta.url), 'utf8');
}

test('màn chính sách lô hiển thị cả SKU tồn chuẩn chưa có chính sách và tìm bằng SKU cùng sản phẩm', async () => {
  const workspace = await source('../app/inventory/tracking-policies/tracking-policy-workspace.tsx');
  const typeSource = await source('../lib/inventory-policy-types.ts');

  assert.match(workspace, /const filteredCandidates = useMemo\(\(\) => candidates\.filter/);
  assert.match(workspace, /candidate\.related_variant_search_text/);
  assert.match(workspace, /Chưa thiết lập/);
  assert.match(workspace, /Không có SKU tồn chuẩn phù hợp/);
  assert.match(workspace, /Tìm SKU bất kỳ, SKU tồn chuẩn hoặc tên hàng/);
  assert.match(typeSource, /related_variant_search_text: string/);
});

test('chính sách mới mặc định không quản lý lô và hạn dùng, hạn dùng khóa khi không quản lý lô', async () => {
  const workspace = await source('../app/inventory/tracking-policies/tracking-policy-workspace.tsx');
  assert.match(workspace, /return \{ baseVariantId, lotTrackingMode: 'NONE', expiryTrackingMode: 'NONE', expectedVersion: '' \}/);
  assert.match(workspace, /expiryTrackingMode: value === 'NONE' \? 'NONE' : current\.expiryTrackingMode/);
  assert.match(workspace, /disabled=\{draft\.lotTrackingMode === 'NONE'\}/);
});

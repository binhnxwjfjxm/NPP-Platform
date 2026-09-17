import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workspacePath = new URL('../app/inventory/manual-inbounds/manual-inbound-workspace.tsx', import.meta.url);

test('Nhập hàng thủ công có luồng phím tắt nhập nhanh tương đương phần hàng của Đơn bán', async () => {
  const source = await readFile(workspacePath, 'utf8');

  assert.match(source, /aria-keyshortcuts="F3"/);
  assert.match(source, /event\.key === 'F3'/);
  assert.match(source, /event\.key === 'ArrowDown'/);
  assert.match(source, /event\.key === 'ArrowUp'/);
  assert.match(source, /event\.key === 'Enter'/);
  assert.match(source, /data-testid="manual-inbound-product-results"/);
  assert.match(source, /startsWith\('Giá vốn dòng '\)/);
  assert.match(source, /focusProductSearch\(\)/);
});

test('Tách dòng tạo hai định danh độc lập và giữ số lượng dòng mới bằng 1', async () => {
  const source = await readFile(workspacePath, 'utf8');

  assert.match(source, /splitIdentity: string;/);
  assert.match(source, /splitIdentity: row\.splitIdentity \|\| null/);
  assert.match(source, /function splitRow\(index: number\)/);
  assert.match(source, /const sourceSplitIdentity = source\.splitIdentity \|\| crypto\.randomUUID\(\)/);
  assert.match(source, /const newSplitIdentity = crypto\.randomUUID\(\)/);
  assert.match(source, /splitIdentity: row\.splitIdentity \|\| sourceSplitIdentity/);
  assert.match(source, /splitIdentity: newSplitIdentity, sourceQuantity: '1'/);
  assert.match(source, />↳ Tách dòng<\/button>/);
  assert.match(source, /key === 'splitIdentity' \|\| !String\(value \?\? ''\)\.trim\(\)/);
});

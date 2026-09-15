import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const workspace = readFileSync(
  new URL('../app/inventory/manual-inbounds/manual-inbound-workspace.tsx', import.meta.url),
  'utf8',
);

test('Nhập trực tiếp hiển thị hàng mới nhất lên trên nhưng giữ STT theo thứ tự nhập', () => {
  assert.match(
    workspace,
    /const directRows = rows\.filter\(\(row\) => !rowIsEmpty\(row\)\)\.slice\(\)\.reverse\(\);/,
  );
  assert.match(
    workspace,
    /directRows\.map\(\(row, index\) => \{[\s\S]*?const actualIndex = rows\.indexOf\(row\);[\s\S]*?<BusinessTableSequenceCell rowIndex=\{index\} value=\{actualIndex \+ 1\} \/>/,
  );
});

test('Đảo thứ tự chỉ áp dụng cho hiển thị nhập trực tiếp, không đổi dữ liệu ghi sổ hoặc thứ tự file', () => {
  assert.match(
    workspace,
    /rows: sourceRows\.filter\(\(row\) => !rowIsEmpty\(row\)\)\.map\(\(row\) => \(\{/,
  );
  assert.match(
    workspace,
    /setRows\(\(current\) => emptyIndex >= 0[\s\S]*?: \[\.\.\.current, nextRow\]\);/,
  );
  assert.match(
    workspace,
    /<tbody>\{rows\.map\(\(row, index\) => \{/,
  );
});

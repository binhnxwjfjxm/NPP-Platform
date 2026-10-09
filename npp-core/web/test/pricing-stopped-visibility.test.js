import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const source = fs.readFileSync(path.join(process.cwd(), 'app/pricing/pricing-workspace.tsx'), 'utf8');

test('mục ngừng sử dụng được ẩn mặc định và cho xem lại ở ba danh sách', () => {
  assert.match(source, /const \[showStopped, setShowStopped\] = useState\(false\)/);
  for (const name of ['channels', 'lists', 'items']) {
    assert.match(source, new RegExp(`data-testid="pricing-${name}-show-stopped"`));
  }
  assert.match(source, /channels\.filter\(\(channel\) => showStopped \|\| channel\.is_active\)/);
  assert.match(source, /lists\.filter\(\(list\) => showStopped \|\| list\.is_active\)/);
  assert.match(source, /items\.filter\(\(item\) => showStopped \|\| item\.is_active\)/);
  assert.match(source, /\{visibleChannels\.map\(/);
  assert.match(source, /\{visibleLists\.map\(/);
  assert.match(source, /\{visibleItems\.map\(/);
  assert.match(source, /Xem đã ngừng/);
  assert.match(source, /Ẩn đã ngừng/);
});

test('bảng đã ngừng không được chọn mặc định, vẫn có thể tìm lại để kích hoạt', () => {
  assert.match(source, /\{visibleLists\.map\(\(list\) => <option/);
  assert.match(source, /setSelectedListId\(lists\.find\(\(list\) => list\.is_active\)\?\.id \?\? ''\)/);
  assert.match(source, /Đưa vào sử dụng/);
  assert.match(source, /Ngừng sử dụng/);
});

test('không xóa dữ liệu hoặc thay đổi cách áp giá', () => {
  assert.doesNotMatch(source, /method:\s*'DELETE'/);
  assert.match(source, /isActive: !list\.is_active/);
  assert.match(source, /isActive: !item\.is_active/);
  assert.match(source, /isActive: !channel\.is_active/);
});

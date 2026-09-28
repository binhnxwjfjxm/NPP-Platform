import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const form = readFileSync(new URL('../app/sales/sales-orders/SalesOrderCommercialForm.tsx', import.meta.url), 'utf8');

test('ghi chú đơn giữ nội dung tạm ngoài state để gõ không render lại toàn màn', () => {
  assert.match(form, /const noteInitialRef = useRef\(version\?\.note \?\? ''\)/);
  assert.match(form, /const noteDraftRef = useRef\(version\?\.note \?\? ''\)/);
  assert.match(form, /defaultValue=\{noteDraftRef\.current\}/);
  assert.match(form, /onChange=\{\(event\) => \{ noteDraftRef\.current = event\.currentTarget\.value; \}\}/);
  assert.match(form, /onBlur=\{commitNoteDraft\}/);
  assert.doesNotMatch(form, /const \[note, setNote\]/);
  assert.doesNotMatch(form, /setNote\(/);
});

test('ghi chú chỉ vào payload khi lưu và chỉ đổi khóa thao tác sau khi rời ô', () => {
  assert.match(form, /const noteValue = noteDraftRef\.current\.trim\(\)/);
  assert.match(form, /\.\.\.\(noteValue \? \{ note: noteValue \} : \{\}\)/);
  const start = form.indexOf('const markNoteDirty = useCallback');
  const end = form.indexOf('const requestClose = useCallback', start);
  assert.ok(start >= 0 && end > start);
  const noteDirtyBlock = form.slice(start, end);
  assert.match(noteDirtyBlock, /setSaveKey\(mutationKey\(`sales-\$\{props\.mode\}-save`\)\)/);
  assert.match(noteDirtyBlock, /setConfirmKey\(mutationKey\(`sales-\$\{props\.mode\}-confirm`\)\)/);
  assert.doesNotMatch(noteDirtyBlock, /setEntrySettingsKey|setPricingMismatch|onError/);
  assert.match(form, /noteMutationKeyRotatedRef\.current = false;\s*setBusy\(true\)/);
});

test('đóng form vẫn cảnh báo nếu chỉ mới sửa ghi chú mà chưa lưu', () => {
  assert.match(form, /const noteChanged = noteDraftRef\.current !== noteInitialRef\.current/);
  assert.match(form, /\(dirty \|\| noteChanged\).*Đơn bán hàng có thay đổi chưa lưu/);
});

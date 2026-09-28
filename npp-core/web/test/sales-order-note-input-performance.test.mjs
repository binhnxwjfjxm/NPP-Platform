import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const form = readFileSync(new URL('../app/sales/sales-orders/SalesOrderCommercialForm.tsx', import.meta.url), 'utf8');

test('ghi chú là text tạm độc lập, gõ không cập nhật state hay kích hoạt logic đơn', () => {
  assert.match(form, /const OrderNoteField = memo/);
  assert.match(form, /const noteInitialRef = useRef\(version\?\.note \?\? ''\)/);
  assert.match(form, /const noteDraftRef = useRef\(version\?\.note \?\? ''\)/);
  assert.match(form, /defaultValue=\{draftRef\.current\}/);
  assert.match(form, /draftRef\.current = event\.currentTarget\.value/);
  assert.doesNotMatch(form, /const \[note, setNote\]/);
  assert.doesNotMatch(form, /setNote\(/);
  assert.doesNotMatch(form, /onBlur=\{commitNoteDraft\}|markNoteDirty|commitNoteDraft/);
});

test('ghi chú chỉ được đọc khi lưu và đổi khóa thao tác tại thời điểm lưu nếu nội dung đổi', () => {
  assert.match(form, /const noteValue = noteDraftRef\.current\.trim\(\)/);
  assert.match(form, /\.\.\.\(noteValue \? \{ note: noteValue \} : \{\}\)/);
  assert.match(form, /const noteValueAtSave = noteDraftRef\.current\.trim\(\)/);
  assert.match(form, /if \(noteValueAtSave !== noteAttemptValueRef\.current\)/);
  assert.match(form, /headers: \{ 'Idempotency-Key': requestSaveKey \}/);
  assert.match(form, /headers: \{ 'Idempotency-Key': requestConfirmKey \}/);
});

test('đóng form vẫn cảnh báo nếu chỉ sửa ghi chú mà chưa lưu', () => {
  assert.match(form, /const noteChanged = noteDraftRef\.current !== noteInitialRef\.current/);
  assert.match(form, /\(dirty \|\| noteChanged\).*Đơn bán hàng có thay đổi chưa lưu/);
});

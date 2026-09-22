import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL('../' + path, import.meta.url), 'utf8');
}

test('FACE attendance is available in Công Ty work policy UI and shared web types', async () => {
  const [types, policy] = await Promise.all([
    source('lib/workforce-types.ts'),
    source('app/workforce/policies/work-policy-workspace.tsx'),
  ]);

  assert.match(types, /attendance_method: 'QR' \| 'MANUAL' \| 'BOTH' \| 'FACE' \| 'QR_FACE' \| 'NONE'/);
  assert.match(types, /source: 'QR' \| 'FACE' \| 'MANUAL' \| 'ADJUSTMENT' \| 'SYSTEM'/);
  assert.match(policy, /FACE: 'Quét khuôn mặt'/);
  assert.match(policy, /QR_FACE: 'QR và quét khuôn mặt'/);
  assert.match(policy, /<option value="FACE">Quét khuôn mặt<\/option>/);
  assert.match(policy, /<option value="QR_FACE">QR và quét khuôn mặt<\/option>/);
});

test('Công Ty attendance screen explains FACE and keeps QR available for QR + FACE policy', async () => {
  const workspace = await source('app/workforce/attendance/attendance-workspace.tsx');

  assert.match(workspace, /FACE: 'Quét khuôn mặt tại máy chấm công'/);
  assert.match(workspace, /QR_FACE: 'Quét mã QR hoặc quét khuôn mặt'/);
  assert.match(workspace, /attendanceMethod === 'QR_FACE'/);
  assert.match(workspace, /attendanceMethod === 'FACE'.*attendanceMethod === 'QR_FACE'/s);
  assert.match(workspace, /data-testid="attendance-face-method"/);
  assert.match(workspace, /Nhân sự không cần chọn tên hoặc nhập giờ trên trình duyệt/);
});

test('Bảng công renders FACE as office-language attendance source', async () => {
  const workspace = await source('app/workforce/timesheet/attendance-timesheet-workspace.tsx');
  assert.match(workspace, /FACE: 'Quét khuôn mặt'/);
  assert.match(workspace, /Máy chấm công khuôn mặt/);
});

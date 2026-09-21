import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL('../' + path, import.meta.url), 'utf8');
}

test('Lô B exposes presence-only as an office-language policy option', async () => {
  const workspace = await source('app/workforce/policies/work-policy-workspace.tsx');

  assert.match(workspace, /Cách ghi nhận công/);
  assert.match(workspace, /Theo thời gian vào \/ ra/);
  assert.match(workspace, /Chỉ xác nhận có mặt/);
  assert.match(workspace, /Bảng công không (?:dùng|lấy) số phút làm việc để tính công/);
});

test('Lô B attendance UI requires a reason before leaving the workplace', async () => {
  const workspace = await source('app/workforce/attendance/attendance-workspace.tsx');

  assert.match(workspace, /Kết thúc làm việc \/ Đi về/);
  assert.match(workspace, /Ra ngoài làm công việc/);
  assert.match(workspace, /Ra ngoài việc cá nhân/);
  assert.match(workspace, /Nghỉ giữa ca/);
  assert.match(workspace, /Lý do khác/);
  assert.match(workspace, /nextAction === 'EXIT'/);
  assert.match(workspace, /nextAction === 'RETURN'/);
  assert.match(workspace, /exitSelectionReady/);
});

test('Lô B QR rotates only while displayed and can be explicitly closed', async () => {
  const workspace = await source('app/workforce/attendance/attendance-workspace.tsx');

  assert.match(workspace, /if \(!qrToken\) return undefined/);
  assert.match(workspace, /getTime\(\) - Date\.now\(\) - 15_000/);
  assert.match(workspace, /Tắt mã QR/);
  assert.match(workspace, /onClick=\{\(\) => setQrToken\(null\)\}/);
});

test('Lô B uses office labels for movement events and presence-only attendance', async () => {
  const [workspace, types, timesheet] = await Promise.all([
    source('app/workforce/attendance/attendance-workspace.tsx'),
    source('lib/workforce-types.ts'),
    source('app/workforce/timesheet/attendance-timesheet-workspace.tsx'),
  ]);

  assert.match(types, /'CHECK_IN' \| 'TEMP_EXIT' \| 'RETURN' \| 'CHECK_OUT'/);
  assert.match(types, /attendance_basis: 'TIME' \| 'PRESENCE' \| 'NONE'/);
  assert.match(workspace, /Quay lại nơi làm việc/);
  assert.match(workspace, /chỉ xác nhận có mặt/);
  assert.match(timesheet, /OUTSIDE: 'Đang ra ngoài'/);
});

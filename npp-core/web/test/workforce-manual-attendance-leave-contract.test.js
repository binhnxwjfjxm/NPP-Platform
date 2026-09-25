import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL('../' + path, import.meta.url), 'utf8');
}

test('manager can choose a worker and record attendance now without typing the time', async () => {
  const [workspace, attendance] = await Promise.all([
    source('app/workforce/adjustments/attendance-adjustment-workspace.tsx'),
    source('app/workforce/attendance/attendance-workspace.tsx'),
  ]);
  assert.match(workspace, /Chấm công tay và điều chỉnh công/);
  assert.match(workspace, /recordNowAction: quickAction/);
  assert.match(workspace, /Chấm vào ngay/);
  assert.match(workspace, /Chấm ra ngay/);
  assert.match(workspace, /giờ hiện tại từ máy chủ/);
  assert.match(attendance, /Mở Chấm công tay và điều chỉnh công/);
});

test('HR can record a paper leave form with employee selection and R2 document upload', async () => {
  const [workspace, gateway, manualRoute, attachmentRoute] = await Promise.all([
    source('app/workforce/leave/leave-workspace.tsx'),
    source('lib/workforce-gateway.ts'),
    source('app/api/workforce/leave/requests/manual/route.ts'),
    source('app/api/workforce/leave/attachments/route.ts'),
  ]);
  assert.match(workspace, /Ghi nhận phiếu nghỉ giấy/);
  assert.match(workspace, /Phiếu giấy \/ nhập thủ công/);
  assert.match(workspace, /data\?\.employees/);
  assert.match(workspace, /paperApproved/);
  assert.match(workspace, /Ảnh\/PDF phiếu giấy/);
  assert.match(workspace, /web-leave-document-upload/);
  assert.match(gateway, /submitManualLeaveRequest/);
  assert.match(gateway, /leave-request-manual/);
  assert.match(manualRoute, /submitManualLeaveRequest/);
  assert.match(attachmentRoute, /method: 'PUT'/);
  assert.match(attachmentRoute, /Idempotency-Key/);
});

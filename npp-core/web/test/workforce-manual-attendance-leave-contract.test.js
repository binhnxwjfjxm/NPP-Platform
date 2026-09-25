import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL('../' + path, import.meta.url), 'utf8');
}

test('manager records manual attendance only on the Attendance screen without reason', async () => {
  const [attendance, adjustment, gateway, route] = await Promise.all([
    source('app/workforce/attendance/attendance-workspace.tsx'),
    source('app/workforce/adjustments/attendance-adjustment-workspace.tsx'),
    source('lib/workforce-gateway.ts'),
    source('app/api/workforce/attendance/[action]/route.ts'),
  ]);
  assert.match(attendance, /data-testid="managed-manual-attendance"/);
  assert.match(attendance, />Chấm vào</);
  assert.match(attendance, />Chấm ra</);
  assert.match(attendance, /Không cần nhập thời gian hoặc lý do/);
  assert.match(attendance, /web-attendance-managed-manual/);
  assert.doesNotMatch(adjustment, /Chấm công tay và điều chỉnh công/);
  assert.doesNotMatch(adjustment, /recordNowAction/);
  assert.match(adjustment, /Điều chỉnh giờ đã ghi nhận/);
  assert.match(gateway, /attendance-managed-manual/);
  assert.match(route, /params\.action === 'manual'/);
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

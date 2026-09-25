import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL('../' + path, import.meta.url), 'utf8');
}

test('manager attendance screen is search-first, state-aware, and keeps QR in the header', async () => {
  const [attendance, adjustment, gateway, route] = await Promise.all([
    source('app/workforce/attendance/attendance-workspace.tsx'),
    source('app/workforce/adjustments/attendance-adjustment-workspace.tsx'),
    source('lib/workforce-gateway.ts'),
    source('app/api/workforce/attendance/[action]/route.ts'),
  ]);
  assert.match(attendance, /Chấm công nhân sự/);
  assert.match(attendance, /Tìm nhân sự/);
  assert.match(attendance, /managed-employee-search-results/);
  assert.match(attendance, /Chọn nhiều nhân sự/);
  assert.match(attendance, /managed-attendance-bulk-picker/);
  assert.match(attendance, /managed-attendance-bulk-workspace/);
  assert.match(attendance, /Nhập mã, tên hoặc chi nhánh/);
  assert.match(attendance, /\/api\/workforce\/attendance\/manual-bulk/);
  assert.match(attendance, /web-attendance-managed-manual-bulk/);
  assert.match(attendance, /Mục đích ra ngoài chung/);
  assert.match(attendance, /Nhân sự không phù hợp trạng thái sẽ không bị chuyển sang hành động khác/);
  assert.match(attendance, /onBlur=\{\(\) => window\.setTimeout\(\(\) => setManagedSearchOpen\(false\), 0\)\}/);
  assert.match(attendance, /attendance-qr-toggle/);
  assert.match(attendance, /attendance-qr-popover/);
  assert.match(attendance, /!managedEmployees && today/);
  assert.match(attendance, /actionButtonPrimary/);
  assert.doesNotMatch(attendance, /attendance-qr-header-action/);
  assert.doesNotMatch(attendance, /managedAttendance\.tooSoon/);
  assert.match(attendance, /Kết thúc làm việc/);
  assert.match(attendance, /Ghi nhận ra ngoài/);
  assert.match(attendance, /Quay lại/);
  assert.match(attendance, /Lịch sử hôm nay/);
  assert.match(attendance, /statusGroup/);
  assert.match(attendance, /Thiếu chính sách tính công/);
  assert.match(attendance, /Trạng thái chấm công vẫn được ghi nhận theo thao tác thực tế/);
  assert.match(attendance, /href="\/workforce\/employees"/);
  assert.doesNotMatch(attendance, /href="\/workforce\/policies">Gắn chính sách/);
  assert.match(attendance, /Chấm công của tôi/);
  assert.match(attendance, /employeeId=\$\{encodeURIComponent\(employeeId\)\}/);
  assert.doesNotMatch(attendance, /<h2>Chấm công hôm nay<\/h2>/);
  assert.doesNotMatch(attendance, /<h2>Mã QR theo nơi làm việc<\/h2>/);
  assert.doesNotMatch(adjustment, /Chấm công tay và điều chỉnh công/);
  assert.doesNotMatch(adjustment, /recordNowAction/);
  assert.match(adjustment, /Điều chỉnh giờ đã ghi nhận/);
  assert.match(gateway, /attendance-managed-manual/);
  assert.match(gateway, /attendance-managed-manual-bulk/);
  assert.match(gateway, /\/attendance\/manual\/bulk/);
  assert.match(route, /params\.action === 'manual'/);
  assert.match(route, /params\.action === 'manual-bulk'/);
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

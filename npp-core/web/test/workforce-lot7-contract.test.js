import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL('../' + path, import.meta.url), 'utf8');
}

test('Issue #1110 Lô 7 adds Nghỉ và đơn nghỉ to Nhân sự navigation', async () => {
  const shell = await source('app/components/app-shell-core.tsx');
  assert.match(shell, /href: '\/workforce\/leave'.*label: 'Nghỉ và đơn nghỉ'.*testId: 'nav-workforce-leave'/);
});

test('Issue #1110 Lô 7 web gateway keeps canonical Idempotency-Key for every leave mutation', async () => {
  const [gateway, typeRoute, typeUpdateRoute, requestRoute, reviewRoute, cancelRoute] = await Promise.all([
    source('lib/workforce-gateway.ts'),
    source('app/api/workforce/leave-types/route.ts'),
    source('app/api/workforce/leave-types/update/route.ts'),
    source('app/api/workforce/leave/requests/route.ts'),
    source('app/api/workforce/leave/requests/review/route.ts'),
    source('app/api/workforce/leave/requests/cancel/route.ts'),
  ]);

  assert.match(gateway, /mutationKey\(idempotencyKey, 'leave-type-create'\)/);
  assert.match(gateway, /mutationKey\(idempotencyKey, 'leave-type-update'\)/);
  assert.match(gateway, /mutationKey\(idempotencyKey, 'leave-request-submit'\)/);
  assert.match(gateway, /mutationKey\(idempotencyKey, 'leave-request-review'\)/);
  assert.match(gateway, /mutationKey\(idempotencyKey, 'leave-request-cancel'\)/);
  for (const route of [typeRoute, typeUpdateRoute, requestRoute, reviewRoute, cancelRoute]) {
    assert.match(route, /request\.headers\.get\('idempotency-key'\)/);
  }
});

test('Issue #1110 Lô 7 renders employee request and manager approval in office language', async () => {
  const workspace = await source('app/workforce/leave/leave-workspace.tsx');
  assert.match(workspace, /title="Nghỉ và đơn nghỉ"/);
  assert.match(workspace, /Gửi đơn nghỉ của tôi/);
  assert.match(workspace, /Nửa ca đầu/);
  assert.match(workspace, /Nửa ca sau/);
  assert.match(workspace, />Duyệt</);
  assert.match(workspace, />Từ chối</);
  assert.match(workspace, /Hủy đơn/);
  assert.match(workspace, /Chế độ nghỉ/);
  assert.match(workspace, /Hưởng lương/);
  assert.match(workspace, /Tính ngày công/);
  assert.match(workspace, /Cần duyệt/);
  assert.match(workspace, /Cần chứng từ/);
  assert.match(workspace, /createIdempotencyKey/);
  assert.doesNotMatch(workspace, /payroll|Payroll/);
});

test('Issue #1110 Lô 7 blocks invalid request shape in UI and warns without blocking valid unusual policy choices', async () => {
  const workspace = await source('app/workforce/leave/leave-workspace.tsx');
  assert.match(workspace, /Nghỉ nửa ngày chỉ áp dụng cho một ngày/);
  assert.match(workspace, /Chế độ nghỉ này không cho phép nghỉ cả ngày/);
  assert.match(workspace, /Chế độ nghỉ này không cho phép nghỉ nửa ngày/);
  assert.match(workspace, /Chế độ nghỉ này yêu cầu thông tin chứng từ/);
  assert.match(workspace, /Bạn vẫn có thể lưu nếu đây là chính sách của Công Ty/);
  assert.match(workspace, /tự động duyệt khi nhân viên gửi đơn/);
});

test('Issue #1110 Lô 7 does not invent leave balance when Lô 6 has no canonical balance contract', async () => {
  const [types, page, workspace] = await Promise.all([
    source('lib/workforce-types.ts'),
    source('app/workforce/leave/page.tsx'),
    source('app/workforce/leave/leave-workspace.tsx'),
  ]);
  assert.match(types, /LeaveType/);
  assert.match(types, /LeaveRequestListResponse/);
  assert.match(page, /listLeaveRequests/);
  assert.match(page, /listLeaveTypes/);
  assert.doesNotMatch(workspace, /Số dư phép|leaveBalance|remainingBalance/);
});

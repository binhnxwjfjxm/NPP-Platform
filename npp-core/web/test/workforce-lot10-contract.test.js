import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL('../' + path, import.meta.url), 'utf8');
}

test('Issue #1110 Lô 10 adds Xử lý vi phạm công to workforce navigation', async () => {
  const shell = await source('app/components/app-shell-core.tsx');
  assert.match(shell, /href: '\/workforce\/violations'.*Xử lý vi phạm công/);
  assert.match(shell, /nav-workforce-violations/);
});

test('Issue #1110 Lô 10 gateway and API routes forward canonical idempotency keys', async () => {
  const [gateway, listRoute, explainRoute, reviewRoute] = await Promise.all([
    source('lib/workforce-gateway.ts'),
    source('app/api/workforce/violations/route.ts'),
    source('app/api/workforce/violations/explain/route.ts'),
    source('app/api/workforce/violations/review/route.ts'),
  ]);

  assert.match(gateway, /attendance-violation-explain/);
  assert.match(gateway, /attendance-violation-review/);
  assert.match(gateway, /mutationKey\(idempotencyKey, 'attendance-violation-explain'\)/);
  assert.match(gateway, /mutationKey\(idempotencyKey, 'attendance-violation-review'\)/);
  assert.match(listRoute, /listAttendanceViolations/);
  assert.match(explainRoute, /headers\.get\('idempotency-key'\)/);
  assert.match(reviewRoute, /headers\.get\('idempotency-key'\)/);
});

test('Issue #1110 Lô 10 provides explanation, review and conclusion workflow in office language', async () => {
  const workspace = await source('app/workforce/violations/attendance-violation-workspace.tsx');

  assert.match(workspace, /Gửi giải trình/);
  assert.match(workspace, /Bắt đầu xem xét/);
  assert.match(workspace, /Kết luận/);
  assert.match(workspace, /Chấp nhận giải trình/);
  assert.match(workspace, /Xác nhận vi phạm/);
  assert.match(workspace, /Kết luận xử lý/);
  assert.match(workspace, /Dữ liệu công hiện tại đã thay đổi/);
});

test('Issue #1110 Lô 10 makes handling workflow explicit without mutating pay or attendance events', async () => {
  const [workspace, types] = await Promise.all([
    source('app/workforce/violations/attendance-violation-workspace.tsx'),
    source('lib/workforce-types.ts'),
  ]);

  assert.match(types, /AttendanceViolationCase/);
  assert.match(types, /EXPLANATION_SUBMITTED/);
  assert.match(types, /UNDER_REVIEW/);
  assert.match(types, /RESOLVED/);
  assert.match(workspace, /không sửa sự kiện chấm công/);
  assert.match(workspace, /không tự điều chỉnh thu nhập/);
  assert.doesNotMatch(workspace, /phạt tiền|trừ tiền|penalty amount|salary deduction/i);
});

test('Issue #1110 Lô 10 links Bảng công violation detail to the handling workspace', async () => {
  const timesheet = await source('app/workforce/timesheet/attendance-timesheet-workspace.tsx');
  assert.match(timesheet, /href="\/workforce\/violations"/);
  assert.match(timesheet, /Mở xử lý vi phạm/);
});

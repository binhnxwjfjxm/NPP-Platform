import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL('../' + path, import.meta.url), 'utf8');
}

test('Issue #1110 Lô 5 adds Điều chỉnh công to Nhân sự navigation', async () => {
  const shell = await source('app/components/app-shell-core.tsx');
  assert.match(shell, /href: '\/workforce\/adjustments'.*label: 'Điều chỉnh công'.*testId: 'nav-attendance-adjustments'/);
});

test('Issue #1110 Lô 5 web gateway keeps canonical Idempotency-Key for every mutation', async () => {
  const [gateway, selfRoute, reviewRoute, directRoute, lockRoute] = await Promise.all([
    source('lib/workforce-gateway.ts'),
    source('app/api/workforce/adjustments/route.ts'),
    source('app/api/workforce/adjustments/review/route.ts'),
    source('app/api/workforce/adjustments/direct/route.ts'),
    source('app/api/workforce/period-locks/route.ts'),
  ]);

  assert.match(gateway, /mutationKey\(idempotencyKey, 'attendance-adjustment-submit'\)/);
  assert.match(gateway, /mutationKey\(idempotencyKey, 'attendance-adjustment-review'\)/);
  assert.match(gateway, /mutationKey\(idempotencyKey, 'attendance-adjustment-direct'\)/);
  assert.match(gateway, /mutationKey\(idempotencyKey, 'attendance-period-lock'\)/);
  for (const route of [selfRoute, reviewRoute, directRoute, lockRoute]) {
    assert.match(route, /request\.headers\.get\('idempotency-key'\)/);
  }
});

test('Issue #1110 Lô 5 renders request, approval, direct adjustment and period locking in office language', async () => {
  const workspace = await source('app/workforce/adjustments/attendance-adjustment-workspace.tsx');
  assert.match(workspace, /title="Điều chỉnh công"/);
  assert.match(workspace, /Gửi yêu cầu của tôi/);
  assert.match(workspace, />Duyệt</);
  assert.match(workspace, />Từ chối</);
  assert.match(workspace, /Điều chỉnh trực tiếp/);
  assert.match(workspace, /Khóa kỳ công/);
  assert.match(workspace, /Lý do xác nhận/);
  assert.match(workspace, /createIdempotencyKey/);
  assert.doesNotMatch(workspace, /payroll|Payroll/);
});

test('Issue #1110 Lô 5 surfaces adjustment and lock state directly on Bảng công', async () => {
  const timesheet = await source('app/workforce/timesheet/attendance-timesheet-workspace.tsx');
  assert.match(timesheet, /Kiểm soát/);
  assert.match(timesheet, /Đã khóa kỳ/);
  assert.match(timesheet, /Điều chỉnh: Chờ duyệt/);
  assert.match(timesheet, /\/workforce\/adjustments\?employeeId=/);
  assert.match(timesheet, /Yêu cầu điều chỉnh/);
  assert.match(timesheet, /row\.adjustedDays/);
  assert.match(timesheet, /row\.lockedDays/);
});

test('Issue #1110 Lô 5 keeps period and employee scope bounded on the server page', async () => {
  const page = await source('app/workforce/adjustments/page.tsx');
  assert.match(page, /limit: '50'/);
  assert.match(page, /employeeId\?\.trim\(\)/);
  assert.match(page, /listAttendancePeriodLocks/);
});


test('attendance management lets managers choose an employee for direct attendance correction', () => {
  const workspace = source('app/workforce/adjustments/attendance-adjustment-workspace.tsx');
  assert.match(workspace, /requestJson<Employee\[]>\('\/api\/access\/employees\?limit=1000'\)/);
  assert.match(workspace, /value=\{directEmployeeId\}/);
  assert.match(workspace, /employeeId: directEmployeeId/);
  assert.doesNotMatch(workspace, /targetEmployeeId = initialEmployeeId/);
});

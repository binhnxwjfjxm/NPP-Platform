import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL('../' + path, import.meta.url), 'utf8');
}

test('Issue #1110 Lô 8 exposes the canonical timesheet states without adding mutations', async () => {
  const [types, workspace, route] = await Promise.all([
    source('lib/workforce-types.ts'),
    source('app/workforce/timesheet/attendance-timesheet-workspace.tsx'),
    source('app/api/workforce/timesheet/route.ts'),
  ]);

  for (const state of ['APPROVED_LEAVE', 'PENDING_LEAVE', 'PENDING_ADJUSTMENT', 'UNEXCUSED_ABSENCE']) {
    assert.match(types, new RegExp(state));
    assert.match(workspace, new RegExp(state));
  }
  assert.match(workspace, /case 'UPCOMING': return ''/);
  assert.match(workspace, /Vắng không phép/);
  assert.match(workspace, /Chờ duyệt nghỉ/);
  assert.match(workspace, /Chờ duyệt điều chỉnh/);
  assert.doesNotMatch(route, /export async function POST|Idempotency-Key/);
});

test('Issue #1110 Lô 8 monthly matrix separates Nghỉ, Phép, Vắng, Thiếu and pending work', async () => {
  const workspace = await source('app/workforce/timesheet/attendance-timesheet-workspace.tsx');

  assert.match(workspace, />Nghỉ<\/strong> Lịch không phải làm/);
  assert.match(workspace, />Phép<\/strong> Nghỉ đã được duyệt/);
  assert.match(workspace, />Vắng<\/strong> Phải làm nhưng không có công hoặc phép/);
  assert.match(workspace, />Thiếu<\/strong> Có công nhưng chưa đủ/);
  assert.match(workspace, />Chờ<\/strong> Đơn nghỉ đang chờ duyệt/);
  assert.match(workspace, /row\.approvedLeaveDays/);
  assert.match(workspace, /row\.pendingLeaveDays/);
  assert.match(workspace, /row\.unexcusedAbsenceDays/);
  assert.match(workspace, /row\.incompleteDays/);
  assert.match(workspace, /row\.configurationIssueDays/);
  assert.match(workspace, /row\.scheduledDaysOff/);
});

test('Issue #1110 Lô 8 day detail shows shift segment, leave, counted leave and control facts', async () => {
  const workspace = await source('app/workforce/timesheet/attendance-timesheet-workspace.tsx');

  assert.match(workspace, /Phần phải làm/);
  assert.match(workspace, /Phần được nghỉ/);
  assert.match(workspace, /Được tính từ nghỉ/);
  assert.match(workspace, /leaveCreditedMinutes/);
  assert.match(workspace, /leaveSegmentLabel/);
  assert.match(workspace, /leaveSummary/);
  assert.match(workspace, /href="\/workforce\/leave"/);
  assert.match(workspace, /Đánh giá vi phạm/);
  assert.match(workspace, /violationEvaluation/);
});

test('Issue #1110 Lô 8 uses office language and keeps payroll/penalty outside the timesheet engine', async () => {
  const workspace = await source('app/workforce/timesheet/attendance-timesheet-workspace.tsx');
  assert.match(workspace, /Đây chưa phải dữ liệu tính lương/);
  assert.doesNotMatch(workspace, /phạt tiền|trừ tiền|salary deduction|payroll mutation/i);
});

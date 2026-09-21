import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL('../' + path, import.meta.url), 'utf8');
}

test('Issue #1110 Lô 9 exposes derived violation facts on Bảng công', async () => {
  const [types, workspace] = await Promise.all([
    source('lib/workforce-types.ts'),
    source('app/workforce/timesheet/attendance-timesheet-workspace.tsx'),
  ]);

  for (const kind of ['LATE', 'EARLY_LEAVE', 'MISSING_ATTENDANCE', 'UNEXCUSED_ABSENCE']) {
    assert.match(types, new RegExp(kind));
  }
  assert.match(types, /AttendanceViolationEvaluation/);
  assert.match(workspace, /<th>Vi phạm<\/th>/);
  assert.match(workspace, /violationSummary/);
  assert.match(workspace, /monthlyViolationSummary/);
  assert.match(workspace, /selectedDay\.violationEvaluation\.items/);
  assert.match(workspace, /Đánh giá vi phạm/);
});

test('Issue #1110 Lô 9 keeps pending leave and pending adjustment non-final in the UI contract', async () => {
  const [types, workspace] = await Promise.all([
    source('lib/workforce-types.ts'),
    source('app/workforce/timesheet/attendance-timesheet-workspace.tsx'),
  ]);

  assert.match(types, /PENDING_LEAVE/);
  assert.match(types, /PENDING_ADJUSTMENT/);
  assert.match(workspace, /violationEvaluation\.explanation/);
});

test('Issue #1110 Lô 9 reuses Work Policy thresholds with office-language labels', async () => {
  const policy = await source('app/workforce/policies/work-policy-workspace.tsx');

  assert.match(policy, /Ngưỡng ghi nhận đi trễ \(phút\)/);
  assert.match(policy, /Ngưỡng ghi nhận về sớm \(phút\)/);
  assert.match(policy, /Bảng công không tự điều chỉnh thu nhập/);
  assert.doesNotMatch(policy, /penalty|payroll|salary deduction/i);
});

test('Issue #1110 Lô 9 remains read-only and does not create a punishment mutation', async () => {
  const [workspace, route] = await Promise.all([
    source('app/workforce/timesheet/attendance-timesheet-workspace.tsx'),
    source('app/api/workforce/timesheet/route.ts'),
  ]);

  assert.match(workspace, /Kết quả này dùng để theo dõi và xử lý theo quy trình Công Ty/);
  assert.doesNotMatch(workspace, /phạt tiền|trừ tiền|penalty amount|salary deduction/i);
  assert.doesNotMatch(route, /export async function POST|Idempotency-Key/);
});

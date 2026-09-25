import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL('../' + path, import.meta.url), 'utf8');
}

test('Issue #1140 Lô 1 shows effective-dated employment and transfer history in office language', async () => {
  const [workspace, types] = await Promise.all([
    source('app/workforce/employees/employee-workspace.tsx'),
    source('lib/employee-types.ts'),
  ]);

  assert.match(workspace, /Ngày bắt đầu làm việc/);
  assert.match(workspace, /Hình thức lao động/);
  assert.match(workspace, /Lịch sử lao động/);
  assert.match(workspace, /Lịch sử điều chuyển/);
  assert.match(workspace, /Chờ Nhân sự xác nhận/);
  assert.match(workspace, /employee-employment-history/);
  assert.match(workspace, /employee-assignment-history/);
  assert.match(workspace, /employmentEffectiveFrom/);
  assert.match(workspace, /assignmentEffectiveFrom/);
  assert.match(types, /EmployeeEmployment/);
  assert.match(types, /EmployeeAssignment/);
  assert.match(types, /LEGACY_CURRENT_ONLY/);
});

test('Issue #1140 Lô 1 requires an effective date and reason for employment status changes', async () => {
  const workspace = await source('app/workforce/employees/employee-workspace.tsx');

  assert.match(workspace, /employmentEffectiveDate: toggleState\.effectiveDate/);
  assert.match(workspace, /employmentReason: toggleState\.reason\.trim/);
  assert.match(workspace, /Ngày hiệu lực/);
  assert.match(workspace, /Lý do/);
});

test('Nhân sự allows replacing a policy assignment on the same effective date', async () => {
  const workspace = await source('app/workforce/employees/employee-workspace.tsx');
  assert.match(workspace, /return latestFrom < today \? today : latestFrom/);
  assert.doesNotMatch(workspace, /return latestFrom < today \? today : nextDate\(latestFrom\)/);
});

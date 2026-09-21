import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL('../' + path, import.meta.url), 'utf8');
}

test('Issue #1110 Lô A shows policy coverage and bulk assignment in the employee workspace', async () => {
  const [page, workspace] = await Promise.all([
    source('app/workforce/employees/page.tsx'),
    source('app/workforce/employees/employee-workspace.tsx'),
  ]);

  assert.match(page, /getWorkPolicyCoverage/);
  assert.match(workspace, /Chưa có chính sách/);
  assert.match(workspace, /Áp dụng chính sách hàng loạt/);
  assert.match(workspace, /Nhân sự chưa có chính sách/);
  assert.match(workspace, /Toàn bộ nhân sự đang làm việc/);
  assert.match(workspace, /Theo chi nhánh/);
  assert.match(workspace, /Danh sách đang lọc/);
});

test('Issue #1110 Lô A requires policy assignment when creating staff in the workforce UI', async () => {
  const workspace = await source('app/workforce/employees/employee-workspace.tsx');

  assert.match(workspace, /employee-create-policy-select/);
  assert.match(workspace, /workPolicyId: createPolicyId/);
  assert.match(workspace, /policyEffectiveFrom: createPolicyEffectiveFrom/);
  assert.match(workspace, /Chưa có chính sách làm việc đang hoạt động/);
});

test('Issue #1110 Lô A makes historical bootstrap explicit and canonical-idempotent', async () => {
  const [workspace, gateway, route] = await Promise.all([
    source('app/workforce/employees/employee-workspace.tsx'),
    source('lib/workforce-gateway.ts'),
    source('app/api/workforce/assignments/bulk/route.ts'),
  ]);

  assert.match(workspace, /Khởi tạo chính sách ban đầu cho giai đoạn trước/);
  assert.match(workspace, /không được áp dụng dở dang/i);
  assert.match(gateway, /employee-policy-bulk-assign/);
  assert.match(gateway, /mutationKey\(idempotencyKey, 'employee-policy-bulk-assign'\)/);
  assert.match(route, /headers\.get\('idempotency-key'\)/);
});

test('Issue #1110 Lô A fixes the work-day checkbox layout instead of inheriting full-width input styling', async () => {
  const [workspace, css] = await Promise.all([
    source('app/workforce/policies/work-policy-workspace.tsx'),
    source('app/workforce/policies/work-policy.module.css'),
  ]);

  assert.match(workspace, /workingDaysFieldset/);
  assert.match(workspace, /workingDaysGrid/);
  assert.match(workspace, /workingDayOption/);
  assert.match(css, /grid-template-columns: repeat\(4/);
  assert.match(css, /input\[type='checkbox'\]/);
  assert.match(css, /width: 18px !important/);
});

test('Issue #1110 Lô A presents missing policy as configuration work, not a red attendance violation', async () => {
  const workspace = await source('app/workforce/timesheet/attendance-timesheet-workspace.tsx');

  assert.match(workspace, /case 'MISSING_POLICY': return 'Thiếu CS'/);
  assert.match(workspace, /day\.status === 'MISSING_POLICY'.*return 'warn'/s);
  assert.match(workspace, /Nhân sự chưa có Chính sách làm việc hiệu lực tại ngày này/);
  assert.match(workspace, /href="\/workforce\/employees"/);
  assert.match(workspace, /case 'UPCOMING': return ''/);
  assert.doesNotMatch(workspace, /case 'MISSING_POLICY': return 'Lỗi CS'/);
});

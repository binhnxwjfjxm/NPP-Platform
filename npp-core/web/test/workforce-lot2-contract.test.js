import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('Issue #1110 Lô 2 separates Nhân sự navigation from Người dùng & phân quyền', async () => {
  const shell = await source('app/components/app-shell-core.tsx');
  const legacy = await source('app/access/employees/page.tsx');

  assert.match(shell, /const workforceItems/);
  assert.match(shell, /href: '\/workforce\/employees'.*Danh mục nhân sự/);
  assert.match(shell, /href: '\/workforce\/schedules'.*Ca \/ lịch làm việc/);
  assert.match(shell, /href: '\/workforce\/policies'.*Chính sách làm việc/);
  assert.match(shell, /title: 'Người dùng & phân quyền'/);
  const accessBlock = shell.match(/const accessItems:[\s\S]*?\n\];/)?.[0] ?? '';
  assert.ok(accessBlock.length > 0);
  assert.doesNotMatch(accessBlock, /Danh mục nhân sự/);
  assert.match(legacy, /redirect\('\/workforce\/employees'\)/);
});

test('Issue #1110 Lô 2 uses canonical idempotency generation in workforce and employee mutation producers', async () => {
  const [gateway, employees, policies, schedules, employeeGateway] = await Promise.all([
    source('lib/workforce-gateway.ts'),
    source('app/workforce/employees/employee-workspace.tsx'),
    source('app/workforce/policies/work-policy-workspace.tsx'),
    source('app/workforce/schedules/work-schedule-workspace.tsx'),
    source('lib/employee-gateway.ts'),
  ]);

  for (const text of [gateway, employees, policies, schedules, employeeGateway]) {
    assert.match(text, /from '@npp\/contracts'/);
  }
  assert.match(employees, /createIdempotencyKey\(operation\)/);
  assert.match(policies, /createIdempotencyKey\('web-work-policy-save'\)/);
  assert.match(schedules, /createIdempotencyKey\('web-work-schedule-save'\)/);
  assert.doesNotMatch(employees, /web-\$\{crypto\.randomUUID/);
  assert.match(employeeGateway, /patchEmployee.*idempotencyKey/s);
});

test('Issue #1110 Lô 2 exposes employee policy history and future-only schedule management in office language', async () => {
  const [employees, policies, schedules] = await Promise.all([
    source('app/workforce/employees/employee-workspace.tsx'),
    source('app/workforce/policies/work-policy-workspace.tsx'),
    source('app/workforce/schedules/work-schedule-workspace.tsx'),
  ]);

  assert.match(employees, /Chính sách làm việc/);
  assert.match(employees, /Lịch sử hiệu lực/);
  assert.match(employees, /employee-policy-history/);
  assert.match(employees, /assignmentMinimumDate/);
  assert.match(employees, /min=\{policyAssignmentMinDate\}/);
  assert.match(policies, /Toàn bộ phiên bản/);
  assert.match(policies, /Cập nhật chính sách/);
  assert.match(schedules, /Lịch trong hôm nay và quá khứ chỉ dùng để đối chiếu/);
  assert.match(schedules, /Ca \/ lịch làm việc/);
  assert.match(schedules, /expectedUpdatedAt/);
  assert.match(schedules, /zonedLocalToIso/);
});


test('Issue #1110 keeps effective-date UI comparisons on canonical calendar dates', async () => {
  const [employees, policies] = await Promise.all([
    source('app/workforce/employees/employee-workspace.tsx'),
    source('app/workforce/policies/work-policy-workspace.tsx'),
  ]);

  assert.match(employees, /function effectiveDate/);
  assert.match(employees, /bulkDraft\.effectiveFrom < policyEffectiveFrom/);
  assert.match(employees, /dateLabel\(assignment\.effective_from\)/);
  assert.match(policies, /dateLabel\(policy\.effective_from\)/);
});

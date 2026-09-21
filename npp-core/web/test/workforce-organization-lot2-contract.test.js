import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL('../' + path, import.meta.url), 'utf8');
}

test('Issue #1140 Lô 2 keeps organization inside the employee workspace instead of adding a new top-level tab', async () => {
  const workspace = await source('app/workforce/employees/employee-workspace.tsx');

  assert.match(workspace, /Cơ cấu tổ chức/);
  assert.match(workspace, /Phòng\/Bộ phận/);
  assert.match(workspace, /Vị trí công việc/);
  assert.match(workspace, /Quản lý trực tiếp/);
  assert.match(workspace, /employee-department-select/);
  assert.match(workspace, /employee-position-select/);
  assert.match(workspace, /employee-manager-select/);
  assert.match(workspace, /Lịch sử điều chuyển/);
});

test('Issue #1140 Lô 2 web organization mutations use the shared canonical idempotency generator', async () => {
  const [workspace, gateway, route] = await Promise.all([
    source('app/workforce/employees/employee-workspace.tsx'),
    source('lib/employee-gateway.ts'),
    source('app/api/access/employees/organization/route.ts'),
  ]);

  assert.match(workspace, /mutationKeyForPayload\(organizationSaveAttempt, 'web-employee-organization-save'/);
  assert.match(gateway, /createIdempotencyKey\(/);
  assert.match(gateway, /employee-organization-save/);
  assert.match(route, /idempotency-key/);
  assert.match(route, /saveEmployeeOrganization/);
});

test('Issue #1140 Lô 2 employee types expose canonical department, position and manager fields', async () => {
  const types = await source('lib/employee-types.ts');

  assert.match(types, /HrDepartment/);
  assert.match(types, /HrPosition/);
  assert.match(types, /EmployeeOrganizationCatalog/);
  assert.match(types, /department_id/);
  assert.match(types, /position_id/);
  assert.match(types, /manager_employee_id/);
});

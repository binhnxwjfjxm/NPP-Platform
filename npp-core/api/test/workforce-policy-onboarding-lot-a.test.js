import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL('../' + path, import.meta.url), 'utf8');
}

test('Issue #1110 Lô A reads effective policy coverage for active employees in scope', async () => {
  const repository = await source('src/db/repositories/workforce.js');

  assert.match(repository, /export async function listEmployeePolicyCoverage/);
  assert.match(repository, /e\.is_active = true/);
  assert.match(repository, /LEFT JOIN LATERAL/);
  assert.match(repository, /a\.effective_from <= \$2::date/);
  assert.match(repository, /p\.effective_from <= \$2::date/);
  assert.match(repository, /e\.branch_id = \$\$\{params\.length\}/);
  assert.match(repository, /e\.id = ANY\(\$\$\{params\.length\}::uuid\[\]\)/);
});

test('Issue #1110 Lô A bulk policy assignment preflights the whole batch before writing', async () => {
  const service = await source('src/services/workforce.js');

  assert.match(service, /export async function assignWorkPolicyBulk/);
  assert.match(service, /ALL_ACTIVE/);
  assert.match(service, /BRANCH/);
  assert.match(service, /EMPLOYEES/);
  assert.match(service, /lock: 'update'/);
  assert.match(service, /BOOTSTRAP_REASON_REQUIRED/);
  assert.match(service, /BOOTSTRAP_ASSIGNMENT_EXISTS/);
  assert.match(service, /POLICY_NOT_EFFECTIVE/);
  assert.ok(service.indexOf('const plans = [];') < service.indexOf('const assignments = [];'));
});

test('Issue #1110 Lô A only permits retroactive assignment as audited first-time bootstrap', async () => {
  const service = await source('src/services/workforce.js');

  assert.match(service, /effectiveFrom < today && !bootstrap/);
  assert.match(service, /effectiveFrom < today && bootstrap && !reason/);
  assert.match(service, /effectiveFrom < today && bootstrap && latest/);
  assert.match(service, /Ngày đã qua chỉ được dùng trong khởi tạo chính sách ban đầu có kiểm soát/);
});

test('Issue #1110 Lô A exposes coverage and bulk mutation with existing work-policy permissions and audit', async () => {
  const route = await source('src/routes/workforce.js');

  assert.match(route, /\/assignments\/coverage/);
  assert.match(route, /\/assignments\/bulk/);
  assert.match(route, /handleAssignmentCoverage/);
  assert.match(route, /handleBulkAssignments/);
  assert.match(route, /runIdempotentMutation/);
  assert.match(route, /resourceType: 'employee-work-policy-bulk'/);
  assert.match(route, /bootstrap-bulk-assign/);
  assert.match(route, /coreWorkPolicyRead/);
  assert.match(route, /coreWorkPolicyManage/);
});

test('Issue #1110 Lô A can atomically assign a policy when a new employee is created', async () => {
  const [service, route] = await Promise.all([
    source('src/services/employee.js'),
    source('src/routes/employees.js'),
  ]);

  assert.match(service, /workPolicyId/);
  assert.match(service, /policyEffectiveFrom/);
  assert.match(service, /workforceRepo\.getWorkPolicyById/);
  assert.match(service, /workforceRepo\.insertEmployeePolicyAssignment/);
  assert.ok(service.indexOf('workforceRepo.getWorkPolicyById') < service.indexOf('employeeRepo.insertEmployee'));
  assert.match(route, /coreWorkPolicyManage/);
  assert.match(route, /assign-on-create/);
  assert.match(route, /resourceType: 'employee-work-policy'/);
});

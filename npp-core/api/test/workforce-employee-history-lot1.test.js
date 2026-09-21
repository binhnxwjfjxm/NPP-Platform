import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { effectiveDateOnly } from '../src/services/workforce.js';

async function source(path) {
  return readFile(new URL('../' + path, import.meta.url), 'utf8');
}

test('Issue #1140 Lô 1 adds provenance-aware employment and assignment history', async () => {
  const [migration, registry] = await Promise.all([
    source('../../database/migrations/shared/149_workforce_employee_history.sql'),
    source('src/migrations/index.js'),
  ]);

  assert.match(registry, /149_workforce_employee_history/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS shared\.employee_employments/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS shared\.employee_assignments/);
  assert.match(migration, /LEGACY_ESTIMATED/);
  assert.match(migration, /AUDIT_DERIVED/);
  assert.match(migration, /LEGACY_CURRENT_ONLY/);
  assert.match(migration, /shared\.core_audit_records/);
  assert.match(migration, /current-day-only/i);
  assert.match(migration, /grant_company_runtime_access/);
});

test('Issue #1140 Lô 1 keeps one effective-date contract for employee onboarding', async () => {
  const service = await source('src/services/employee.js');

  assert.equal(effectiveDateOnly('2026-09-20T00:00:00.000Z'), '2026-09-20');
  assert.equal(effectiveDateOnly(new Date('2026-09-20T00:00:00.000Z')), '2026-09-20');
  assert.match(service, /effectiveDateOnly\(policy\.effective_from\)/);
  assert.match(service, /effectiveDateOnly\(policy\.effective_to\)/);
  assert.doesNotMatch(service, /String\(policy\.effective_(?:from|to)\)/);
  assert.match(service, /insertEmployeeEmployment/);
  assert.match(service, /insertEmployeeAssignment/);
  assert.match(service, /confirmEmployment/);
  assert.match(service, /confirmAssignment/);
});

test('Issue #1140 Lô 1 exposes a canonical employee-at-date resolver', async () => {
  const repository = await source('src/db/repositories/employee.js');

  assert.match(repository, /resolveEmployeeAtDate/);
  assert.match(repository, /shared\.employee_employments/);
  assert.match(repository, /shared\.employee_assignments/);
  assert.match(repository, /effective_from <= \$3::date/);
  assert.match(repository, /effective_to IS NULL OR x\.effective_to >= \$3::date/);
});

test('Issue #1140 Lô 1 makes Timesheet employment and branch history effective-dated', async () => {
  const [repository, service, route] = await Promise.all([
    source('src/db/repositories/attendance-timesheet.js'),
    source('src/services/attendance-timesheet.js'),
    source('src/routes/workforce.js'),
  ]);

  assert.match(repository, /JOIN shared\.employee_employments emp/);
  assert.match(repository, /shared\.employee_assignments/);
  assert.match(repository, /org_assignment\.branch_id AS employee_branch_id/);
  assert.match(repository, /emp\.effective_from <= d\.work_date::date/);
  assert.match(repository, /emp\.effective_to IS NULL OR emp\.effective_to >= d\.work_date::date/);
  assert.doesNotMatch(repository, /e\.branch_id AS employee_branch_id/);
  assert.match(service, /dateFrom, dateTo, employeeId, employeeQuery, branchId, branchIds/);
  assert.match(service, /employeeIds: employees\.map/);
  assert.match(service, /branchId,\s*branchIds,/s);
  assert.match(route, /Historical Timesheet scope is enforced by effective-dated branch assignment/);
});

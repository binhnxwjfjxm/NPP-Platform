import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL('../' + path, import.meta.url), 'utf8');
}

test('Issue #1140 Lô 2 adds canonical organization structure without duplicating assignment history', async () => {
  const [migration, registry] = await Promise.all([
    source('../../database/migrations/shared/150_workforce_organization_structure.sql'),
    source('src/migrations/index.js'),
  ]);

  assert.match(registry, /150_workforce_organization_structure/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS shared\.hr_departments/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS shared\.hr_positions/);
  assert.match(migration, /ALTER TABLE shared\.employee_assignments/);
  assert.match(migration, /department_id uuid/);
  assert.match(migration, /position_id uuid/);
  assert.match(migration, /manager_employee_id uuid/);
  assert.match(migration, /employee_assignments_manager_not_self/);
  assert.doesNotMatch(migration, /CREATE TABLE IF NOT EXISTS shared\.employee_department_history/);
  assert.doesNotMatch(migration, /CREATE TABLE IF NOT EXISTS shared\.employee_manager_history/);
});

test('Issue #1140 Lô 2 resolves organization fields through the same effective-dated assignment', async () => {
  const repository = await source('src/db/repositories/employee.js');

  assert.match(repository, /a\.department_id/);
  assert.match(repository, /a\.position_id/);
  assert.match(repository, /a\.manager_employee_id/);
  assert.match(repository, /shared\.hr_departments/);
  assert.match(repository, /shared\.hr_positions/);
  assert.match(repository, /manager_name/);
  assert.match(repository, /resolveEmployeeAtDate/);
});

test('Issue #1140 Lô 2 validates department-position-manager contracts and reporting-line cycles', async () => {
  const service = await source('src/services/employee.js');

  assert.match(service, /POSITION_DEPARTMENT_MISMATCH/);
  assert.match(service, /MANAGER_NOT_EFFECTIVE/);
  assert.match(service, /MANAGER_SELF_REFERENCE/);
  assert.match(service, /MANAGER_HIERARCHY_CYCLE/);
  assert.match(service, /managerEmployeeId/);
  assert.match(service, /position\?\.name/);
});

test('Issue #1140 Lô 2 organization catalog mutations remain permissioned, idempotent and audited', async () => {
  const [route, service] = await Promise.all([
    source('src/routes/employees.js'),
    source('src/services/employee-organization.js'),
  ]);

  assert.match(route, /\/api\/employees\/organization/);
  assert.match(route, /requireIdempotencyKey/);
  assert.match(route, /withAuditOutboxTransaction/);
  assert.match(route, /resourceType: serviceResult\.resourceType/);
  assert.match(service, /DEPARTMENT_HIERARCHY_CYCLE/);
  assert.match(service, /DEPARTMENT_CODE_EXISTS/);
  assert.match(service, /POSITION_CODE_EXISTS/);
});

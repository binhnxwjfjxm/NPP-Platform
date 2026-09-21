import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL('../' + path, import.meta.url), 'utf8');
}

test('Issue #1110 Lô 10 adds workflow-only violation handling schema and permissions', async () => {
  const [migration, registry, permissions] = await Promise.all([
    source('../../database/migrations/shared/147_workforce_violation_handling.sql'),
    source('src/migrations/index.js'),
    source('src/access/permissions.js'),
  ]);

  assert.match(registry, /147_workforce_violation_handling/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS shared\.attendance_violation_cases/);
  assert.match(migration, /core\.attendance-violation\.self-explain/);
  assert.match(migration, /core\.attendance-violation\.resolve/);
  assert.match(permissions, /coreAttendanceViolationSelfExplain/);
  assert.match(permissions, /coreAttendanceViolationResolve/);
  assert.match(migration, /EXPLANATION_SUBMITTED/);
  assert.match(migration, /UNDER_REVIEW/);
  assert.match(migration, /RESOLVED/);
  assert.match(migration, /CONFIRMED/);
  assert.match(migration, /EXCUSED/);
  assert.match(migration, /attendance_violation_cases_one_case_per_fact/);
});

test('Issue #1110 Lô 10 stores immutable violation submission snapshots, not a second attendance truth', async () => {
  const [migration, repository] = await Promise.all([
    source('../../database/migrations/shared/147_workforce_violation_handling.sql'),
    source('src/db/repositories/attendance-violations.js'),
  ]);

  assert.match(migration, /violation_label_snapshot/);
  assert.match(migration, /violation_detail_snapshot/);
  assert.match(migration, /policy_version_snapshot/);
  assert.match(migration, /COMMENT ON TABLE shared\.attendance_violation_cases[\s\S]*Workflow-only/);
  assert.doesNotMatch(repository, /INSERT INTO shared\.attendance_events|UPDATE shared\.attendance_events|DELETE FROM shared\.attendance_events/);
  assert.doesNotMatch(migration, /penalty_amount|salary_deduction|payroll/i);
});

test('Issue #1110 Lô 10 explanation reuses the live Timesheet violation and serializes duplicate submissions', async () => {
  const service = await source('src/services/attendance-violations.js');

  assert.match(service, /attendanceTimesheetService\.listAttendanceTimesheet/);
  assert.match(service, /day\.violationEvaluation/);
  assert.match(service, /VIOLATION_NOT_CURRENT/);
  assert.match(service, /lockAttendanceMutationScope/);
  assert.match(service, /getCaseByFact/);
  assert.match(service, /VIOLATION_CASE_EXISTS/);
  assert.match(service, /insertExplanationCase/);
});

test('Issue #1110 Lô 10 manager resolution is scoped, optimistic and rechecks confirmed violations', async () => {
  const [service, repository] = await Promise.all([
    source('src/services/attendance-violations.js'),
    source('src/db/repositories/attendance-violations.js'),
  ]);

  assert.match(service, /employeeForScope/);
  assert.match(service, /expectedVersion/);
  assert.match(service, /START_REVIEW/);
  assert.match(service, /CONCLUDE/);
  assert.match(service, /CONFIRMED/);
  assert.match(service, /EXCUSED/);
  assert.match(service, /VIOLATION_CHANGED/);
  assert.match(repository, /AND version = \$3/);
  assert.match(repository, /status IN \('EXPLANATION_SUBMITTED', 'UNDER_REVIEW'\)/);
});

test('Issue #1110 Lô 10 mutations use canonical idempotency, deny-by-default permissions and audit', async () => {
  const route = await source('src/routes/workforce.js');

  assert.match(route, /\/attendance\/violations\/explain/);
  assert.match(route, /\/attendance\/violations\/review/);
  assert.match(route, /coreAttendanceViolationSelfExplain/);
  assert.match(route, /coreAttendanceViolationResolve/);
  assert.match(route, /runIdempotentMutation/);
  assert.match(route, /resourceType: 'attendance-violation-case'/);
  assert.match(route, /submit-explanation/);
  assert.match(route, /conclude-violation/);
  assert.match(route, /start-violation-review/);
});

test('Issue #1110 Lô 10 repository uses scoped employee batching without malformed SQL placeholders', async () => {
  const repository = await source('src/db/repositories/attendance-violations.js');

  assert.match(repository, /c\.employee_id = \$\$\{params\.length\}/);
  assert.match(repository, /c\.employee_id = ANY\(\$\$\{params\.length\}::uuid\[\]\)/);
  assert.doesNotMatch(repository, /c\.employee_id = \$\{params\.length\}/);
});

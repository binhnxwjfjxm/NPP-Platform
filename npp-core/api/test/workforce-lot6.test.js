import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL('../' + path, import.meta.url), 'utf8');
}

test('Issue #1110 Lô 6 adds canonical leave types and leave requests without touching attendance events', async () => {
  const [migration, registry, repository] = await Promise.all([
    source('../../database/migrations/shared/146_workforce_leave_absence.sql'),
    source('src/migrations/index.js'),
    source('src/db/repositories/leave-management.js'),
  ]);
  assert.match(registry, /146_workforce_leave_absence/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS shared\.leave_types/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS shared\.leave_requests/);
  assert.match(migration, /day_part IN \('FULL_DAY', 'FIRST_HALF', 'SECOND_HALF'\)/);
  assert.match(migration, /leave_requests_half_day_check/);
  assert.match(repository, /INSERT INTO shared\.leave_requests/);
  assert.doesNotMatch(repository, /attendance_events/);
});

test('Issue #1110 Lô 6 snapshots leave semantics so later configuration changes do not rewrite history', async () => {
  const migration = await source('../../database/migrations/shared/146_workforce_leave_absence.sql');
  for (const field of [
    'leave_type_code_snapshot',
    'leave_type_name_snapshot',
    'leave_is_paid_snapshot',
    'leave_counts_as_workday_snapshot',
    'leave_requires_approval_snapshot',
  ]) assert.match(migration, new RegExp(field));
});

test('Issue #1110 Lô 6 uses deny-by-default permissions, canonical idempotency and audit', async () => {
  const [migration, permissions, route] = await Promise.all([
    source('../../database/migrations/shared/146_workforce_leave_absence.sql'),
    source('src/access/permissions.js'),
    source('src/routes/workforce.js'),
  ]);
  for (const permission of [
    'core.leave.self.read',
    'core.leave.self.request',
    'core.leave.read',
    'core.leave.approve',
    'core.leave-type.manage',
  ]) {
    assert.match(migration, new RegExp(permission.replaceAll('.', '\\.')));
    assert.match(permissions, new RegExp(permission.replaceAll('.', '\\.')));
  }
  assert.match(route, /runIdempotentMutation/);
  assert.match(route, /withAuditOutboxTransaction/);
  assert.match(route, /submit-leave/);
  assert.match(route, /approve-leave/);
  assert.match(route, /reject-leave/);
  assert.match(route, /cancel-leave/);
  assert.match(route, /create-leave-type/);
  assert.match(route, /update-leave-type/);
});

test('Issue #1110 Lô 6 blocks overlapping leave portions and serializes against attendance period locks', async () => {
  const [repository, service] = await Promise.all([
    source('src/db/repositories/leave-management.js'),
    source('src/services/leave-management.js'),
  ]);
  assert.match(repository, /status IN \('SUBMITTED', 'APPROVED'\)/);
  assert.match(repository, /r\.day_part = 'FULL_DAY'/);
  assert.match(service, /lockAttendanceMutationScope/);
  assert.match(service, /getPeriodLockForEmployeeDate/);
  assert.match(service, /LEAVE_REQUEST_OVERLAP/);
  assert.match(service, /ATTENDANCE_PERIOD_LOCKED/);
});

test('Issue #1110 Lô 6 protects transitions with optimistic version and clear half-day rules', async () => {
  const [repository, service] = await Promise.all([
    source('src/db/repositories/leave-management.js'),
    source('src/services/leave-management.js'),
  ]);
  assert.match(repository, /version = version \+ 1/);
  assert.match(repository, /version = \$3 AND status = 'SUBMITTED'/);
  assert.match(service, /HALF_DAY_SINGLE_DATE_REQUIRED/);
  assert.match(service, /LEAVE_HALF_DAY_NOT_ALLOWED/);
  assert.match(service, /LEAVE_ATTACHMENT_REQUIRED/);
  assert.match(service, /Tự động duyệt theo chế độ nghỉ/);
});

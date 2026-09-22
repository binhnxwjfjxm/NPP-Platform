import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL('../' + path, import.meta.url), 'utf8');
}

test('Issue #1140 Lô 5 adds canonical overtime lifecycle and immutable attendance closeout snapshot', async () => {
  const [migration, registry] = await Promise.all([
    source('../../database/migrations/shared/153_workforce_overtime_closeout.sql'),
    source('src/migrations/index.js'),
  ]);
  assert.match(registry, /153_workforce_overtime_closeout/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS shared\.overtime_requests/);
  assert.match(migration, /status IN \('SUBMITTED', 'APPROVED', 'REJECTED', 'ACTUAL_RECORDED', 'CONFIRMED'\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS shared\.attendance_periods/);
  assert.match(migration, /AGGREGATING.*NEEDS_ACTION.*RECONCILED.*CLOSED/s);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS shared\.attendance_period_snapshots/);
  assert.match(migration, /attendance_period_snapshots_are_append_only/);
  assert.match(migration, /BEFORE UPDATE OR DELETE ON shared\.attendance_period_snapshots/);
});

test('Issue #1140 Lô 5 enforces effective policy and does not infer payable OT from attendance events', async () => {
  const [service, repository] = await Promise.all([
    source('src/services/workforce-closeout.js'),
    source('src/db/repositories/workforce-closeout.js'),
  ]);
  assert.match(service, /getEffectiveEmployeePolicyAssignment/);
  assert.match(service, /overtime_enabled/);
  assert.match(service, /overtime_requires_approval/);
  assert.match(service, /OVERTIME_NOT_ENABLED/);
  assert.match(repository, /r\.status = 'CONFIRMED'/);
  assert.match(repository, /SUM\(r\.confirmed_minutes\)/);
  assert.doesNotMatch(service, /UPDATE\s+shared\.attendance_events/i);
  assert.doesNotMatch(repository, /UPDATE\s+shared\.attendance_events/i);
});

test('Issue #1140 Lô 5 closes only reconciled unchanged attendance into payroll snapshot', async () => {
  const service = await source('src/services/workforce-closeout.js');
  assert.match(service, /listAttendanceTimesheet/);
  assert.match(service, /pendingAdjustmentDays/);
  assert.match(service, /pendingLeaveDays/);
  assert.match(service, /outstandingOvertimeRequests/);
  assert.match(service, /ATTENDANCE_PERIOD_WARNINGS_UNACKNOWLEDGED/);
  assert.match(service, /period\.status !== 'RECONCILED'/);
  assert.match(service, /reconciled_fingerprint !== built\.fingerprint/);
  assert.match(service, /insertAttendancePeriodSnapshot/);
  assert.match(service, /insertPeriodLock/);
  assert.match(service, /status !== 'CLOSED'/);
  assert.match(service, /confirmedOvertimeMinutes/);
});

test('Issue #1140 Lô 5 post-close correction marks the business period dirty without deleting history', async () => {
  const [adjustments, leave, repository] = await Promise.all([
    source('src/services/attendance-adjustments.js'),
    source('src/services/leave-management.js'),
    source('src/db/repositories/workforce-closeout.js'),
  ]);
  assert.match(adjustments, /markClosedAttendancePeriodsDirtyForEmployeeRange/);
  assert.match(leave, /markClosedAttendancePeriodsDirtyForEmployeeRange/);
  assert.match(repository, /SET status = 'NEEDS_ACTION'/);
  assert.match(repository, /p\.status = 'CLOSED'/);
  assert.doesNotMatch(repository, /DELETE FROM shared\.attendance_period_snapshots/i);
});

test('Issue #1140 Lô 5 exposes deny-by-default permissions and audited idempotent mutation routes', async () => {
  const [route, permissions] = await Promise.all([
    source('src/routes/workforce.js'),
    source('src/access/permissions.js'),
  ]);
  for (const key of [
    'core.overtime.self-request',
    'core.overtime.read',
    'core.overtime.approve',
    'core.overtime.confirm',
    'core.attendance.reconcile',
  ]) assert.match(permissions, new RegExp(key.replaceAll('.', '\\.')));
  assert.match(route, /'\/overtime\/review'/);
  assert.match(route, /'\/overtime\/actual'/);
  assert.match(route, /'\/overtime\/confirm'/);
  assert.match(route, /'\/attendance\/periods'/);
  assert.match(route, /'\/attendance\/payroll-input'/);
  assert.match(route, /runIdempotentMutation/);
  assert.match(route, /resourceType: 'overtime-request'/);
  assert.match(route, /resourceType: 'attendance-period'/);
  assert.match(route, /withAuditOutboxTransaction/);
});

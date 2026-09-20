import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { selectEffectiveAttendanceEvents, summarizeAttendanceDay } from '../src/services/attendance-timesheet.js';

async function source(path) {
  return readFile(new URL('../' + path, import.meta.url), 'utf8');
}

function event(id, type, source, occurredAt, createdAt = occurredAt) {
  return {
    id,
    event_type: type,
    source,
    validation_status: 'VALID',
    occurred_at: occurredAt,
    created_at: createdAt,
  };
}

test('Issue #1110 Lô 5 keeps source events append-only and projects the newest approved adjustment per event type', () => {
  const effective = selectEffectiveAttendanceEvents([
    event('qr-in', 'CHECK_IN', 'QR', '2026-09-18T01:02:00.000Z'),
    event('qr-out', 'CHECK_OUT', 'QR', '2026-09-18T10:05:00.000Z'),
    event('adj-in-old', 'CHECK_IN', 'ADJUSTMENT', '2026-09-18T01:00:00.000Z', '2026-09-18T12:00:00.000Z'),
    event('adj-in-new', 'CHECK_IN', 'ADJUSTMENT', '2026-09-18T01:05:00.000Z', '2026-09-18T13:00:00.000Z'),
  ]);

  assert.deepEqual(effective.map((item) => item.id), ['adj-in-new', 'qr-out']);
});

test('Issue #1110 Lô 5 keeps adjustment effective if a schedule is added or replaced later', () => {
  const day = summarizeAttendanceDay({
    employee_id: '11111111-1111-4111-8111-111111111111',
    employee_code: 'NV001',
    employee_name: 'Nguyễn An',
    employee_branch_id: null,
    branch_code: null,
    branch_name: null,
    work_date: '2026-09-18',
    schedule_id: '33333333-3333-4333-8333-333333333333',
    schedule_work_policy_id: '44444444-4444-4444-8444-444444444444',
    schedule_kind: 'WORK',
    scheduled_start_at: '2026-09-18T01:00:00.000Z',
    scheduled_end_at: '2026-09-18T10:00:00.000Z',
    schedule_source: 'OVERRIDE',
    override_reason: 'Đổi ca',
    assigned_work_policy_id: '44444444-4444-4444-8444-444444444444',
    policy_id: '44444444-4444-4444-8444-444444444444',
    policy_code: 'VP',
    policy_version: 1,
    policy_name: 'Giờ hành chính',
    policy_time_mode: 'FIXED',
    policy_fixed_start_time: '08:00',
    policy_fixed_end_time: '17:00',
    policy_working_days: [1, 2, 3, 4, 5, 6],
    policy_break_minutes: 60,
    policy_late_grace_minutes: 0,
    policy_early_leave_grace_minutes: 0,
    policy_attendance_method: 'QR',
    policy_timezone: 'Asia/Ho_Chi_Minh',
  }, [
    { ...event('qr-in', 'CHECK_IN', 'QR', '2026-09-18T01:10:00.000Z'), schedule_id: '33333333-3333-4333-8333-333333333333' },
    { ...event('qr-out', 'CHECK_OUT', 'QR', '2026-09-18T10:00:00.000Z'), schedule_id: '33333333-3333-4333-8333-333333333333' },
    { ...event('adj-in', 'CHECK_IN', 'ADJUSTMENT', '2026-09-18T01:00:00.000Z', '2026-09-19T01:00:00.000Z'), schedule_id: null },
  ], new Date('2026-09-19T03:00:00.000Z'));

  assert.equal(day.checkInAt, '2026-09-18T01:00:00.000Z');
  assert.equal(day.checkOutAt, '2026-09-18T10:00:00.000Z');
  assert.ok(day.attendanceSources.includes('ADJUSTMENT'));
});

test('Issue #1110 Lô 5 adds canonical adjustment requests and immutable period locks', async () => {
  const [migration, registry, repository] = await Promise.all([
    source('../../database/migrations/shared/144_workforce_attendance_adjustment_lock.sql'),
    source('src/migrations/index.js'),
    source('src/db/repositories/attendance-adjustments.js'),
  ]);

  assert.match(registry, /144_workforce_attendance_adjustment_lock/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS shared\.attendance_adjustment_requests/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS shared\.attendance_period_locks/);
  assert.match(migration, /core\.attendance\.self-adjust-request/);
  assert.match(migration, /core\.attendance\.lock/);
  assert.match(repository, /INSERT INTO shared\.attendance_events/);
  assert.match(repository, /'ADJUSTMENT','VALID'/);
  assert.doesNotMatch(repository, /UPDATE shared\.attendance_events|DELETE FROM shared\.attendance_events/);
});

test('Issue #1110 Lô 5 uses deny-by-default permissions, canonical idempotency and audit for every mutation', async () => {
  const [route, permissions, service] = await Promise.all([
    source('src/routes/workforce.js'),
    source('src/access/permissions.js'),
    source('src/services/attendance-adjustments.js'),
  ]);

  assert.match(permissions, /coreAttendanceSelfAdjustRequest: 'core\.attendance\.self-adjust-request'/);
  assert.match(permissions, /coreAttendanceLock: 'core\.attendance\.lock'/);
  assert.match(route, /coreAttendanceAdjust/);
  assert.match(route, /coreAttendanceSelfAdjustRequest/);
  assert.match(route, /coreAttendanceLock/);
  assert.match(route, /runIdempotentMutation/);
  assert.match(route, /withAuditOutboxTransaction/);
  assert.match(route, /insertAuditRecord/);
  assert.match(route, /submit-adjustment/);
  assert.match(route, /approve-adjustment/);
  assert.match(route, /reject-adjustment/);
  assert.match(route, /direct-adjustment/);
  assert.match(route, /lock-period/);
  assert.match(service, /allowLockedOverride/);
  assert.match(service, /ATTENDANCE_PERIOD_LOCKED/);
});

test('Issue #1110 Lô 5 records actor, reason, before and after facts without fake outbox events', async () => {
  const [route, service, repository] = await Promise.all([
    source('src/routes/workforce.js'),
    source('src/services/attendance-adjustments.js'),
    source('src/db/repositories/attendance-adjustments.js'),
  ]);

  assert.match(route, /beforeData: \{ request: result\.beforeRequest, events: result\.beforeEvents \}/);
  assert.match(route, /afterData: \{ request: result\.request, events: result\.events \}/);
  assert.match(route, /reviewReason: result\.request\.review_reason/);
  assert.match(repository, /recorded_by, request_id/);
  assert.match(repository, /attendance-adjustment\./);
  assert.doesNotMatch(service, /insertOutboxEvent|buildOutboxEvent/);
});

test('Issue #1110 Lô 5 locks period changes and blocks stale pending requests', async () => {
  const [migration, repository, service] = await Promise.all([
    source('../../database/migrations/shared/144_workforce_attendance_adjustment_lock.sql'),
    source('src/db/repositories/attendance-adjustments.js'),
    source('src/services/attendance-adjustments.js'),
  ]);

  assert.match(repository, /pg_advisory_xact_lock/);
  assert.match(repository, /findOverlappingPeriodLock/);
  assert.match(migration, /attendance_adjustment_requests_one_pending_day_idx/);
  assert.match(service, /ATTENDANCE_ADJUSTMENT_PENDING/);
  assert.match(service, /ADJUSTMENT_REQUEST_CONFLICT/);
  assert.match(service, /expectedVersion/);
});

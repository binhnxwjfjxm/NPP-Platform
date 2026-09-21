import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { summarizeAttendanceDay } from '../src/services/attendance-timesheet.js';

async function source(path) {
  return readFile(new URL('../' + path, import.meta.url), 'utf8');
}

function row(overrides = {}) {
  return {
    employee_id: '11111111-1111-4111-8111-111111111111',
    employee_code: 'NV001',
    employee_name: 'Nguyễn An',
    employee_branch_id: '22222222-2222-4222-8222-222222222222',
    branch_code: 'CN01',
    branch_name: 'Chi nhánh 01',
    work_date: '2026-09-19',
    schedule_id: '33333333-3333-4333-8333-333333333333',
    schedule_work_policy_id: '44444444-4444-4444-8444-444444444444',
    schedule_kind: 'WORK',
    scheduled_start_at: '2026-09-19T01:00:00.000Z',
    scheduled_end_at: '2026-09-19T10:00:00.000Z',
    schedule_source: 'POLICY',
    override_reason: null,
    assigned_work_policy_id: '44444444-4444-4444-8444-444444444444',
    policy_id: '44444444-4444-4444-8444-444444444444',
    policy_code: 'VP',
    policy_version: 1,
    policy_name: 'Văn phòng',
    policy_time_mode: 'FIXED',
    policy_fixed_start_time: '08:00',
    policy_fixed_end_time: '17:00',
    policy_working_days: [1, 2, 3, 4, 5, 6],
    policy_break_minutes: 60,
    policy_minimum_full_day_minutes: 480,
    policy_minimum_half_day_minutes: 240,
    policy_late_grace_minutes: 0,
    policy_early_leave_grace_minutes: 0,
    policy_attendance_method: 'QR',
    policy_attendance_basis: 'TIME',
    policy_timezone: 'Asia/Ho_Chi_Minh',
    ...overrides,
  };
}

function event(id, type, occurredAt, movementReason = null) {
  return {
    id,
    installation_id: 'default',
    employee_id: '11111111-1111-4111-8111-111111111111',
    schedule_id: '33333333-3333-4333-8333-333333333333',
    work_policy_id: '44444444-4444-4444-8444-444444444444',
    attendance_point_id: null,
    event_type: type,
    movement_reason: movementReason,
    occurred_at: occurredAt,
    source: 'QR',
    validation_status: 'VALID',
    source_reference: id,
    note: null,
    recorded_by: 'user-1',
    request_id: 'req-' + id,
    created_at: occurredAt,
  };
}

test('Lô B migration extends policy basis and append-only movement events', async () => {
  const [migration, registry] = await Promise.all([
    source('../../database/migrations/shared/148_workforce_attendance_movement.sql'),
    source('src/migrations/index.js'),
  ]);

  assert.match(registry, /148_workforce_attendance_movement/);
  assert.match(migration, /attendance_basis IN \('TIME', 'PRESENCE', 'NONE'\)/);
  assert.match(migration, /event_type IN \('CHECK_IN', 'TEMP_EXIT', 'RETURN', 'CHECK_OUT'\)/);
  assert.match(migration, /movement_reason IN \('WORK_BUSINESS', 'PERSONAL', 'BREAK', 'OTHER'\)/);
  assert.doesNotMatch(migration, /DELETE FROM shared\.attendance_events|UPDATE shared\.attendance_events SET/i);
});

test('Lô B uses two-minute QR tokens and requires an explicit exit reason', async () => {
  const service = await source('src/services/workforce.js');

  assert.match(service, /ATTENDANCE_QR_TTL_MS = 120_000/);
  assert.match(service, /nextAction: 'EXIT'/);
  assert.match(service, /nextAction: 'RETURN'/);
  assert.match(service, /EXIT_REASON_REQUIRED/);
  assert.match(service, /WORK_BUSINESS/);
  assert.match(service, /PERSONAL/);
  assert.match(service, /BREAK/);
  assert.match(service, /OTHER/);
  assert.match(service, /attendanceBasis === 'PRESENCE'/);
});

test('Lô B keeps work-business exits inside worked time', () => {
  const day = summarizeAttendanceDay(row(), [
    event('in', 'CHECK_IN', '2026-09-19T01:00:00.000Z'),
    event('out-work', 'TEMP_EXIT', '2026-09-19T03:00:00.000Z', 'WORK_BUSINESS'),
    event('return-work', 'RETURN', '2026-09-19T04:00:00.000Z'),
    event('out', 'CHECK_OUT', '2026-09-19T10:00:00.000Z'),
  ], new Date('2026-09-20T03:00:00.000Z'));

  assert.equal(day.actualMinutes, 540);
  assert.equal(day.countedMinutes, 480);
  assert.equal(day.status, 'COMPLETE');
});

test('Lô B removes personal exit time and does not double-deduct a recorded break', () => {
  const personal = summarizeAttendanceDay(row(), [
    event('in-p', 'CHECK_IN', '2026-09-19T01:00:00.000Z'),
    event('out-p', 'TEMP_EXIT', '2026-09-19T03:00:00.000Z', 'PERSONAL'),
    event('return-p', 'RETURN', '2026-09-19T04:00:00.000Z'),
    event('end-p', 'CHECK_OUT', '2026-09-19T10:00:00.000Z'),
  ], new Date('2026-09-20T03:00:00.000Z'));
  const breakDay = summarizeAttendanceDay(row(), [
    event('in-b', 'CHECK_IN', '2026-09-19T01:00:00.000Z'),
    event('out-b', 'TEMP_EXIT', '2026-09-19T03:00:00.000Z', 'BREAK'),
    event('return-b', 'RETURN', '2026-09-19T04:00:00.000Z'),
    event('end-b', 'CHECK_OUT', '2026-09-19T10:00:00.000Z'),
  ], new Date('2026-09-20T03:00:00.000Z'));

  assert.equal(personal.actualMinutes, 480);
  assert.equal(personal.countedMinutes, 420);
  assert.equal(breakDay.actualMinutes, 480);
  assert.equal(breakDay.countedMinutes, 480);
});

test('Lô B presence-only policy confirms attendance without time-based work minutes or checkout', () => {
  const day = summarizeAttendanceDay(row({ policy_attendance_basis: 'PRESENCE' }), [
    event('presence-in', 'CHECK_IN', '2026-09-19T01:20:00.000Z'),
  ], new Date('2026-09-20T03:00:00.000Z'));

  assert.equal(day.actualMinutes, 0);
  assert.equal(day.countedMinutes, 0);
  assert.equal(day.missingCheckOut, false);
  assert.equal(day.lateMinutes, 0);
  assert.equal(day.earlyLeaveMinutes, 0);
  assert.equal(day.status, 'COMPLETE');
  assert.equal(day.validWork, true);
});

test('Lô B repositories project movement reason and attendance basis', async () => {
  const [workforceRepo, timesheetRepo] = await Promise.all([
    source('src/db/repositories/workforce.js'),
    source('src/db/repositories/attendance-timesheet.js'),
  ]);

  assert.match(workforceRepo, /attendance_basis/);
  assert.match(workforceRepo, /movement_reason/);
  assert.match(timesheetRepo, /policy_attendance_basis/);
  assert.match(timesheetRepo, /movement_reason/);
});

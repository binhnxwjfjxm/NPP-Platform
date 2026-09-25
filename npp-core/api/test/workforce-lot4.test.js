import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  summarizeAttendanceDay,
  summarizeAttendanceMonth,
} from '../src/services/attendance-timesheet.js';

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

function baseRow(overrides = {}) {
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
    schedule_source: 'OVERRIDE',
    override_reason: 'Đổi ca',
    assigned_work_policy_id: '44444444-4444-4444-8444-444444444444',
    policy_id: '44444444-4444-4444-8444-444444444444',
    policy_code: 'VP',
    policy_version: 2,
    policy_name: 'Giờ hành chính',
    policy_time_mode: 'FIXED',
    policy_fixed_start_time: '08:00',
    policy_fixed_end_time: '17:00',
    policy_working_days: [1, 2, 3, 4, 5, 6],
    policy_break_minutes: 60,
    policy_late_grace_minutes: 5,
    policy_early_leave_grace_minutes: 5,
    policy_attendance_method: 'QR',
    policy_timezone: 'Asia/Ho_Chi_Minh',
    ...overrides,
  };
}

function event(id, type, occurredAt, overrides = {}) {
  return {
    id,
    installation_id: 'default',
    employee_id: '11111111-1111-4111-8111-111111111111',
    schedule_id: '33333333-3333-4333-8333-333333333333',
    work_policy_id: '44444444-4444-4444-8444-444444444444',
    attendance_point_id: null,
    event_type: type,
    occurred_at: occurredAt,
    source: 'QR',
    validation_status: 'VALID',
    source_reference: id,
    note: null,
    recorded_by: 'user-1',
    request_id: `req-${id}`,
    created_at: occurredAt,
    point_code: 'VP',
    point_name: 'Văn phòng',
    movement_reason: null,
    ...overrides,
  };
}

test('Issue #1110 Lô 4 computes actual, counted, late and early minutes from canonical facts', () => {
  const day = summarizeAttendanceDay(
    baseRow(),
    [
      event('in', 'CHECK_IN', '2026-09-19T01:12:00.000Z'),
      event('out', 'CHECK_OUT', '2026-09-19T09:45:00.000Z'),
    ],
    new Date('2026-09-20T03:00:00.000Z'),
  );

  assert.equal(day.actualMinutes, 513);
  assert.equal(day.countedMinutes, 453);
  assert.equal(day.lateMinutes, 7);
  assert.equal(day.earlyLeaveMinutes, 10);
  assert.equal(day.missingCheckIn, false);
  assert.equal(day.missingCheckOut, false);
  assert.equal(day.status, 'LATE_AND_EARLY');
  assert.equal(day.validWork, true);
  assert.deepEqual(day.attendanceSources, ['QR']);
});



test('external work can finish away from Công Ty and still count a full workday without an early-leave violation', () => {
  const day = summarizeAttendanceDay(
    baseRow(),
    [
      event('field-in', 'CHECK_IN', '2026-09-19T01:00:00.000Z'),
      event('field-exit', 'TEMP_EXIT', '2026-09-19T06:00:00.000Z', { movement_reason: 'WORK_BUSINESS' }),
      event('field-done', 'CHECK_OUT', '2026-09-19T07:00:00.000Z', {
        source: 'MANUAL',
        note: 'Kết thúc công việc bên ngoài',
      }),
    ],
    new Date('2026-09-20T03:00:00.000Z'),
  );

  assert.equal(day.countedMinutes, 480);
  assert.equal(day.earlyLeaveMinutes, 0);
  assert.equal(day.status, 'COMPLETE');
  assert.equal(day.validWork, true);
});

test('flexible effectiveness-based policy keeps a completed late arrival as a full workday without late or early violations', () => {
  const row = baseRow({
    policy_time_mode: 'FLEXIBLE',
    policy_name: 'Theo hiệu quả công việc',
    policy_overtime_enabled: false,
  });
  const day = summarizeAttendanceDay(
    row,
    [
      event('flex-in', 'CHECK_IN', '2026-09-19T03:15:00.000Z'),
      event('flex-out', 'CHECK_OUT', '2026-09-19T10:00:00.000Z'),
    ],
    new Date('2026-09-20T03:00:00.000Z'),
  );
  const employee = {
    id: day.employee.id,
    code: day.employee.code,
    full_name: day.employee.name,
    branch_id: day.employee.branchId,
    branch_code: day.employee.branchCode,
    branch_name: day.employee.branchName,
  };
  const month = summarizeAttendanceMonth(employee, [day], {
    from: '2026-09-01',
    to: '2026-09-30',
  });

  assert.equal(day.lateMinutes, 0);
  assert.equal(day.earlyLeaveMinutes, 0);
  assert.equal(day.status, 'COMPLETE');
  assert.equal(day.validWork, true);
  assert.equal(month.completedDays, 1);
  assert.equal(month.lateViolationDays, 0);
  assert.equal(month.earlyLeaveViolationDays, 0);
});

test('Issue #1110 Lô 4 marks a past workday with no checkout as incomplete without inventing payroll data', () => {
  const day = summarizeAttendanceDay(
    baseRow(),
    [event('in', 'CHECK_IN', '2026-09-19T01:00:00.000Z')],
    new Date('2026-09-20T03:00:00.000Z'),
  );

  assert.equal(day.missingCheckIn, false);
  assert.equal(day.missingCheckOut, true);
  assert.equal(day.actualMinutes, 0);
  assert.equal(day.countedMinutes, 0);
  assert.equal(day.status, 'MISSING_CHECK_OUT');
  assert.equal(day.validWork, false);
});

test('Issue #1110 Lô 4 monthly summary aggregates daily projection only', () => {
  const complete = summarizeAttendanceDay(
    baseRow(),
    [
      event('in-1', 'CHECK_IN', '2026-09-19T01:00:00.000Z'),
      event('out-1', 'CHECK_OUT', '2026-09-19T10:00:00.000Z'),
    ],
    new Date('2026-09-20T03:00:00.000Z'),
  );
  const missing = summarizeAttendanceDay(
    baseRow({ work_date: '2026-09-18' }),
    [],
    new Date('2026-09-20T03:00:00.000Z'),
  );
  const employee = {
    id: complete.employee.id,
    code: complete.employee.code,
    full_name: complete.employee.name,
    branch_id: complete.employee.branchId,
    branch_code: complete.employee.branchCode,
    branch_name: complete.employee.branchName,
  };
  const month = summarizeAttendanceMonth(employee, [missing, complete], {
    from: '2026-09-01',
    to: '2026-09-30',
  });

  assert.equal(month.workDays, 2);
  assert.equal(month.completedDays, 1);
  assert.equal(month.incompleteDays, 0);
  assert.equal(month.unexcusedAbsenceDays, 1);
  assert.equal(month.missingDays, 0);
  assert.equal(month.countedMinutes, 480);
});

test('Issue #1110 Lô 4 is read-only, scoped and paginated with self fallback', async () => {
  const [route, repository, registry] = await Promise.all([
    source('src/routes/workforce.js'),
    source('src/db/repositories/attendance-timesheet.js'),
    source('src/migrations/index.js'),
  ]);

  assert.match(route, /\/attendance\/timesheet/);
  assert.match(route, /coreAttendanceRead/);
  assert.match(route, /coreAttendanceSelfRead/);
  assert.match(route, /timesheetSelfOnly/);
  assert.match(route, /branchIds/);
  assert.match(repository, /generate_series/);
  assert.match(repository, /shared\.employee_assignments/);
  assert.match(repository, /branchPredicate/);
  assert.match(repository, /org_assignment\.branch_id/);
  assert.doesNotMatch(repository, /e\.branch_id = ANY/);
  assert.match(repository, /LIMIT \$\$\{limitIndex\} OFFSET \$\$\{offsetIndex\}/);
  assert.doesNotMatch(repository, /INSERT INTO|UPDATE shared|DELETE FROM/);
  assert.doesNotMatch(registry, /142_workforce_timesheet/);
});


test('Issue #1110 Bảng công theo ngày supports employee-grouped view without multiplying rows by day', async () => {
  const service = await source('src/services/attendance-timesheet.js');
  assert.match(service, /\['daily', 'employee', 'monthly'\]/);
  assert.match(service, /view === 'monthly' \|\| view === 'employee'/);
  assert.match(service, /view === 'employee' \? 100 : 50/);
});

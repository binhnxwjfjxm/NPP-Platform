import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  summarizeAttendanceDay,
  summarizeAttendanceMonth,
} from '../src/services/attendance-timesheet.js';

async function source(path) {
  return readFile(new URL('../' + path, import.meta.url), 'utf8');
}

function baseRow(overrides = {}) {
  return {
    employee_id: '11111111-1111-4111-8111-111111111111',
    employee_code: 'NV001',
    employee_name: 'Nguyễn An',
    employee_branch_id: '22222222-2222-4222-8222-222222222222',
    branch_code: 'CN01',
    branch_name: 'Chi nhánh 01',
    work_date: '2026-09-18',
    schedule_id: '33333333-3333-4333-8333-333333333333',
    schedule_work_policy_id: '44444444-4444-4444-8444-444444444444',
    schedule_kind: 'WORK',
    scheduled_start_at: '2026-09-18T01:00:00.000Z',
    scheduled_end_at: '2026-09-18T10:00:00.000Z',
    schedule_source: 'OVERRIDE',
    override_reason: null,
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
    policy_minimum_full_day_minutes: 480,
    policy_minimum_half_day_minutes: 240,
    policy_late_grace_minutes: 0,
    policy_early_leave_grace_minutes: 0,
    policy_attendance_method: 'QR',
    policy_timezone: 'Asia/Ho_Chi_Minh',
    ...overrides,
  };
}

function attendanceEvent(id, type, occurredAt) {
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
    request_id: 'req-' + id,
    created_at: occurredAt,
  };
}

function leaveRequest({
  id = 'leave-1',
  status = 'APPROVED',
  dayPart = 'FULL_DAY',
  date = '2026-09-18',
  name = 'Nghỉ phép năm',
  counted = true,
  paid = true,
} = {}) {
  return {
    id,
    installation_id: 'default',
    employee_id: '11111111-1111-4111-8111-111111111111',
    leave_type_id: '55555555-5555-4555-8555-555555555555',
    leave_type_code_snapshot: 'PHEP_NAM',
    leave_type_name_snapshot: name,
    leave_is_paid_snapshot: paid,
    leave_counts_as_workday_snapshot: counted,
    leave_requires_approval_snapshot: true,
    date_from: date,
    date_to: date,
    day_part: dayPart,
    reason: 'Việc cá nhân',
    attachment_reference: null,
    status,
    reviewed_by_actor_id: status === 'APPROVED' ? 'manager-1' : null,
    review_reason: null,
    reviewed_at: null,
    version: 1,
    request_id: 'req-' + id,
    created_at: date + 'T00:00:00.000Z',
    updated_at: date + 'T00:00:00.000Z',
  };
}

const afterDay = new Date('2026-09-19T03:00:00.000Z');

test('Issue #1110 Lô 8 keeps future days blank and does not credit future approved leave', () => {
  const day = summarizeAttendanceDay(
    baseRow({
      work_date: '2026-09-22',
      scheduled_start_at: '2026-09-22T01:00:00.000Z',
      scheduled_end_at: '2026-09-22T10:00:00.000Z',
    }),
    [],
    new Date('2026-09-21T03:00:00.000Z'),
    { leaveRequests: [leaveRequest({ date: '2026-09-22' })] },
  );

  assert.equal(day.status, 'UPCOMING');
  assert.equal(day.countedMinutes, 0);
  assert.equal(day.leaveCreditedMinutes, 0);
  assert.equal(day.unexcusedAbsenceFraction, 0);
});

test('Issue #1110 Lô 8 makes Schedule OFF win over leave and never credits leave on a day off', () => {
  const day = summarizeAttendanceDay(
    baseRow({ schedule_kind: 'OFF' }),
    [],
    afterDay,
    { leaveRequests: [leaveRequest()] },
  );

  assert.equal(day.status, 'DAY_OFF');
  assert.equal(day.leaveCreditedMinutes, 0);
  assert.equal(day.unexcusedAbsenceFraction, 0);
});

test('Issue #1110 Lô 8 projects approved full-day leave with its snapshot and counted minutes', () => {
  const day = summarizeAttendanceDay(
    baseRow(),
    [],
    afterDay,
    { leaveRequests: [leaveRequest()] },
  );

  assert.equal(day.status, 'APPROVED_LEAVE');
  assert.equal(day.leave.approvedFraction, 1);
  assert.deepEqual(day.leave.approvedLabels, ['Nghỉ phép năm']);
  assert.equal(day.missingCheckIn, false);
  assert.equal(day.missingCheckOut, false);
  assert.equal(day.leaveCreditedMinutes, 480);
  assert.equal(day.countedMinutes, 480);
  assert.equal(day.unexcusedAbsenceFraction, 0);
});

test('Issue #1110 Lô 8 evaluates half-day leave from the shift segment instead of hard-coding morning/afternoon', () => {
  const day = summarizeAttendanceDay(
    baseRow(),
    [
      attendanceEvent('in', 'CHECK_IN', '2026-09-18T05:30:00.000Z'),
      attendanceEvent('out', 'CHECK_OUT', '2026-09-18T10:00:00.000Z'),
    ],
    afterDay,
    { leaveRequests: [leaveRequest({ dayPart: 'FIRST_HALF' })] },
  );

  assert.equal(day.status, 'APPROVED_LEAVE');
  assert.equal(day.attendanceStatus, 'COMPLETE');
  assert.equal(day.leave.approvedFraction, 0.5);
  assert.equal(day.requiredStartAt, '2026-09-18T05:30:00.000Z');
  assert.equal(day.requiredEndAt, '2026-09-18T10:00:00.000Z');
  assert.equal(day.leaveCreditedMinutes, 240);
  assert.equal(day.countedMinutes, 480);
  assert.equal(day.lateMinutes, 0);
  assert.equal(day.earlyLeaveMinutes, 0);
  assert.equal(day.unexcusedAbsenceFraction, 0);
});

test('Issue #1110 Lô 8 keeps the uncovered half-day visible as partial unexcused absence', () => {
  const day = summarizeAttendanceDay(
    baseRow(),
    [],
    afterDay,
    { leaveRequests: [leaveRequest({ dayPart: 'FIRST_HALF' })] },
  );

  assert.equal(day.status, 'APPROVED_LEAVE');
  assert.equal(day.leave.approvedFraction, 0.5);
  assert.equal(day.unexcusedAbsenceFraction, 0.5);
  assert.equal(day.leaveCreditedMinutes, 240);
});

test('Issue #1110 Lô 8 separates pending leave, pending adjustment, absence and incomplete attendance', () => {
  const pendingLeave = summarizeAttendanceDay(
    baseRow(),
    [],
    afterDay,
    { leaveRequests: [leaveRequest({ status: 'SUBMITTED' })] },
  );
  assert.equal(pendingLeave.status, 'PENDING_LEAVE');
  assert.equal(pendingLeave.unexcusedAbsenceFraction, 0);

  const pendingAdjustment = summarizeAttendanceDay(
    baseRow(),
    [],
    afterDay,
    { adjustment: { status: 'SUBMITTED' }, leaveRequests: [] },
  );
  assert.equal(pendingAdjustment.status, 'PENDING_ADJUSTMENT');
  assert.equal(pendingAdjustment.attendanceStatus, 'UNEXCUSED_ABSENCE');
  assert.equal(pendingAdjustment.unexcusedAbsenceFraction, 0);

  const absent = summarizeAttendanceDay(baseRow(), [], afterDay);
  assert.equal(absent.status, 'UNEXCUSED_ABSENCE');
  assert.equal(absent.unexcusedAbsenceFraction, 1);

  const incomplete = summarizeAttendanceDay(
    baseRow(),
    [attendanceEvent('in-only', 'CHECK_IN', '2026-09-18T01:00:00.000Z')],
    afterDay,
  );
  assert.equal(incomplete.status, 'MISSING_CHECK_OUT');
  assert.equal(incomplete.unexcusedAbsenceFraction, 0);
});

test('Issue #1110 Lô 8 monthly summary keeps leave, absence, incomplete and future facts separate', () => {
  const halfLeaveAbsent = summarizeAttendanceDay(
    baseRow(),
    [],
    afterDay,
    { leaveRequests: [leaveRequest({ dayPart: 'FIRST_HALF' })] },
  );
  const future = summarizeAttendanceDay(
    baseRow({
      work_date: '2026-09-22',
      scheduled_start_at: '2026-09-22T01:00:00.000Z',
      scheduled_end_at: '2026-09-22T10:00:00.000Z',
    }),
    [],
    new Date('2026-09-21T03:00:00.000Z'),
    { leaveRequests: [leaveRequest({ date: '2026-09-22' })] },
  );
  const employee = {
    id: halfLeaveAbsent.employee.id,
    code: halfLeaveAbsent.employee.code,
    full_name: halfLeaveAbsent.employee.name,
    branch_id: halfLeaveAbsent.employee.branchId,
    branch_code: halfLeaveAbsent.employee.branchCode,
    branch_name: halfLeaveAbsent.employee.branchName,
  };
  const month = summarizeAttendanceMonth(employee, [halfLeaveAbsent, future], {
    from: '2026-09-01',
    to: '2026-09-30',
  });

  assert.equal(month.workDays, 1);
  assert.equal(month.approvedLeaveDays, 0.5);
  assert.equal(month.unexcusedAbsenceDays, 0.5);
  assert.equal(month.pendingLeaveDays, 0);
  assert.equal(month.incompleteDays, 0);
  assert.equal(month.countedMinutes, 240);
  assert.equal(month.leaveCreditedMinutes, 240);
});

test('Issue #1110 Lô 8 reads canonical leave requests into the timesheet without adding a write path', async () => {
  const [service, repository, dayRepository] = await Promise.all([
    source('src/services/attendance-timesheet.js'),
    source('src/db/repositories/leave-management.js'),
    source('src/db/repositories/attendance-timesheet.js'),
  ]);

  assert.match(service, /leaveRepo\.listRequestsForTimesheet/);
  assert.match(service, /expandLeaveRequestsByDay/);
  assert.match(service, /policy_minimum_half_day_minutes/);
  assert.match(service, /PENDING_ADJUSTMENT/);
  assert.match(dayRepository, /minimum_full_day_minutes AS policy_minimum_full_day_minutes/);
  assert.match(dayRepository, /minimum_half_day_minutes AS policy_minimum_half_day_minutes/);

  const readFunction = repository.match(/export async function listRequestsForTimesheet[\s\S]*?\n}\n\nexport async function findOverlappingLeaveRequest/);
  assert.ok(readFunction);
  assert.match(readFunction[0], /status IN \('SUBMITTED', 'APPROVED'\)/);
  assert.match(readFunction[0], /r\.date_to >= \$3::date/);
  assert.match(readFunction[0], /r\.date_from <= \$4::date/);
  assert.doesNotMatch(readFunction[0], /INSERT INTO|UPDATE shared|DELETE FROM/);
});

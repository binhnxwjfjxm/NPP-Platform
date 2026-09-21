import test from 'node:test';
import assert from 'node:assert/strict';
import {
  summarizeAttendanceDay,
  summarizeAttendanceMonth,
} from '../src/services/attendance-timesheet.js';

function baseRow(overrides = {}) {
  return {
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
    override_reason: null,
    assigned_work_policy_id: '44444444-4444-4444-8444-444444444444',
    policy_id: '44444444-4444-4444-8444-444444444444',
    policy_code: 'VP',
    policy_version: 1,
    policy_name: 'Giờ hành chính',
    policy_time_mode: 'FIXED',
    policy_fixed_start_time: '08:00',
    policy_fixed_end_time: '17:00',
    policy_working_days: [1, 2, 3, 4, 5],
    policy_break_minutes: 60,
    policy_minimum_full_day_minutes: 480,
    policy_minimum_half_day_minutes: 240,
    policy_late_grace_minutes: 5,
    policy_early_leave_grace_minutes: 5,
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

function leaveRequest(dayPart = 'FULL_DAY', status = 'APPROVED') {
  return {
    id: 'leave-1',
    installation_id: 'default',
    employee_id: '11111111-1111-4111-8111-111111111111',
    leave_type_id: '55555555-5555-4555-8555-555555555555',
    leave_type_code_snapshot: 'PHEP_NAM',
    leave_type_name_snapshot: 'Nghỉ phép năm',
    leave_is_paid_snapshot: true,
    leave_counts_as_workday_snapshot: true,
    leave_requires_approval_snapshot: true,
    date_from: '2026-09-18',
    date_to: '2026-09-18',
    day_part: dayPart,
    reason: 'Việc cá nhân',
    attachment_reference: null,
    status,
    reviewed_by_actor_id: status === 'APPROVED' ? 'manager-1' : null,
    review_reason: null,
    reviewed_at: null,
    version: 1,
    request_id: 'req-leave',
    created_at: '2026-09-18T00:00:00.000Z',
    updated_at: '2026-09-18T00:00:00.000Z',
  };
}

const afterDay = new Date('2026-09-19T03:00:00.000Z');

test('Issue #1110 Lô 9 derives late and early violations from the versioned Work Policy thresholds', () => {
  const day = summarizeAttendanceDay(
    baseRow(),
    [
      attendanceEvent('in', 'CHECK_IN', '2026-09-18T01:12:00.000Z'),
      attendanceEvent('out', 'CHECK_OUT', '2026-09-18T09:45:00.000Z'),
    ],
    afterDay,
  );

  assert.equal(day.violationEvaluation.state, 'HAS_VIOLATIONS');
  assert.deepEqual(day.violationEvaluation.items.map((item) => item.kind), ['LATE', 'EARLY_LEAVE']);
  assert.equal(day.violationEvaluation.items[0].minutes, 7);
  assert.equal(day.violationEvaluation.items[1].minutes, 10);
  assert.match(day.violationEvaluation.items[0].detail, /ngưỡng 5 phút/);
  assert.match(day.violationEvaluation.items[1].detail, /ngưỡng 5 phút/);
});

test('Issue #1110 Lô 9 records incomplete attendance separately from unexcused absence', () => {
  const missing = summarizeAttendanceDay(
    baseRow(),
    [attendanceEvent('in', 'CHECK_IN', '2026-09-18T01:00:00.000Z')],
    afterDay,
  );
  assert.equal(missing.violationEvaluation.state, 'HAS_VIOLATIONS');
  assert.deepEqual(missing.violationEvaluation.items.map((item) => item.kind), ['MISSING_ATTENDANCE']);
  assert.match(missing.violationEvaluation.items[0].detail, /thiếu giờ ra/);

  const absent = summarizeAttendanceDay(baseRow(), [], afterDay);
  assert.equal(absent.violationEvaluation.state, 'HAS_VIOLATIONS');
  assert.deepEqual(absent.violationEvaluation.items.map((item) => item.kind), ['UNEXCUSED_ABSENCE']);
  assert.equal(absent.violationEvaluation.items[0].dayFraction, 1);
});

test('Issue #1110 Lô 9 evaluates only the uncovered segment after approved half-day leave', () => {
  const day = summarizeAttendanceDay(
    baseRow(),
    [],
    afterDay,
    { leaveRequests: [leaveRequest('FIRST_HALF', 'APPROVED')] },
  );

  assert.equal(day.status, 'APPROVED_LEAVE');
  assert.equal(day.unexcusedAbsenceFraction, 0.5);
  assert.equal(day.violationEvaluation.state, 'HAS_VIOLATIONS');
  assert.equal(day.violationEvaluation.items[0].kind, 'UNEXCUSED_ABSENCE');
  assert.equal(day.violationEvaluation.items[0].dayFraction, 0.5);
});

test('Issue #1110 Lô 9 does not conclude violations while leave or attendance adjustment is pending', () => {
  const pendingLeave = summarizeAttendanceDay(
    baseRow(),
    [],
    afterDay,
    { leaveRequests: [leaveRequest('FULL_DAY', 'SUBMITTED')] },
  );
  assert.equal(pendingLeave.violationEvaluation.state, 'PENDING_LEAVE');
  assert.deepEqual(pendingLeave.violationEvaluation.items, []);

  const pendingAdjustment = summarizeAttendanceDay(
    baseRow(),
    [],
    afterDay,
    { adjustment: { status: 'SUBMITTED' }, leaveRequests: [] },
  );
  assert.equal(pendingAdjustment.violationEvaluation.state, 'PENDING_ADJUSTMENT');
  assert.deepEqual(pendingAdjustment.violationEvaluation.items, []);
});

test('Issue #1110 Lô 9 excludes future, day-off and configuration-error days from violation conclusions', () => {
  const future = summarizeAttendanceDay(
    baseRow({
      work_date: '2026-09-22',
      scheduled_start_at: '2026-09-22T01:00:00.000Z',
      scheduled_end_at: '2026-09-22T10:00:00.000Z',
    }),
    [],
    new Date('2026-09-21T03:00:00.000Z'),
  );
  assert.equal(future.violationEvaluation.state, 'NOT_DUE');

  const dayOff = summarizeAttendanceDay(baseRow({ schedule_kind: 'OFF' }), [], afterDay);
  assert.equal(dayOff.violationEvaluation.state, 'NOT_APPLICABLE');

  const missingPolicy = summarizeAttendanceDay(
    baseRow({
      policy_id: null,
      assigned_work_policy_id: null,
      schedule_work_policy_id: null,
      schedule_id: null,
      schedule_kind: null,
    }),
    [],
    afterDay,
  );
  assert.equal(missingPolicy.violationEvaluation.state, 'CONFIGURATION_ERROR');
});

test('Issue #1110 Lô 9 monthly summary counts violation categories without creating a penalty score', () => {
  const late = summarizeAttendanceDay(
    baseRow(),
    [
      attendanceEvent('late-in', 'CHECK_IN', '2026-09-18T01:12:00.000Z'),
      attendanceEvent('late-out', 'CHECK_OUT', '2026-09-18T10:00:00.000Z'),
    ],
    afterDay,
  );
  const absent = summarizeAttendanceDay(
    baseRow({
      work_date: '2026-09-17',
      scheduled_start_at: '2026-09-17T01:00:00.000Z',
      scheduled_end_at: '2026-09-17T10:00:00.000Z',
    }),
    [],
    afterDay,
  );
  const employee = {
    id: late.employee.id,
    code: late.employee.code,
    full_name: late.employee.name,
    branch_id: late.employee.branchId,
    branch_code: late.employee.branchCode,
    branch_name: late.employee.branchName,
  };
  const month = summarizeAttendanceMonth(employee, [late, absent], {
    from: '2026-09-01',
    to: '2026-09-30',
  });

  assert.equal(month.violationDays, 2);
  assert.equal(month.lateViolationDays, 1);
  assert.equal(month.earlyLeaveViolationDays, 0);
  assert.equal(month.missingAttendanceViolationDays, 0);
  assert.equal(month.unexcusedAbsenceViolationDays, 1);
  assert.equal('penaltyAmount' in month, false);
  assert.equal('salaryDeduction' in month, false);
});

import * as timesheetRepo from '../db/repositories/attendance-timesheet.js';
import * as adjustmentRepo from '../db/repositories/attendance-adjustments.js';
import * as workforceRepo from '../db/repositories/workforce.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const INSTALLATION_TIMEZONE = 'Asia/Ho_Chi_Minh';
const MAX_PERIOD_DAYS = 93;

function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function fail(code, message) { return { ok: false, code, message, retryable: false }; }
function validUuid(value) { return typeof value === 'string' && UUID_PATTERN.test(value.trim()); }
function validDate(value) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function integer(value, min, max, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : NaN;
}
function nextDate(value) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
function shiftDate(value, days) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function dayOfWeek(value) { return new Date(`${value}T00:00:00Z`).getUTCDay(); }
function timeMinutes(value) {
  const match = /^(\d{2}):(\d{2})/.exec(String(value ?? ''));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}
function localDate(timeZone = INSTALLATION_TIMEZONE, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}
function localClockMinutes(timeZone, now) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(map.hour) * 60 + Number(map.minute);
}
function zonedLocalDateTimeToIso(dateValue, timeValue, timeZone) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
  const clock = /^(\d{2}):(\d{2})/.exec(String(timeValue ?? ''));
  if (!dateMatch || !clock) return null;
  const wanted = Date.UTC(
    Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]),
    Number(clock[1]), Number(clock[2]), 0,
  );
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const wallAsUtc = (timestamp) => {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]),
    );
    return Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second),
    );
  };
  let offset = wallAsUtc(wanted) - wanted;
  let utc = wanted - offset;
  const secondOffset = wallAsUtc(utc) - utc;
  if (secondOffset !== offset) utc = wanted - secondOffset;
  return new Date(utc).toISOString();
}
function monthBounds(now) {
  const today = localDate(INSTALLATION_TIMEZONE, now);
  const [year, month] = today.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    from: `${year}-${String(month).padStart(2, '0')}-01`,
    to: `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
  };
}
function periodDays(from, to) {
  return Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}
function asIso(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
function policyWorkingDay(row) {
  return Array.isArray(row.policy_working_days)
    && row.policy_working_days.map(Number).includes(dayOfWeek(String(row.work_date)));
}
function expectedTimes(row) {
  if (row.schedule_kind === 'WORK') {
    return {
      expectedStartAt: asIso(row.scheduled_start_at),
      expectedEndAt: asIso(row.scheduled_end_at),
    };
  }
  if (row.policy_time_mode !== 'FIXED') return { expectedStartAt: null, expectedEndAt: null };
  const zone = row.policy_timezone || INSTALLATION_TIMEZONE;
  const startMinutes = timeMinutes(row.policy_fixed_start_time);
  const endMinutes = timeMinutes(row.policy_fixed_end_time);
  if (startMinutes === null || endMinutes === null) return { expectedStartAt: null, expectedEndAt: null };
  const endDate = endMinutes <= startMinutes ? nextDate(String(row.work_date)) : String(row.work_date);
  return {
    expectedStartAt: zonedLocalDateTimeToIso(String(row.work_date), row.policy_fixed_start_time, zone),
    expectedEndAt: zonedLocalDateTimeToIso(endDate, row.policy_fixed_end_time, zone),
  };
}
function eventsForDay(row, events) {
  if (!events.length) return [];
  const zone = row.policy_timezone || INSTALLATION_TIMEZONE;
  const workDate = String(row.work_date);
  const startMinutes = timeMinutes(row.policy_fixed_start_time);
  const endMinutes = timeMinutes(row.policy_fixed_end_time);
  const overnight = row.policy_time_mode === 'FIXED'
    && startMinutes !== null && endMinutes !== null && endMinutes <= startMinutes;

  let byLocalWindow;
  if (!overnight) {
    byLocalWindow = events.filter((event) => localDate(zone, new Date(event.occurred_at)) === workDate);
  } else {
    const next = nextDate(workDate);
    const previousShiftCutoff = Math.min(23 * 60 + 59, endMinutes + 240);
    byLocalWindow = events.filter((event) => {
      const instant = new Date(event.occurred_at);
      const eventDate = localDate(zone, instant);
      const clock = localClockMinutes(zone, instant);
      if (eventDate === workDate) return clock > previousShiftCutoff;
      return eventDate === next && clock <= previousShiftCutoff;
    });
  }

  if (!row.schedule_id) return byLocalWindow;
  const bySchedule = events.filter((event) => String(event.schedule_id ?? '') === String(row.schedule_id));
  const adjustmentIds = new Set(
    byLocalWindow
      .filter((event) => event.source === 'ADJUSTMENT')
      .map((event) => String(event.id)),
  );
  if (!bySchedule.length && !adjustmentIds.size) return byLocalWindow;
  const combined = [...bySchedule];
  for (const event of byLocalWindow) {
    if (adjustmentIds.has(String(event.id)) && !combined.some((item) => String(item.id) === String(event.id))) {
      combined.push(event);
    }
  }
  return combined;
}

export function selectEffectiveAttendanceEvents(events) {
  const valid = events.filter((event) => event.validation_status === 'VALID');
  const selected = [];
  for (const eventType of ['CHECK_IN', 'CHECK_OUT']) {
    const typed = valid.filter((event) => event.event_type === eventType);
    const adjustments = typed.filter((event) => event.source === 'ADJUSTMENT');
    if (adjustments.length) {
      const latest = [...adjustments].sort((left, right) => {
        const created = new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
        return created || String(left.id).localeCompare(String(right.id));
      }).at(-1);
      if (latest) selected.push(latest);
    } else {
      selected.push(...typed);
    }
  }
  return selected.sort((left, right) => {
    const occurred = new Date(left.occurred_at).getTime() - new Date(right.occurred_at).getTime();
    return occurred || String(left.id).localeCompare(String(right.id));
  });
}

function pairValidEvents(events) {
  const valid = selectEffectiveAttendanceEvents(events);
  const pairs = [];
  let open = null;
  let unmatchedOut = 0;
  for (const event of valid) {
    if (event.event_type === 'CHECK_IN') {
      if (!open) open = event;
      continue;
    }
    if (!open) {
      unmatchedOut += 1;
      continue;
    }
    const start = new Date(open.occurred_at).getTime();
    const end = new Date(event.occurred_at).getTime();
    if (end >= start) pairs.push({ checkIn: open, checkOut: event, start, end });
    open = null;
  }
  return { valid, pairs, open, unmatchedOut };
}

function overlapMinutes(pairs, startAt, endAt) {
  if (!startAt || !endAt) {
    return Math.round(pairs.reduce((sum, pair) => sum + Math.max(0, pair.end - pair.start), 0) / 60_000);
  }
  const start = new Date(startAt).getTime();
  const end = new Date(endAt).getTime();
  return Math.round(pairs.reduce((sum, pair) => (
    sum + Math.max(0, Math.min(pair.end, end) - Math.max(pair.start, start))
  ), 0) / 60_000);
}
function minutesAfter(value, reference, graceMinutes) {
  if (!value || !reference) return 0;
  const difference = new Date(value).getTime() - new Date(reference).getTime() - Number(graceMinutes || 0) * 60_000;
  return Math.max(0, Math.floor(difference / 60_000));
}
function minutesBefore(value, reference, graceMinutes) {
  if (!value || !reference) return 0;
  const difference = new Date(reference).getTime() - new Date(value).getTime() - Number(graceMinutes || 0) * 60_000;
  return Math.max(0, Math.floor(difference / 60_000));
}

export function summarizeAttendanceDay(row, employeeEvents, now = new Date(), control = {}) {
  const workDate = String(row.work_date);
  const timeZone = row.policy_timezone || INSTALLATION_TIMEZONE;
  const events = eventsForDay(row, employeeEvents);
  const pairing = pairValidEvents(events);
  const firstCheckIn = pairing.valid.find((event) => event.event_type === 'CHECK_IN') ?? null;
  const lastCheckOut = [...pairing.valid].reverse().find((event) => event.event_type === 'CHECK_OUT') ?? null;
  const { expectedStartAt, expectedEndAt } = expectedTimes(row);
  const actualMinutes = Math.round(
    pairing.pairs.reduce((sum, pair) => sum + Math.max(0, pair.end - pair.start), 0) / 60_000,
  );
  const countedBeforeBreak = overlapMinutes(pairing.pairs, expectedStartAt, expectedEndAt);
  const countedMinutes = Math.max(0, countedBeforeBreak - Number(row.policy_break_minutes || 0));
  const lateMinutes = minutesAfter(
    firstCheckIn?.occurred_at,
    expectedStartAt,
    row.policy_late_grace_minutes,
  );
  const earlyLeaveMinutes = minutesBefore(
    lastCheckOut?.occurred_at,
    expectedEndAt,
    row.policy_early_leave_grace_minutes,
  );

  const hasPolicy = Boolean(row.policy_id);
  const scheduledWorkDay = row.schedule_kind === 'WORK'
    || (!row.schedule_kind && hasPolicy && policyWorkingDay(row));
  const today = localDate(timeZone, now);
  const isPast = workDate < today;
  const isFuture = workDate > today;
  const nowMs = now.getTime();
  const startDue = expectedStartAt
    ? nowMs > new Date(expectedStartAt).getTime() + Number(row.policy_late_grace_minutes || 0) * 60_000
    : false;
  const endDue = expectedEndAt ? nowMs > new Date(expectedEndAt).getTime() : false;
  const hasCheckIn = Boolean(firstCheckIn);
  const hasCheckOut = Boolean(lastCheckOut);
  const missingCheckIn = !isFuture && scheduledWorkDay && !hasCheckIn && (isPast || startDue || hasCheckOut);
  const missingCheckOut = !isFuture && scheduledWorkDay
    && (!hasCheckOut || Boolean(pairing.open)) && (isPast || endDue);
  const incompleteSequence = pairing.unmatchedOut > 0
    || (hasCheckIn && hasCheckOut && pairing.pairs.length === 0);

  let status = 'COMPLETE';
  if (row.schedule_kind === 'OFF' || (hasPolicy && !row.schedule_kind && !policyWorkingDay(row))) {
    status = 'DAY_OFF';
  } else if (!hasPolicy) {
    status = 'MISSING_POLICY';
  } else if (row.policy_time_mode === 'NO_ATTENDANCE' || row.policy_attendance_method === 'NONE') {
    status = 'NO_ATTENDANCE_REQUIRED';
  } else if (row.policy_time_mode === 'SHIFT' && !row.schedule_id && scheduledWorkDay) {
    status = 'MISSING_SCHEDULE';
  } else if (isFuture) {
    status = 'UPCOMING';
  } else if (missingCheckIn && missingCheckOut) {
    status = 'INCOMPLETE';
  } else if (missingCheckIn) {
    status = 'MISSING_CHECK_IN';
  } else if (missingCheckOut) {
    status = 'MISSING_CHECK_OUT';
  } else if (incompleteSequence) {
    status = 'INCOMPLETE';
  } else if (pairing.open) {
    status = 'WORKING';
  } else if (!hasCheckIn && !hasCheckOut) {
    status = 'NOT_STARTED';
  } else if (lateMinutes > 0 && earlyLeaveMinutes > 0) {
    status = 'LATE_AND_EARLY';
  } else if (lateMinutes > 0) {
    status = 'LATE';
  } else if (earlyLeaveMinutes > 0) {
    status = 'EARLY';
  }

  const attendanceSources = [...new Set(events.map((event) => String(event.source)))];
  const validWork = ['COMPLETE', 'LATE', 'EARLY', 'LATE_AND_EARLY'].includes(status);
  return {
    workDate,
    employee: {
      id: row.employee_id,
      code: row.employee_code,
      name: row.employee_name,
      branchId: row.employee_branch_id ?? null,
      branchCode: row.branch_code ?? null,
      branchName: row.branch_name ?? null,
    },
    policy: hasPolicy ? {
      id: row.policy_id,
      code: row.policy_code,
      version: Number(row.policy_version),
      name: row.policy_name,
      timeMode: row.policy_time_mode,
      timezone: timeZone,
      breakMinutes: Number(row.policy_break_minutes || 0),
    } : null,
    schedule: row.schedule_id ? {
      id: row.schedule_id,
      kind: row.schedule_kind,
      source: row.schedule_source,
    } : null,
    expectedStartAt,
    expectedEndAt,
    checkInAt: asIso(firstCheckIn?.occurred_at),
    checkOutAt: asIso(lastCheckOut?.occurred_at),
    actualMinutes,
    countedMinutes,
    lateMinutes,
    earlyLeaveMinutes,
    missingCheckIn,
    missingCheckOut,
    scheduledWorkDay,
    validWork,
    status,
    attendanceSources,
    scheduleSource: row.schedule_source ?? (hasPolicy ? 'POLICY' : null),
    adjustment: control.adjustment ?? null,
    periodLock: control.periodLock ?? null,
    events: events.map((event) => ({
      ...event,
      occurred_at: asIso(event.occurred_at),
      created_at: asIso(event.created_at),
    })),
  };
}

export function summarizeAttendanceMonth(employee, days, period) {
  const attendanceSources = [...new Set(days.flatMap((day) => day.attendanceSources))];
  const scheduleSources = [...new Set(days.map((day) => day.scheduleSource).filter(Boolean))];
  return {
    employee: {
      id: employee.id,
      code: employee.code,
      name: employee.full_name,
      branchId: employee.branch_id ?? null,
      branchCode: employee.branch_code ?? null,
      branchName: employee.branch_name ?? null,
    },
    period,
    workDays: days.filter((day) => day.scheduledWorkDay).length,
    completedDays: days.filter((day) => day.validWork).length,
    missingDays: days.filter((day) => (
      day.missingCheckIn
      || day.missingCheckOut
      || day.status === 'MISSING_POLICY'
      || day.status === 'MISSING_SCHEDULE'
      || day.status === 'INCOMPLETE'
    )).length,
    actualMinutes: days.reduce((sum, day) => sum + day.actualMinutes, 0),
    countedMinutes: days.reduce((sum, day) => sum + day.countedMinutes, 0),
    lateMinutes: days.reduce((sum, day) => sum + day.lateMinutes, 0),
    earlyLeaveMinutes: days.reduce((sum, day) => sum + day.earlyLeaveMinutes, 0),
    adjustedDays: days.filter((day) => day.attendanceSources.includes('ADJUSTMENT')).length,
    pendingAdjustmentDays: days.filter((day) => day.adjustment?.status === 'SUBMITTED').length,
    lockedDays: days.filter((day) => Boolean(day.periodLock)).length,
    attendanceSources,
    scheduleSources,
    days,
  };
}

function broadEventWindow(dateFrom, dateTo) {
  return {
    fromAt: new Date(`${shiftDate(dateFrom, -2)}T00:00:00Z`).toISOString(),
    toAt: new Date(`${shiftDate(nextDate(dateTo), 2)}T00:00:00Z`).toISOString(),
  };
}

export async function listAttendanceTimesheet(client, {
  installationId,
  view: rawView,
  dateFrom: rawDateFrom,
  dateTo: rawDateTo,
  employeeId: rawEmployeeId = null,
  employeeQuery: rawEmployeeQuery = null,
  branchId: rawBranchId = null,
  branchIds = null,
  branchOptionIds = branchIds,
  companyScope = false,
  selfOnly = false,
  limit: rawLimit,
  offset: rawOffset,
  now = new Date(),
}) {
  const defaults = monthBounds(now);
  const view = text(rawView).toLowerCase() || 'daily';
  if (!['daily', 'monthly'].includes(view)) {
    return fail('INVALID_TIMESHEET_VIEW', 'Chế độ xem bảng công không hợp lệ');
  }
  const dateFrom = text(rawDateFrom) || defaults.from;
  const dateTo = text(rawDateTo) || defaults.to;
  if (!validDate(dateFrom) || !validDate(dateTo) || dateTo < dateFrom) {
    return fail('INVALID_ATTENDANCE_PERIOD', 'Khoảng thời gian bảng công không hợp lệ');
  }
  if (periodDays(dateFrom, dateTo) > MAX_PERIOD_DAYS) {
    return fail('ATTENDANCE_PERIOD_TOO_LARGE', 'Mỗi lần chỉ xem tối đa 93 ngày bảng công');
  }

  const employeeId = text(rawEmployeeId) || null;
  if (employeeId && !validUuid(employeeId)) return fail('EMPLOYEE_NOT_FOUND', 'Không tìm thấy nhân sự');
  const employeeQuery = text(rawEmployeeQuery) || null;
  if (employeeQuery && employeeQuery.length > 80) {
    return fail('INVALID_EMPLOYEE_FILTER', 'Từ khóa nhân sự tối đa 80 ký tự');
  }
  const branchId = text(rawBranchId) || null;
  if (branchId && !validUuid(branchId)) return fail('BRANCH_NOT_FOUND', 'Chi nhánh không hợp lệ');

  const maxLimit = view === 'monthly' ? 25 : 100;
  const defaultLimit = view === 'monthly' ? 20 : 50;
  const limit = integer(rawLimit, 1, maxLimit, defaultLimit);
  const offset = integer(rawOffset, 0, 1_000_000, 0);
  if (Number.isNaN(limit) || Number.isNaN(offset)) {
    return fail('INVALID_PAGINATION', 'Thông tin phân trang bảng công không hợp lệ');
  }

  const branches = await workforceRepo.listAttendanceBranches(client, {
    installationId,
    branchIds: branchOptionIds,
  });

  let facts;
  let total;
  let employees = null;
  if (view === 'monthly') {
    const page = await timesheetRepo.listEmployeePage(client, {
      installationId, employeeId, employeeQuery, branchId, branchIds, limit, offset,
    });
    employees = page.rows;
    total = page.total;
    facts = await timesheetRepo.listDayFactsForEmployees(client, {
      installationId,
      dateFrom,
      dateTo,
      employeeIds: employees.map((employee) => employee.id),
    });
  } else {
    const page = await timesheetRepo.listDayFacts(client, {
      installationId, dateFrom, dateTo, employeeId, employeeQuery, branchId, branchIds, limit, offset,
    });
    facts = page.rows;
    total = page.total;
  }

  const employeeIds = [...new Set(facts.map((row) => String(row.employee_id)))];
  const window = broadEventWindow(dateFrom, dateTo);
  const [events, adjustmentRequests, periodLocks] = await Promise.all([
    timesheetRepo.listEvents(client, {
      installationId, employeeIds, ...window,
    }),
    adjustmentRepo.listRequestsForTimesheet(client, {
      installationId, employeeIds, dateFrom, dateTo,
    }),
    adjustmentRepo.listPeriodLocksForTimesheet(client, {
      installationId, dateFrom, dateTo,
    }),
  ]);
  const byEmployee = new Map();
  for (const event of events) {
    const key = String(event.employee_id);
    const bucket = byEmployee.get(key) ?? [];
    bucket.push(event);
    byEmployee.set(key, bucket);
  }
  const requestByDay = new Map();
  for (const request of adjustmentRequests) {
    const key = `${request.employee_id}:${request.work_date}`;
    if (!requestByDay.has(key)) requestByDay.set(key, request);
  }
  const days = facts.map((row) => {
    const workDate = String(row.work_date);
    const branchId = row.employee_branch_id ? String(row.employee_branch_id) : null;
    const periodLock = periodLocks.find((lock) => (
      String(lock.period_start) <= workDate
      && String(lock.period_end) >= workDate
      && (lock.branch_id == null || String(lock.branch_id) === branchId)
    )) ?? null;
    return summarizeAttendanceDay(
      row,
      byEmployee.get(String(row.employee_id)) ?? [],
      now,
      {
        adjustment: requestByDay.get(`${row.employee_id}:${workDate}`) ?? null,
        periodLock,
      },
    );
  });

  const rows = view === 'monthly'
    ? employees.map((employee) => summarizeAttendanceMonth(
      employee,
      days.filter((day) => day.employee.id === employee.id),
      { from: dateFrom, to: dateTo },
    ))
    : days;

  return {
    ok: true,
    timesheet: {
      view,
      period: { from: dateFrom, to: dateTo, timezone: INSTALLATION_TIMEZONE },
      scope: {
        companyScope: Boolean(companyScope),
        selfOnly: Boolean(selfOnly),
        branches,
      },
      pagination: {
        limit,
        offset,
        total,
        hasPrevious: offset > 0,
        hasNext: offset + rows.length < total,
      },
      rows,
    },
  };
}

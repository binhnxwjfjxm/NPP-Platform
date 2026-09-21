import * as repo from '../db/repositories/workforce-planning.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const INSTALLATION_TIMEZONE = 'Asia/Ho_Chi_Minh';

function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function fail(code, message) { return { ok: false, code, message, retryable: false }; }
function validUuid(value) { return typeof value === 'string' && UUID.test(value.trim()); }
function validDate(value) {
  if (typeof value !== 'string' || !DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function today() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: INSTALLATION_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function shiftDate(value, days) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
function dayOfWeek(value) { return new Date(`${value}T00:00:00Z`).getUTCDay(); }
function timeMinutes(value) {
  const match = /^(\d{2}):(\d{2})/.exec(String(value ?? ''));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}
function validRange(from, to, maxDays, futureOnly = false) {
  if (!validDate(from) || !validDate(to) || to < from) return false;
  if (futureOnly && from <= today()) return false;
  return daysBetween(from, to) + 1 <= maxDays;
}
function employeeIds(value) {
  if (!Array.isArray(value)) return null;
  const ids = [...new Set(value.map((item) => text(item)).filter(Boolean))];
  if (!ids.length || ids.length > 500 || ids.some((id) => !validUuid(id))) return null;
  return ids;
}
function assignmentFor(assignments, employeeId, workDate) {
  return assignments.find((item) => (
    String(item.employee_id) === String(employeeId)
    && item.effective_from <= workDate
    && (!item.effective_to || item.effective_to >= workDate)
    && item.policy_effective_from <= workDate
    && (!item.policy_effective_to || item.policy_effective_to >= workDate)
  )) ?? null;
}
function zonedIso(dateValue, timeValue, timeZone) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
  const clock = /^(\d{2}):(\d{2})/.exec(String(timeValue ?? ''));
  if (!dateMatch || !clock) return null;
  const wanted = Date.UTC(
    Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]),
    Number(clock[1]), Number(clock[2]), 0,
  );
  try {
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
  } catch {
    return null;
  }
}

async function scopedEmployees(client, { installationId, ids, branchIds }) {
  const employees = await repo.listEmployeesByIds(client, { installationId, employeeIds: ids });
  if (employees.length !== ids.length) return fail('EMPLOYEE_NOT_FOUND', 'Có nhân sự không còn tồn tại trong danh sách đã chọn');
  if (employees.some((employee) => !employee.is_active)) return fail('EMPLOYEE_INACTIVE', 'Danh sách có nhân sự đã ngừng làm việc');
  if (Array.isArray(branchIds)) {
    const allowed = new Set(branchIds.map(String));
    if (employees.some((employee) => !employee.branch_id || !allowed.has(String(employee.branch_id)))) {
      return fail('SCOPE_FORBIDDEN', 'Danh sách có nhân sự ngoài phạm vi được cấp');
    }
  }
  return { ok: true, employees };
}

function summaryAudit(action, resourceId, summary, metadata) {
  return {
    action,
    resourceType: 'work-schedule-bulk',
    resourceId,
    beforeData: null,
    afterData: summary,
    metadata,
  };
}

export async function applyWeekTemplate(client, { installationId, payload, actorId, branchIds }) {
  const weekTemplateId = text(payload.weekTemplateId);
  const ids = employeeIds(payload.employeeIds);
  const fromDate = text(payload.fromDate);
  const toDate = text(payload.toDate);
  const reason = text(payload.reason);
  if (!validUuid(weekTemplateId)) return fail('WEEK_TEMPLATE_NOT_FOUND', 'Không tìm thấy mẫu lịch tuần');
  if (!ids) return fail('INVALID_EMPLOYEE_SELECTION', 'Hãy chọn từ 1 đến 500 nhân sự');
  if (!validRange(fromDate, toDate, 93, true)) return fail('INVALID_SCHEDULE_RANGE', 'Khoảng xếp lịch phải từ ngày mai, không quá 93 ngày');
  if (!reason || reason.length > 512) return fail('SCHEDULE_REASON_REQUIRED', 'Phải nhập lý do xếp lịch hàng loạt');

  const scope = await scopedEmployees(client, { installationId, ids, branchIds });
  if (!scope.ok) return scope;
  const template = await repo.getWeekTemplateById(client, { installationId, id: weekTemplateId });
  if (!template || !template.is_active) return fail('WEEK_TEMPLATE_NOT_FOUND', 'Mẫu lịch tuần không còn hoạt động');
  const dayMap = new Map(template.days.map((day) => [Number(day.weekday), day]));
  if (dayMap.size !== 7) return fail('WEEK_TEMPLATE_INCOMPLETE', 'Mẫu lịch tuần chưa có đủ 7 ngày');

  const [assignments, calendarDays] = await Promise.all([
    repo.listPolicyAssignmentsForEmployees(client, { installationId, employeeIds: ids, dateFrom: fromDate, dateTo: toDate }),
    repo.listActiveCalendarDaysForRange(client, { installationId, dateFrom: fromDate, dateTo: toDate }),
  ]);
  const calendarMap = new Map(calendarDays.map((day) => [String(day.calendar_date), day]));
  const rows = [];
  const missingPolicy = [];

  for (const employee of scope.employees) {
    for (let workDate = fromDate; workDate <= toDate; workDate = shiftDate(workDate, 1)) {
      const calendarDay = calendarMap.get(workDate) ?? null;
      const day = dayMap.get(dayOfWeek(workDate));
      const assignment = assignmentFor(assignments, employee.id, workDate);
      if (day.schedule_kind === 'OFF') {
        rows.push({
          employee_id: employee.id,
          work_policy_id: assignment?.work_policy_id ?? '',
          work_date: workDate,
          schedule_kind: 'OFF',
          scheduled_start_at: '',
          scheduled_end_at: '',
          shift_template_id: '',
          week_template_id: template.id,
          company_calendar_day_id: calendarDay?.id ?? '',
        });
        continue;
      }
      if (!assignment) {
        missingPolicy.push(`${employee.code} · ${workDate}`);
        continue;
      }
      const startMinutes = timeMinutes(day.shift_start_time);
      const endMinutes = timeMinutes(day.shift_end_time);
      const endDate = startMinutes !== null && endMinutes !== null && endMinutes <= startMinutes ? shiftDate(workDate, 1) : workDate;
      const zone = assignment.policy_timezone || INSTALLATION_TIMEZONE;
      const startAt = zonedIso(workDate, day.shift_start_time, zone);
      const endAt = zonedIso(endDate, day.shift_end_time, zone);
      if (!startAt || !endAt || endAt <= startAt) return fail('INVALID_SHIFT_TIME', 'Có ca mẫu không thể quy đổi thành giờ làm việc hợp lệ');
      rows.push({
        employee_id: employee.id,
        work_policy_id: assignment.work_policy_id,
        work_date: workDate,
        schedule_kind: 'WORK',
        scheduled_start_at: startAt,
        scheduled_end_at: endAt,
        shift_template_id: day.shift_template_id,
        week_template_id: template.id,
        company_calendar_day_id: calendarDay?.id ?? '',
      });
    }
  }

  if (missingPolicy.length) {
    return fail(
      'WORK_POLICY_REQUIRED',
      `Có ${missingPolicy.length} ngày làm việc chưa có chính sách phù hợp. Kiểm tra: ${missingPolicy.slice(0, 5).join(', ')}`,
    );
  }
  const saved = await repo.upsertPlannedSchedules(client, { installationId, rows, actorId });
  const summary = {
    requestedCount: rows.length,
    affectedCount: saved.written,
    skippedOverrides: rows.length - saved.written,
    employeeCount: ids.length,
    fromDate,
    toDate,
  };
  return {
    ok: true,
    data: summary,
    audit: summaryAudit('apply-week-template', template.id, summary, { weekTemplateId: template.id, employeeIds: ids, reason }),
  };
}

export async function copySchedule(client, { installationId, payload, actorId, branchIds }) {
  const ids = employeeIds(payload.employeeIds);
  const sourceFrom = text(payload.sourceFrom);
  const sourceTo = text(payload.sourceTo);
  const targetFrom = text(payload.targetFrom);
  const reason = text(payload.reason);
  if (!ids) return fail('INVALID_EMPLOYEE_SELECTION', 'Hãy chọn từ 1 đến 500 nhân sự');
  if (!validRange(sourceFrom, sourceTo, 31)) return fail('INVALID_COPY_RANGE', 'Khoảng lịch nguồn không hợp lệ hoặc dài quá 31 ngày');
  if (!validDate(targetFrom) || targetFrom <= today()) return fail('INVALID_COPY_TARGET', 'Ngày bắt đầu lịch mới phải từ ngày mai');
  const span = daysBetween(sourceFrom, sourceTo);
  const targetTo = shiftDate(targetFrom, span);
  if (!validRange(targetFrom, targetTo, 31, true)) return fail('INVALID_COPY_TARGET', 'Khoảng lịch mới không hợp lệ');
  if (!reason || reason.length > 512) return fail('SCHEDULE_REASON_REQUIRED', 'Phải nhập lý do sao chép lịch');

  const scope = await scopedEmployees(client, { installationId, ids, branchIds });
  if (!scope.ok) return scope;
  const [sourceRows, assignments, calendarDays] = await Promise.all([
    repo.listSchedulesForCopy(client, { installationId, employeeIds: ids, dateFrom: sourceFrom, dateTo: sourceTo }),
    repo.listPolicyAssignmentsForEmployees(client, { installationId, employeeIds: ids, dateFrom: targetFrom, dateTo: targetTo }),
    repo.listActiveCalendarDaysForRange(client, { installationId, dateFrom: targetFrom, dateTo: targetTo }),
  ]);
  if (!sourceRows.length) return fail('SOURCE_SCHEDULE_EMPTY', 'Khoảng lịch nguồn chưa có lịch để sao chép');

  const calendarMap = new Map(calendarDays.map((day) => [String(day.calendar_date), day]));
  const rows = [];
  const missingPolicy = [];
  const offsetDays = daysBetween(sourceFrom, targetFrom);

  for (const source of sourceRows) {
    const targetDate = shiftDate(String(source.work_date), offsetDays);
    const calendarDay = calendarMap.get(targetDate) ?? null;
    const assignment = assignmentFor(assignments, source.employee_id, targetDate);
    if (source.schedule_kind === 'OFF') {
      rows.push({
        employee_id: source.employee_id,
        work_policy_id: assignment?.work_policy_id ?? '',
        work_date: targetDate,
        schedule_kind: 'OFF',
        scheduled_start_at: '',
        scheduled_end_at: '',
        shift_template_id: '',
        week_template_id: '',
        company_calendar_day_id: calendarDay?.id ?? '',
      });
      continue;
    }
    if (!assignment) {
      const employee = scope.employees.find((item) => String(item.id) === String(source.employee_id));
      missingPolicy.push(`${employee?.code ?? source.employee_id} · ${targetDate}`);
      continue;
    }
    const startAt = source.scheduled_start_at
      ? new Date(new Date(source.scheduled_start_at).getTime() + offsetDays * 86_400_000).toISOString()
      : null;
    const endAt = source.scheduled_end_at
      ? new Date(new Date(source.scheduled_end_at).getTime() + offsetDays * 86_400_000).toISOString()
      : null;
    if (!startAt || !endAt || endAt <= startAt) return fail('SOURCE_SCHEDULE_INVALID', 'Lịch nguồn có giờ làm việc không hợp lệ');
    rows.push({
      employee_id: source.employee_id,
      work_policy_id: assignment.work_policy_id,
      work_date: targetDate,
      schedule_kind: 'WORK',
      scheduled_start_at: startAt,
      scheduled_end_at: endAt,
      shift_template_id: source.shift_template_id ?? '',
      week_template_id: '',
      company_calendar_day_id: calendarDay?.id ?? '',
    });
  }

  if (missingPolicy.length) {
    return fail(
      'WORK_POLICY_REQUIRED',
      `Có ${missingPolicy.length} ngày làm việc mới chưa có chính sách phù hợp. Kiểm tra: ${missingPolicy.slice(0, 5).join(', ')}`,
    );
  }
  const saved = await repo.upsertPlannedSchedules(client, { installationId, rows, actorId });
  const summary = {
    requestedCount: rows.length,
    affectedCount: saved.written,
    skippedOverrides: rows.length - saved.written,
    employeeCount: ids.length,
    sourceFrom,
    sourceTo,
    targetFrom,
    targetTo,
  };
  return {
    ok: true,
    data: summary,
    audit: summaryAudit('copy-schedule', `${sourceFrom}:${sourceTo}`, summary, { employeeIds: ids, reason }),
  };
}

import * as violationRepo from '../db/repositories/attendance-violations.js';
import * as workforceRepo from '../db/repositories/workforce.js';
import * as adjustmentRepo from '../db/repositories/attendance-adjustments.js';
import * as attendanceTimesheetService from './attendance-timesheet.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const VIOLATION_KINDS = new Set(['LATE', 'EARLY_LEAVE', 'MISSING_ATTENDANCE', 'UNEXCUSED_ABSENCE']);
const CASE_STATUSES = new Set(['EXPLANATION_SUBMITTED', 'UNDER_REVIEW', 'RESOLVED']);
const MAX_QUERY_DAYS = 93;

function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function fail(code, message) { return { ok: false, code, message, retryable: false }; }
function validUuid(value) { return typeof value === 'string' && UUID_PATTERN.test(value.trim()); }
function validDate(value) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function periodDays(from, to) {
  return Math.floor((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86_400_000) + 1;
}
function monthBounds(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const year = Number(values.year);
  const month = Number(values.month);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    from: `${year}-${String(month).padStart(2, '0')}-01`,
    to: `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
  };
}
function explanationValue(value) {
  const normalized = text(value);
  if (!normalized || normalized.length > 2000) return fail('INVALID_VIOLATION_EXPLANATION', 'Giải trình phải từ 1 đến 2.000 ký tự');
  return { ok: true, value: normalized };
}
function reviewNoteValue(value) {
  const normalized = text(value);
  if (!normalized || normalized.length > 2000) return fail('INVALID_VIOLATION_REVIEW_NOTE', 'Kết luận xử lý phải từ 1 đến 2.000 ký tự');
  return { ok: true, value: normalized };
}
function employeeSummary(employee) {
  return employee ? {
    id: employee.id,
    code: employee.code,
    name: employee.full_name,
    branchId: employee.branch_id ?? null,
    branchCode: employee.branch_code ?? null,
    branchName: employee.branch_name ?? null,
  } : null;
}
async function employeeForScope(client, { installationId, employeeId, companyScope, branchIds }) {
  const employee = await workforceRepo.getEmployeeScopeRecord(client, { installationId, employeeId, lock: 'share' });
  if (!employee) return fail('EMPLOYEE_NOT_FOUND', 'Không tìm thấy nhân sự');
  if (companyScope) return { ok: true, employee };
  const allowed = new Set((branchIds ?? []).map(String));
  if (!employee.branch_id || !allowed.has(String(employee.branch_id))) return fail('SCOPE_FORBIDDEN', 'Nhân sự nằm ngoài phạm vi được cấp');
  return { ok: true, employee };
}

async function deriveViolation(client, { installationId, employeeId, workDate, violationKind, now = new Date() }) {
  const result = await attendanceTimesheetService.listAttendanceTimesheet(client, {
    installationId,
    view: 'daily',
    dateFrom: workDate,
    dateTo: workDate,
    employeeId,
    employeeQuery: null,
    branchId: null,
    branchIds: null,
    branchOptionIds: [],
    companyScope: true,
    selfOnly: false,
    limit: 10,
    offset: 0,
    now,
  });
  if (!result.ok) return result;
  const day = result.timesheet.rows.find((row) => String(row.employee.id) === String(employeeId) && row.workDate === workDate);
  if (!day) return fail('ATTENDANCE_DAY_NOT_FOUND', 'Không tìm thấy ngày công cần xử lý');
  const violation = day.violationEvaluation?.items?.find((item) => item.kind === violationKind) ?? null;
  return { ok: true, day, violation };
}

export async function listViolationHandling(client, {
  installationId,
  selfOnly,
  ownEmployeeId,
  companyScope,
  branchIds,
  rawEmployeeId,
  rawEmployeeQuery,
  rawBranchId,
  rawDateFrom,
  rawDateTo,
  rawLimit,
  rawOffset,
  now = new Date(),
}) {
  const defaults = monthBounds(now);
  const dateFrom = text(rawDateFrom) || defaults.from;
  const dateTo = text(rawDateTo) || defaults.to;
  if (!validDate(dateFrom) || !validDate(dateTo) || dateTo < dateFrom) return fail('INVALID_VIOLATION_PERIOD', 'Khoảng thời gian xử lý vi phạm không hợp lệ');
  if (periodDays(dateFrom, dateTo) > MAX_QUERY_DAYS) return fail('VIOLATION_PERIOD_TOO_LARGE', 'Mỗi lần chỉ xem tối đa 93 ngày');

  let employeeId = text(rawEmployeeId) || null;
  if (selfOnly) {
    employeeId = text(ownEmployeeId);
    if (!validUuid(employeeId)) return fail('EMPLOYEE_ID_REQUIRED', 'Tài khoản chưa liên kết hồ sơ nhân sự');
  } else if (employeeId) {
    const scoped = await employeeForScope(client, { installationId, employeeId, companyScope, branchIds });
    if (!scoped.ok) return scoped;
  }

  const timesheet = await attendanceTimesheetService.listAttendanceTimesheet(client, {
    installationId,
    view: 'daily',
    dateFrom,
    dateTo,
    employeeId,
    employeeQuery: selfOnly ? null : rawEmployeeQuery,
    branchId: selfOnly ? null : rawBranchId,
    branchIds: selfOnly || companyScope ? null : branchIds,
    branchOptionIds: selfOnly ? [] : (companyScope ? null : branchIds),
    companyScope,
    selfOnly,
    limit: rawLimit,
    offset: rawOffset,
    now,
  });
  if (!timesheet.ok) return timesheet;

  const days = timesheet.timesheet.rows;
  const dayKeys = new Set(days.map((day) => `${day.employee.id}:${day.workDate}`));
  const employeeIds = [...new Set(days.map((day) => String(day.employee.id)))];
  const cases = employeeIds.length ? await violationRepo.listCases(client, {
    installationId,
    employeeId,
    employeeIds,
    employeeQuery: selfOnly ? null : text(rawEmployeeQuery) || null,
    branchId: selfOnly ? null : text(rawBranchId) || null,
    branchIds: selfOnly || companyScope ? null : branchIds,
    dateFrom,
    dateTo,
  }) : [];
  const scopedCases = cases.filter((item) => dayKeys.has(`${item.employee_id}:${item.work_date}`));
  const caseByFact = new Map(scopedCases.map((item) => [`${item.employee_id}:${item.work_date}:${item.violation_kind}`, item]));
  const entries = [];
  const seen = new Set();

  for (const day of days) {
    for (const violation of day.violationEvaluation?.items ?? []) {
      const key = `${day.employee.id}:${day.workDate}:${violation.kind}`;
      entries.push({
        employee: day.employee,
        workDate: day.workDate,
        violation,
        evaluationState: day.violationEvaluation.state,
        case: caseByFact.get(key) ?? null,
      });
      seen.add(key);
    }
  }

  for (const item of scopedCases) {
    const key = `${item.employee_id}:${item.work_date}:${item.violation_kind}`;
    if (seen.has(key)) continue;
    entries.push({
      employee: {
        id: item.employee_id,
        code: item.employee_code,
        name: item.employee_name,
        branchId: item.employee_branch_id ?? null,
        branchCode: item.branch_code ?? null,
        branchName: item.branch_name ?? null,
      },
      workDate: item.work_date,
      violation: null,
      evaluationState: 'CLEAR',
      case: item,
    });
  }

  entries.sort((left, right) => (
    String(right.workDate).localeCompare(String(left.workDate))
    || String(left.employee.code).localeCompare(String(right.employee.code))
    || String(left.violation?.kind ?? left.case?.violation_kind ?? '').localeCompare(String(right.violation?.kind ?? right.case?.violation_kind ?? ''))
  ));

  return {
    ok: true,
    data: {
      period: timesheet.timesheet.period,
      scope: timesheet.timesheet.scope,
      pagination: timesheet.timesheet.pagination,
      entries,
    },
  };
}

export async function submitViolationExplanation(client, { requestContext, payload, now = new Date() }) {
  const employeeId = text(requestContext.employeeId);
  if (!validUuid(employeeId)) return fail('EMPLOYEE_ID_REQUIRED', 'Tài khoản chưa liên kết hồ sơ nhân sự');
  const workDate = text(payload?.workDate);
  const violationKind = text(payload?.violationKind).toUpperCase();
  if (!validDate(workDate)) return fail('INVALID_VIOLATION_DATE', 'Ngày vi phạm không hợp lệ');
  if (!VIOLATION_KINDS.has(violationKind)) return fail('INVALID_VIOLATION_KIND', 'Loại vi phạm không hợp lệ');
  const explanation = explanationValue(payload?.explanation);
  if (!explanation.ok) return explanation;

  const employee = await workforceRepo.getEmployeeScopeRecord(client, {
    installationId: requestContext.installationId, employeeId, lock: 'share',
  });
  if (!employee || !employee.is_active) return fail('EMPLOYEE_NOT_FOUND', 'Không tìm thấy hồ sơ nhân sự đang hoạt động');

  const current = await deriveViolation(client, {
    installationId: requestContext.installationId, employeeId, workDate, violationKind, now,
  });
  if (!current.ok) return current;
  if (!current.violation) return fail('VIOLATION_NOT_CURRENT', 'Vi phạm này không còn tồn tại trên Bảng công hiện tại');

  await adjustmentRepo.lockAttendanceMutationScope(client, { installationId: requestContext.installationId });
  const existing = await violationRepo.getCaseByFact(client, {
    installationId: requestContext.installationId, employeeId, workDate, violationKind, forUpdate: true,
  });
  if (existing) return fail('VIOLATION_CASE_EXISTS', 'Vi phạm này đã có giải trình; hãy theo dõi hồ sơ hiện có');

  const violationCase = await violationRepo.insertExplanationCase(client, {
    installationId: requestContext.installationId,
    employeeId,
    workDate,
    violationKind,
    violationLabel: current.violation.label,
    violationDetail: current.violation.detail,
    violationMinutes: current.violation.minutes,
    violationDayFraction: current.violation.dayFraction,
    policyId: current.day.policy?.id ?? null,
    policyVersion: current.day.policy?.version ?? null,
    explanation: explanation.value,
    actorId: requestContext.actorId,
    requestId: requestContext.requestId,
  });
  return { ok: true, case: violationCase, currentViolation: current.violation };
}

export async function reviewViolationCase(client, {
  requestContext, payload, companyScope, branchIds, now = new Date(),
}) {
  const caseId = text(payload?.caseId);
  const expectedVersion = Number(payload?.expectedVersion);
  const action = text(payload?.action).toUpperCase();
  if (!validUuid(caseId)) return fail('VIOLATION_CASE_NOT_FOUND', 'Không tìm thấy hồ sơ giải trình');
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) return fail('INVALID_EXPECTED_VERSION', 'Phiên bản hồ sơ giải trình không hợp lệ');
  if (!['START_REVIEW', 'CONCLUDE'].includes(action)) return fail('INVALID_VIOLATION_REVIEW_ACTION', 'Thao tác xử lý vi phạm không hợp lệ');

  const beforeCase = await violationRepo.getCaseById(client, {
    installationId: requestContext.installationId, id: caseId, forUpdate: true,
  });
  if (!beforeCase) return fail('VIOLATION_CASE_NOT_FOUND', 'Không tìm thấy hồ sơ giải trình');
  if (Number(beforeCase.version) !== expectedVersion) return fail('VIOLATION_CASE_CONFLICT', 'Hồ sơ vừa thay đổi; hãy tải lại dữ liệu');

  const scoped = await employeeForScope(client, {
    installationId: requestContext.installationId,
    employeeId: beforeCase.employee_id,
    companyScope,
    branchIds,
  });
  if (!scoped.ok) return scoped;

  if (action === 'START_REVIEW') {
    if (beforeCase.status !== 'EXPLANATION_SUBMITTED') return fail('VIOLATION_CASE_CONFLICT', 'Hồ sơ không còn ở trạng thái chờ xem xét');
    const violationCase = await violationRepo.startReview(client, {
      installationId: requestContext.installationId,
      id: caseId,
      expectedVersion,
      actorId: requestContext.actorId,
    });
    if (!violationCase) return fail('VIOLATION_CASE_CONFLICT', 'Hồ sơ vừa thay đổi; hãy tải lại dữ liệu');
    return { ok: true, case: violationCase, beforeCase };
  }

  const outcome = text(payload?.outcome).toUpperCase();
  if (!['CONFIRMED', 'EXCUSED'].includes(outcome)) return fail('INVALID_VIOLATION_OUTCOME', 'Kết luận vi phạm không hợp lệ');
  const reviewNote = reviewNoteValue(payload?.reviewNote);
  if (!reviewNote.ok) return reviewNote;
  if (!['EXPLANATION_SUBMITTED', 'UNDER_REVIEW'].includes(beforeCase.status)) return fail('VIOLATION_CASE_CONFLICT', 'Hồ sơ đã được kết luận');

  if (outcome === 'CONFIRMED') {
    const current = await deriveViolation(client, {
      installationId: requestContext.installationId,
      employeeId: beforeCase.employee_id,
      workDate: String(beforeCase.work_date),
      violationKind: beforeCase.violation_kind,
      now,
    });
    if (!current.ok) return current;
    if (!current.violation) return fail('VIOLATION_CHANGED', 'Dữ liệu công đã thay đổi và vi phạm không còn tồn tại; không thể xác nhận vi phạm cũ');
  }

  const violationCase = await violationRepo.resolveCase(client, {
    installationId: requestContext.installationId,
    id: caseId,
    expectedVersion,
    actorId: requestContext.actorId,
    outcome,
    reviewNote: reviewNote.value,
  });
  if (!violationCase) return fail('VIOLATION_CASE_CONFLICT', 'Hồ sơ vừa thay đổi; hãy tải lại dữ liệu');
  return { ok: true, case: violationCase, beforeCase };
}

export const VIOLATION_CASE_STATUS_VALUES = CASE_STATUSES;

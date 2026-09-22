import { createHash } from 'node:crypto';
import * as closeoutRepo from '../db/repositories/workforce-closeout.js';
import * as workforceRepo from '../db/repositories/workforce.js';
import * as employeeRepo from '../db/repositories/employee.js';
import * as adjustmentRepo from '../db/repositories/attendance-adjustments.js';
import * as attendanceTimesheetService from './attendance-timesheet.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const OT_STATUS = new Set(['SUBMITTED', 'APPROVED', 'REJECTED', 'ACTUAL_RECORDED', 'CONFIRMED']);
const PERIOD_STATUS = new Set(['AGGREGATING', 'NEEDS_ACTION', 'RECONCILED', 'CLOSED']);
const PERIOD_ACTION = new Set(['REFRESH', 'RECONCILE', 'CLOSE']);
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
function integer(value, min, max, fallback = NaN) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : NaN;
}
function periodDays(from, to) {
  return Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}
function businessDate(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: INSTALLATION_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function reasonValue(value, { required = true, label = 'Lý do' } = {}) {
  const result = text(value);
  if (required && !result) return fail('REASON_REQUIRED', `${label} là bắt buộc`);
  if (result.length > 1000) return fail('REASON_TOO_LONG', `${label} tối đa 1.000 ký tự`);
  return { ok: true, value: result || null };
}
function inScope(employee, { companyScope, branchIds }) {
  if (companyScope) return true;
  const allowed = new Set((branchIds ?? []).map(String));
  return Boolean(employee?.branch_id && allowed.has(String(employee.branch_id)));
}

async function employeeAtDateForScope(client, {
  installationId, employeeId, workDate, companyScope = true, branchIds = [],
}) {
  if (!validUuid(employeeId)) return fail('EMPLOYEE_NOT_FOUND', 'Không tìm thấy nhân sự');
  const employee = await employeeRepo.resolveEmployeeAtDate(client, {
    installationId, employeeId, businessDate: workDate,
  });
  if (!employee) return fail('EMPLOYEE_NOT_EMPLOYED_ON_DATE', 'Nhân sự không có quan hệ lao động hiệu lực tại ngày đã chọn');
  if (!inScope(employee, { companyScope, branchIds })) return fail('SCOPE_FORBIDDEN', 'Nhân sự nằm ngoài phạm vi chi nhánh được cấp tại ngày đã chọn');
  return { ok: true, employee };
}

async function overtimePolicy(client, { installationId, employeeId, workDate }) {
  const assignment = await workforceRepo.getEffectiveEmployeePolicyAssignment(client, {
    installationId, employeeId, workDate,
  });
  if (!assignment) return fail('POLICY_NOT_FOUND', 'Nhân sự chưa có chính sách làm việc hiệu lực tại ngày tăng ca');
  const policy = await workforceRepo.getWorkPolicyById(client, {
    installationId, id: assignment.work_policy_id,
  });
  if (!policy) return fail('POLICY_NOT_FOUND', 'Không tìm thấy chính sách làm việc hiệu lực');
  if (!policy.overtime_enabled) return fail('OVERTIME_NOT_ENABLED', 'Chính sách làm việc không áp dụng tăng ca tại ngày đã chọn');
  return { ok: true, policy };
}

async function ensureOvertimeUnlocked(client, { installationId, employee, workDate }) {
  const lock = await adjustmentRepo.getPeriodLockForEmployeeDate(client, {
    installationId,
    branchId: employee.branch_id ?? null,
    workDate,
  });
  if (lock) return fail('ATTENDANCE_PERIOD_LOCKED', 'Kỳ công đã chốt hoặc khóa; không thể thay đổi tăng ca');
  return { ok: true };
}

export async function listOvertimeRequests(client, {
  installationId, selfOnly, ownEmployeeId, companyScope, branchIds,
  rawEmployeeId, rawEmployeeQuery, rawBranchId, rawStatus,
  rawDateFrom, rawDateTo, rawLimit, rawOffset,
}) {
  const status = text(rawStatus).toUpperCase() || null;
  if (status && !OT_STATUS.has(status)) return fail('INVALID_OVERTIME_STATUS', 'Trạng thái tăng ca không hợp lệ');
  const dateFrom = text(rawDateFrom) || null;
  const dateTo = text(rawDateTo) || null;
  if ((dateFrom && !validDate(dateFrom)) || (dateTo && !validDate(dateTo)) || (dateFrom && dateTo && dateTo < dateFrom)) {
    return fail('INVALID_OVERTIME_PERIOD', 'Khoảng thời gian tăng ca không hợp lệ');
  }
  const branchId = text(rawBranchId) || null;
  if (branchId && !validUuid(branchId)) return fail('BRANCH_NOT_FOUND', 'Chi nhánh không hợp lệ');
  if (branchId && !companyScope && !new Set(branchIds ?? []).has(branchId)) return fail('SCOPE_FORBIDDEN', 'Chi nhánh nằm ngoài phạm vi được cấp');
  const employeeQuery = text(rawEmployeeQuery) || null;
  if (employeeQuery && employeeQuery.length > 80) return fail('INVALID_EMPLOYEE_FILTER', 'Từ khóa nhân sự tối đa 80 ký tự');
  let employeeId = text(rawEmployeeId) || null;
  if (selfOnly) {
    employeeId = text(ownEmployeeId);
    if (!validUuid(employeeId)) return fail('EMPLOYEE_ID_REQUIRED', 'Tài khoản chưa liên kết hồ sơ nhân sự');
  }
  const limit = integer(rawLimit, 1, 100, 50);
  const offset = integer(rawOffset, 0, 1_000_000, 0);
  if (Number.isNaN(limit) || Number.isNaN(offset)) return fail('INVALID_PAGINATION', 'Thông tin phân trang không hợp lệ');
  const [page, branches] = await Promise.all([
    closeoutRepo.listOvertimeRequests(client, {
      installationId,
      employeeId,
      employeeQuery: selfOnly ? null : employeeQuery,
      status, dateFrom, dateTo,
      branchId: selfOnly ? null : branchId,
      branchIds: selfOnly || companyScope ? null : branchIds,
      limit, offset,
    }),
    workforceRepo.listAttendanceBranches(client, {
      installationId, branchIds: selfOnly ? [] : (companyScope ? null : branchIds),
    }),
  ]);
  return {
    ok: true,
    data: {
      requests: page.rows,
      branches,
      pagination: {
        limit, offset, total: page.total,
        hasPrevious: offset > 0,
        hasNext: offset + page.rows.length < page.total,
      },
    },
  };
}

export async function submitOvertimeRequest(client, { requestContext, payload }) {
  const employeeId = text(requestContext.employeeId);
  if (!validUuid(employeeId)) return fail('EMPLOYEE_ID_REQUIRED', 'Tài khoản chưa liên kết hồ sơ nhân sự');
  const workDate = text(payload?.workDate);
  const requestedMinutes = integer(payload?.requestedMinutes, 1, 1440);
  if (!validDate(workDate)) return fail('INVALID_OVERTIME_DATE', 'Ngày tăng ca không hợp lệ');
  if (Number.isNaN(requestedMinutes)) return fail('INVALID_OVERTIME_MINUTES', 'Thời gian đăng ký tăng ca phải từ 1 đến 1.440 phút');
  const reason = reasonValue(payload?.reason);
  if (!reason.ok) return reason;
  await adjustmentRepo.lockAttendanceMutationScope(client, { installationId: requestContext.installationId });
  const scoped = await employeeAtDateForScope(client, {
    installationId: requestContext.installationId, employeeId, workDate, companyScope: true,
  });
  if (!scoped.ok) return scoped;
  const unlocked = await ensureOvertimeUnlocked(client, {
    installationId: requestContext.installationId, employee: scoped.employee, workDate,
  });
  if (!unlocked.ok) return unlocked;
  const policyResult = await overtimePolicy(client, {
    installationId: requestContext.installationId, employeeId, workDate,
  });
  if (!policyResult.ok) return policyResult;
  const duplicate = await closeoutRepo.findActiveOvertimeForEmployeeDate(client, {
    installationId: requestContext.installationId, employeeId, workDate,
  });
  if (duplicate) return fail('OVERTIME_REQUEST_EXISTS', 'Ngày này đã có hồ sơ tăng ca đang được xử lý hoặc đã xác nhận');
  const autoApproved = !policyResult.policy.overtime_requires_approval;
  const request = await closeoutRepo.insertOvertimeRequest(client, {
    installationId: requestContext.installationId,
    employeeId,
    workDate,
    requestedMinutes,
    reason: reason.value,
    policyId: policyResult.policy.id,
    policyCode: policyResult.policy.code,
    policyVersion: policyResult.policy.version,
    requiresApproval: Boolean(policyResult.policy.overtime_requires_approval),
    status: autoApproved ? 'APPROVED' : 'SUBMITTED',
    actorId: requestContext.actorId,
    reviewedByActorId: autoApproved ? requestContext.actorId : null,
    reviewReason: autoApproved ? 'Tự động duyệt theo chính sách làm việc' : null,
    reviewedAt: autoApproved ? new Date().toISOString() : null,
    requestId: requestContext.requestId,
  });
  return { ok: true, request, autoApproved };
}

async function overtimeRequestForManager(client, {
  requestContext, requestId, expectedVersion, companyScope, branchIds,
}) {
  if (!validUuid(requestId)) return fail('OVERTIME_REQUEST_NOT_FOUND', 'Không tìm thấy hồ sơ tăng ca');
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) return fail('INVALID_EXPECTED_VERSION', 'Phiên bản hồ sơ tăng ca không hợp lệ');
  const request = await closeoutRepo.getOvertimeRequestById(client, {
    installationId: requestContext.installationId, id: requestId, forUpdate: true,
  });
  if (!request) return fail('OVERTIME_REQUEST_NOT_FOUND', 'Không tìm thấy hồ sơ tăng ca');
  if (request.version !== expectedVersion) return fail('OVERTIME_REQUEST_CONFLICT', 'Hồ sơ tăng ca vừa thay đổi; hãy tải lại dữ liệu');
  const scoped = await employeeAtDateForScope(client, {
    installationId: requestContext.installationId,
    employeeId: request.employee_id,
    workDate: String(request.work_date),
    companyScope,
    branchIds,
  });
  if (!scoped.ok) return scoped;
  const unlocked = await ensureOvertimeUnlocked(client, {
    installationId: requestContext.installationId,
    employee: scoped.employee,
    workDate: String(request.work_date),
  });
  if (!unlocked.ok) return unlocked;
  return { ok: true, request, employee: scoped.employee };
}

export async function reviewOvertimeRequest(client, {
  requestContext, payload, companyScope, branchIds,
}) {
  const requestId = text(payload?.requestId);
  const expectedVersion = Number(payload?.expectedVersion);
  const action = text(payload?.action).toUpperCase();
  if (!['APPROVE', 'REJECT'].includes(action)) return fail('INVALID_OVERTIME_ACTION', 'Thao tác duyệt tăng ca không hợp lệ');
  const reviewReason = reasonValue(payload?.reviewReason, { required: action === 'REJECT', label: 'Ý kiến xử lý' });
  if (!reviewReason.ok) return reviewReason;
  await adjustmentRepo.lockAttendanceMutationScope(client, { installationId: requestContext.installationId });
  const scoped = await overtimeRequestForManager(client, {
    requestContext, requestId, expectedVersion, companyScope, branchIds,
  });
  if (!scoped.ok) return scoped;
  if (scoped.request.status !== 'SUBMITTED') return fail('OVERTIME_REQUEST_CONFLICT', 'Hồ sơ tăng ca không còn ở trạng thái chờ duyệt');
  const request = await closeoutRepo.reviewOvertimeRequest(client, {
    installationId: requestContext.installationId,
    id: requestId,
    expectedVersion,
    nextStatus: action === 'APPROVE' ? 'APPROVED' : 'REJECTED',
    actorId: requestContext.actorId,
    reviewReason: reviewReason.value,
  });
  if (!request) return fail('OVERTIME_REQUEST_CONFLICT', 'Hồ sơ tăng ca vừa thay đổi; hãy tải lại dữ liệu');
  return { ok: true, request, beforeRequest: scoped.request };
}

export async function recordOvertimeActual(client, {
  requestContext, payload, companyScope, branchIds,
}) {
  const requestId = text(payload?.requestId);
  const expectedVersion = Number(payload?.expectedVersion);
  const actualMinutes = integer(payload?.actualMinutes, 1, 1440);
  if (Number.isNaN(actualMinutes)) return fail('INVALID_OVERTIME_MINUTES', 'Thời gian tăng ca thực tế phải từ 1 đến 1.440 phút');
  const actualNote = reasonValue(payload?.actualNote, { required: false, label: 'Ghi chú thực tế' });
  if (!actualNote.ok) return actualNote;
  await adjustmentRepo.lockAttendanceMutationScope(client, { installationId: requestContext.installationId });
  const scoped = await overtimeRequestForManager(client, {
    requestContext, requestId, expectedVersion, companyScope, branchIds,
  });
  if (!scoped.ok) return scoped;
  if (scoped.request.status !== 'APPROVED') return fail('OVERTIME_REQUEST_CONFLICT', 'Chỉ được ghi nhận thực tế cho hồ sơ đã duyệt');
  const request = await closeoutRepo.recordOvertimeActual(client, {
    installationId: requestContext.installationId,
    id: requestId,
    expectedVersion,
    actualMinutes,
    actualNote: actualNote.value,
    actorId: requestContext.actorId,
  });
  if (!request) return fail('OVERTIME_REQUEST_CONFLICT', 'Hồ sơ tăng ca vừa thay đổi; hãy tải lại dữ liệu');
  return { ok: true, request, beforeRequest: scoped.request };
}

export async function confirmOvertimeRequest(client, {
  requestContext, payload, companyScope, branchIds,
}) {
  const requestId = text(payload?.requestId);
  const expectedVersion = Number(payload?.expectedVersion);
  const confirmedMinutes = integer(payload?.confirmedMinutes, 0, 1440);
  if (Number.isNaN(confirmedMinutes)) return fail('INVALID_OVERTIME_MINUTES', 'Thời gian tăng ca được tính phải từ 0 đến 1.440 phút');
  const confirmNote = reasonValue(payload?.confirmNote, { required: false, label: 'Ghi chú xác nhận' });
  if (!confirmNote.ok) return confirmNote;
  await adjustmentRepo.lockAttendanceMutationScope(client, { installationId: requestContext.installationId });
  const scoped = await overtimeRequestForManager(client, {
    requestContext, requestId, expectedVersion, companyScope, branchIds,
  });
  if (!scoped.ok) return scoped;
  if (scoped.request.status !== 'ACTUAL_RECORDED') return fail('OVERTIME_REQUEST_CONFLICT', 'Hồ sơ tăng ca chưa có thời gian thực tế để xác nhận');
  if (confirmedMinutes > Number(scoped.request.actual_minutes)) return fail('OVERTIME_CONFIRMED_EXCEEDS_ACTUAL', 'Giờ tăng ca được tính không được lớn hơn thời gian thực tế');
  const request = await closeoutRepo.confirmOvertimeRequest(client, {
    installationId: requestContext.installationId,
    id: requestId,
    expectedVersion,
    confirmedMinutes,
    confirmNote: confirmNote.value,
    actorId: requestContext.actorId,
  });
  if (!request) return fail('OVERTIME_REQUEST_CONFLICT', 'Hồ sơ tăng ca vừa thay đổi; hãy tải lại dữ liệu');
  return { ok: true, request, beforeRequest: scoped.request };
}

function normalizePeriodScope({ rawPeriodStart, rawPeriodEnd, rawBranchId, companyScope, branchIds }) {
  const periodStart = text(rawPeriodStart);
  const periodEnd = text(rawPeriodEnd);
  const branchId = text(rawBranchId) || null;
  if (!validDate(periodStart) || !validDate(periodEnd) || periodEnd < periodStart) return fail('INVALID_ATTENDANCE_PERIOD', 'Khoảng thời gian kỳ công không hợp lệ');
  if (periodDays(periodStart, periodEnd) > MAX_PERIOD_DAYS) return fail('ATTENDANCE_PERIOD_TOO_LARGE', 'Mỗi kỳ công tối đa 93 ngày');
  if (periodEnd > businessDate()) return fail('ATTENDANCE_PERIOD_IN_FUTURE', 'Chỉ được đối soát kỳ công đã kết thúc đến ngày hiện tại');
  if (branchId && !validUuid(branchId)) return fail('BRANCH_NOT_FOUND', 'Chi nhánh không hợp lệ');
  if (!companyScope && (!branchId || !new Set(branchIds ?? []).has(branchId))) return fail('SCOPE_FORBIDDEN', 'Chỉ được đối soát kỳ công trong chi nhánh được cấp');
  return { ok: true, value: { periodStart, periodEnd, branchId } };
}

function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function buildPeriodSource(client, {
  installationId, periodStart, periodEnd, branchId, companyScope, branchIds,
}) {
  const employees = [];
  let offset = 0;
  while (true) {
    const result = await attendanceTimesheetService.listAttendanceTimesheet(client, {
      installationId,
      view: 'monthly',
      dateFrom: periodStart,
      dateTo: periodEnd,
      branchId,
      branchIds: companyScope ? null : branchIds,
      branchOptionIds: companyScope ? null : branchIds,
      companyScope,
      selfOnly: false,
      limit: 25,
      offset,
    });
    if (!result.ok) return result;
    for (const row of result.timesheet.rows) {
      const paidLeaveDays = row.days.reduce((sum, day) => sum + Number(day.leave?.paidFraction ?? 0), 0);
      const approvedLeaveFraction = row.days.reduce((sum, day) => sum + Number(day.leave?.approvedFraction ?? 0), 0);
      employees.push({
        employeeId: row.employee.id,
        employeeCode: row.employee.code,
        employeeName: row.employee.name,
        branchId: row.employee.branchId,
        branchCode: row.employee.branchCode,
        branchName: row.employee.branchName,
        workDays: row.workDays,
        completedDays: row.completedDays,
        countedMinutes: row.countedMinutes,
        leaveCreditedMinutes: row.leaveCreditedMinutes,
        approvedLeaveDays: row.approvedLeaveDays,
        paidLeaveDays,
        unpaidLeaveDays: Math.max(0, approvedLeaveFraction - paidLeaveDays),
        unexcusedAbsenceDays: row.unexcusedAbsenceDays,
        incompleteDays: row.incompleteDays,
        configurationIssueDays: row.configurationIssueDays,
        violationDays: row.violationDays,
        pendingLeaveDays: row.pendingLeaveDays,
        pendingAdjustmentDays: row.pendingAdjustmentDays,
      });
    }
    if (!result.timesheet.pagination.hasNext) break;
    offset += result.timesheet.pagination.limit;
  }

  const confirmedRows = await closeoutRepo.listConfirmedOvertimeForPeriod(client, {
    installationId,
    dateFrom: periodStart,
    dateTo: periodEnd,
    branchId,
    branchIds: companyScope ? null : branchIds,
  });
  const overtimeByEmployee = new Map(confirmedRows.map((row) => [String(row.employee_id), Number(row.confirmed_minutes ?? 0)]));
  for (const employee of employees) employee.confirmedOvertimeMinutes = overtimeByEmployee.get(employee.employeeId) ?? 0;

  const outstandingOvertime = await closeoutRepo.countOutstandingOvertimeForPeriod(client, {
    installationId,
    dateFrom: periodStart,
    dateTo: periodEnd,
    branchId,
    branchIds: companyScope ? null : branchIds,
  });
  const totals = employees.reduce((sum, row) => ({
    configurationIssueDays: sum.configurationIssueDays + Number(row.configurationIssueDays ?? 0),
    pendingAdjustmentDays: sum.pendingAdjustmentDays + Number(row.pendingAdjustmentDays ?? 0),
    pendingLeaveDays: sum.pendingLeaveDays + Number(row.pendingLeaveDays ?? 0),
    incompleteDays: sum.incompleteDays + Number(row.incompleteDays ?? 0),
    unexcusedAbsenceDays: sum.unexcusedAbsenceDays + Number(row.unexcusedAbsenceDays ?? 0),
    violationDays: sum.violationDays + Number(row.violationDays ?? 0),
  }), {
    configurationIssueDays: 0,
    pendingAdjustmentDays: 0,
    pendingLeaveDays: 0,
    incompleteDays: 0,
    unexcusedAbsenceDays: 0,
    violationDays: 0,
  });
  const issues = {
    blockers: {
      configurationIssueDays: totals.configurationIssueDays,
      pendingAdjustmentDays: totals.pendingAdjustmentDays,
      pendingLeaveDays: totals.pendingLeaveDays,
      outstandingOvertimeRequests: Number(outstandingOvertime),
    },
    warnings: {
      incompleteDays: totals.incompleteDays,
      unexcusedAbsenceDays: totals.unexcusedAbsenceDays,
      violationDays: totals.violationDays,
    },
  };
  const source = {
    contractVersion: 1,
    period: { from: periodStart, to: periodEnd, branchId },
    employees,
  };
  return {
    ok: true,
    source,
    issues,
    fingerprint: fingerprint(source),
    blockerTotal: Object.values(issues.blockers).reduce((sum, value) => sum + Number(value), 0),
    warningTotal: Object.values(issues.warnings).reduce((sum, value) => sum + Number(value), 0),
  };
}

async function periodForScope(client, {
  installationId, periodStart, periodEnd, branchId, actorId, requestId,
  companyScope, branchIds,
}) {
  const built = await buildPeriodSource(client, {
    installationId, periodStart, periodEnd, branchId, companyScope, branchIds,
  });
  if (!built.ok) return built;
  let period = await closeoutRepo.getAttendancePeriodByKey(client, {
    installationId, branchId, periodStart, periodEnd, forUpdate: true,
  });
  if (!period) {
    period = await closeoutRepo.insertAttendancePeriod(client, {
      installationId, branchId, periodStart, periodEnd,
      status: built.blockerTotal > 0 ? 'NEEDS_ACTION' : 'AGGREGATING',
      issueSummary: built.issues,
      sourceFingerprint: built.fingerprint,
      actorId, requestId,
    });
  }
  return { ok: true, period, built };
}

export async function listAttendancePeriods(client, {
  installationId, companyScope, branchIds, rawBranchId, rawDateFrom, rawDateTo,
}) {
  const branchId = text(rawBranchId) || null;
  const dateFrom = text(rawDateFrom) || null;
  const dateTo = text(rawDateTo) || null;
  if (branchId && !validUuid(branchId)) return fail('BRANCH_NOT_FOUND', 'Chi nhánh không hợp lệ');
  if (branchId && !companyScope && !new Set(branchIds ?? []).has(branchId)) return fail('SCOPE_FORBIDDEN', 'Chi nhánh nằm ngoài phạm vi được cấp');
  if ((dateFrom && !validDate(dateFrom)) || (dateTo && !validDate(dateTo)) || (dateFrom && dateTo && dateTo < dateFrom)) return fail('INVALID_ATTENDANCE_PERIOD', 'Khoảng thời gian kỳ công không hợp lệ');
  const [periods, branches] = await Promise.all([
    closeoutRepo.listAttendancePeriods(client, {
      installationId,
      branchId,
      branchIds: companyScope ? null : branchIds,
      dateFrom, dateTo,
    }),
    workforceRepo.listAttendanceBranches(client, { installationId, branchIds: companyScope ? null : branchIds }),
  ]);
  return { ok: true, data: { periods, branches } };
}

export async function mutateAttendancePeriod(client, {
  requestContext, payload, companyScope, branchIds, canLock,
}) {
  const action = text(payload?.action).toUpperCase();
  if (!PERIOD_ACTION.has(action)) return fail('INVALID_ATTENDANCE_PERIOD_ACTION', 'Thao tác kỳ công không hợp lệ');
  const normalized = normalizePeriodScope({
    rawPeriodStart: payload?.periodStart,
    rawPeriodEnd: payload?.periodEnd,
    rawBranchId: payload?.branchId,
    companyScope,
    branchIds,
  });
  if (!normalized.ok) return normalized;
  const { periodStart, periodEnd, branchId } = normalized.value;
  const note = reasonValue(payload?.note, { required: false, label: 'Ghi chú đối soát' });
  if (!note.ok) return note;
  await adjustmentRepo.lockAttendanceMutationScope(client, { installationId: requestContext.installationId });
  const state = await periodForScope(client, {
    installationId: requestContext.installationId,
    periodStart, periodEnd, branchId,
    actorId: requestContext.actorId,
    requestId: requestContext.requestId,
    companyScope,
    branchIds,
  });
  if (!state.ok) return state;
  let { period } = state;
  let { built } = state;

  if (action === 'REFRESH') {
    let nextStatus;
    if (period.status === 'CLOSED' && period.source_fingerprint === built.fingerprint) nextStatus = 'CLOSED';
    else if (period.status === 'RECONCILED' && period.reconciled_fingerprint === built.fingerprint && built.blockerTotal === 0) nextStatus = 'RECONCILED';
    else nextStatus = built.blockerTotal > 0 ? 'NEEDS_ACTION' : 'AGGREGATING';
    if (nextStatus !== 'CLOSED') {
      period = await closeoutRepo.updateAttendancePeriodAggregation(client, {
        installationId: requestContext.installationId,
        id: period.id,
        status: nextStatus,
        issueSummary: built.issues,
        sourceFingerprint: built.fingerprint,
        actorId: requestContext.actorId,
        requestId: requestContext.requestId,
      });
    }
    return { ok: true, period, issues: built.issues, snapshot: null, beforePeriod: state.period };
  }

  if (period.status === 'CLOSED') return fail('ATTENDANCE_PERIOD_ALREADY_CLOSED', 'Kỳ công đã chốt; chỉ có thể mở lại bằng nghiệp vụ điều chỉnh ngoại lệ có audit');
  if (built.blockerTotal > 0) return fail('ATTENDANCE_PERIOD_HAS_BLOCKERS', 'Kỳ công còn dữ liệu cần xử lý trước khi đối soát');
  if (action === 'RECONCILE') {
    if (built.warningTotal > 0 && payload?.acknowledgeWarnings !== true) {
      return fail('ATTENDANCE_PERIOD_WARNINGS_UNACKNOWLEDGED', 'Kỳ công còn cảnh báo; cần xác nhận đã kiểm tra trước khi đối soát');
    }
    if (built.warningTotal > 0 && !note.value) return fail('REASON_REQUIRED', 'Vui lòng ghi chú kết quả kiểm tra cảnh báo');
    period = await closeoutRepo.reconcileAttendancePeriod(client, {
      installationId: requestContext.installationId,
      id: period.id,
      issueSummary: built.issues,
      sourceFingerprint: built.fingerprint,
      actorId: requestContext.actorId,
      note: note.value,
      requestId: requestContext.requestId,
    });
    return { ok: true, period, issues: built.issues, snapshot: null, beforePeriod: state.period };
  }

  if (!canLock) return fail('ATTENDANCE_CLOSE_REQUIRES_LOCK_PERMISSION', 'Chốt kỳ công cần quyền khóa kỳ công');
  if (period.status !== 'RECONCILED') return fail('ATTENDANCE_PERIOD_NOT_RECONCILED', 'Kỳ công phải được đối soát trước khi chốt');
  if (period.reconciled_fingerprint !== built.fingerprint) return fail('ATTENDANCE_PERIOD_CHANGED', 'Dữ liệu kỳ công đã thay đổi sau đối soát; cần tổng hợp và đối soát lại');

  let lockId = period.lock_id ?? null;
  if (!lockId) {
    const overlap = await adjustmentRepo.findOverlappingPeriodLock(client, {
      installationId: requestContext.installationId,
      branchId,
      periodStart,
      periodEnd,
    });
    if (overlap) {
      const exact = String(overlap.period_start).slice(0, 10) === periodStart
        && String(overlap.period_end).slice(0, 10) === periodEnd
        && String(overlap.branch_id ?? '') === String(branchId ?? '');
      if (!exact) return fail('ATTENDANCE_PERIOD_LOCK_OVERLAP', 'Kỳ công trùng một khoảng đã khóa khác');
      lockId = overlap.id;
    } else {
      const lock = await adjustmentRepo.insertPeriodLock(client, {
        installationId: requestContext.installationId,
        branchId,
        periodStart,
        periodEnd,
        reason: `Chốt kỳ công ${periodStart} – ${periodEnd}`,
        actorId: requestContext.actorId,
        requestId: requestContext.requestId,
      });
      lockId = lock.id;
    }
  }

  const revision = Number(period.revision ?? 0) + 1;
  const snapshotPayload = {
    ...built.source,
    issueSummary: built.issues,
    status: 'CLOSED',
    revision,
  };
  const snapshot = await closeoutRepo.insertAttendancePeriodSnapshot(client, {
    installationId: requestContext.installationId,
    periodId: period.id,
    revision,
    sourceFingerprint: built.fingerprint,
    snapshot: snapshotPayload,
    requestId: requestContext.requestId,
    actorId: requestContext.actorId,
  });
  period = await closeoutRepo.closeAttendancePeriod(client, {
    installationId: requestContext.installationId,
    id: period.id,
    issueSummary: built.issues,
    sourceFingerprint: built.fingerprint,
    actorId: requestContext.actorId,
    lockId,
    revision,
    requestId: requestContext.requestId,
  });
  if (!period) return fail('ATTENDANCE_PERIOD_CONFLICT', 'Kỳ công vừa thay đổi; hãy tải lại dữ liệu');
  return { ok: true, period, issues: built.issues, snapshot, beforePeriod: state.period };
}

export async function getPayrollInput(client, {
  installationId, periodId, companyScope, branchIds,
}) {
  if (!validUuid(periodId)) return fail('ATTENDANCE_PERIOD_NOT_FOUND', 'Không tìm thấy kỳ công');
  const period = await closeoutRepo.getAttendancePeriodById(client, { installationId, id: periodId });
  if (!period) return fail('ATTENDANCE_PERIOD_NOT_FOUND', 'Không tìm thấy kỳ công');
  if (!companyScope) {
    const allowed = new Set((branchIds ?? []).map(String));
    if (!period.branch_id || !allowed.has(String(period.branch_id))) return fail('SCOPE_FORBIDDEN', 'Kỳ công nằm ngoài phạm vi được cấp');
  }
  if (period.status !== 'CLOSED' || Number(period.revision) < 1) return fail('ATTENDANCE_PERIOD_NOT_CLOSED', 'Chỉ kỳ công đã chốt mới được chuyển sang đầu vào tính lương');
  const snapshot = await closeoutRepo.getAttendancePeriodSnapshot(client, {
    installationId, periodId: period.id, revision: Number(period.revision),
  });
  if (!snapshot) return fail('ATTENDANCE_PERIOD_SNAPSHOT_MISSING', 'Không tìm thấy bản chốt kỳ công');
  return {
    ok: true,
    data: {
      period,
      revision: snapshot.revision,
      sourceFingerprint: snapshot.source_fingerprint,
      payrollInput: snapshot.snapshot,
    },
  };
}

export function isAttendancePeriodStatus(value) {
  return PERIOD_STATUS.has(text(value).toUpperCase());
}

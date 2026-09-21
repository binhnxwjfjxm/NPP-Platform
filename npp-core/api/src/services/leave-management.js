import * as leaveRepo from '../db/repositories/leave-management.js';
import * as workforceRepo from '../db/repositories/workforce.js';
import * as adjustmentRepo from '../db/repositories/attendance-adjustments.js';
import * as employeeRepo from '../db/repositories/employee.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,31}$/;
const STATUS_VALUES = new Set(['SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED']);
const DAY_PART_VALUES = new Set(['FULL_DAY', 'FIRST_HALF', 'SECOND_HALF']);
const MAX_REQUEST_DAYS = 366;
const MAX_QUERY_DAYS = 366;
const INSTALLATION_TIMEZONE = 'Asia/Ho_Chi_Minh';
const MANUAL_BALANCE_ENTRY_TYPES = new Set(['OPENING_GRANT', 'ACCRUAL', 'ADJUSTMENT', 'CARRY_OVER', 'EXPIRY', 'COMPENSATORY']);

function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function fail(code, message) { return { ok: false, code, message, retryable: false }; }
function validUuid(value) { return typeof value === 'string' && UUID_PATTERN.test(value.trim()); }
function validDate(value) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function periodDays(from, to) {
  return Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}
function integer(value, min, max, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : NaN;
}
function booleanValue(value, fallback) {
  if (value === undefined || value === null) return fallback;
  return typeof value === 'boolean' ? value : null;
}
function employeeInScope(employee, { companyScope, branchIds }) {
  if (companyScope) return true;
  return Boolean(employee?.branch_id) && new Set(branchIds ?? []).has(String(employee.branch_id));
}
function employeeSummary(employee) {
  return employee ? { id: employee.id, code: employee.code, name: employee.full_name, branchId: employee.branch_id ?? null } : null;
}
function reasonValue(value, { required = true, code = 'INVALID_LEAVE_REASON', label = 'Lý do' } = {}) {
  const reason = text(value);
  if ((required && !reason) || reason.length > 1000) {
    return fail(code, required ? `${label} là bắt buộc và tối đa 1.000 ký tự` : `${label} tối đa 1.000 ký tự`);
  }
  return { ok: true, value: reason || null };
}
function normalizeLeaveType(payload) {
  const code = text(payload?.code).toUpperCase();
  const name = text(payload?.name);
  if (!CODE_PATTERN.test(code)) return fail('INVALID_LEAVE_TYPE_CODE', 'Mã chế độ nghỉ chỉ dùng chữ in hoa, số, gạch ngang hoặc gạch dưới và tối đa 32 ký tự');
  if (!name || name.length > 100) return fail('INVALID_LEAVE_TYPE_NAME', 'Tên chế độ nghỉ là bắt buộc và tối đa 100 ký tự');
  const isActive = booleanValue(payload?.isActive, true);
  const isPaid = booleanValue(payload?.isPaid, false);
  const countsAsWorkday = booleanValue(payload?.countsAsWorkday, false);
  const requiresApproval = booleanValue(payload?.requiresApproval, true);
  const allowsFullDay = booleanValue(payload?.allowsFullDay, true);
  const allowsHalfDay = booleanValue(payload?.allowsHalfDay, false);
  const requiresAttachment = booleanValue(payload?.requiresAttachment, false);
  const tracksBalance = booleanValue(payload?.tracksBalance, false);
  const allowNegativeBalance = booleanValue(payload?.allowNegativeBalance, false);
  if ([isActive, isPaid, countsAsWorkday, requiresApproval, allowsFullDay, allowsHalfDay, requiresAttachment, tracksBalance, allowNegativeBalance].includes(null)) {
    return fail('INVALID_LEAVE_TYPE_CONFIGURATION', 'Thiết lập chế độ nghỉ không hợp lệ');
  }
  if (!allowsFullDay && !allowsHalfDay) return fail('INVALID_LEAVE_TYPE_CONFIGURATION', 'Chế độ nghỉ phải cho phép nghỉ cả ngày hoặc nửa ngày');
  if (allowNegativeBalance && !tracksBalance) return fail('INVALID_LEAVE_TYPE_CONFIGURATION', 'Chỉ được cho phép âm khi chế độ nghỉ có theo dõi số dư');
  return { ok: true, value: { code, name, isActive, isPaid, countsAsWorkday, requiresApproval, allowsFullDay, allowsHalfDay, requiresAttachment, tracksBalance, allowNegativeBalance } };
}
function normalizeRequestPayload(payload) {
  const leaveTypeId = text(payload?.leaveTypeId);
  const dateFrom = text(payload?.dateFrom);
  const dateTo = text(payload?.dateTo) || dateFrom;
  const dayPart = text(payload?.dayPart).toUpperCase() || 'FULL_DAY';
  if (!validUuid(leaveTypeId)) return fail('LEAVE_TYPE_NOT_FOUND', 'Không tìm thấy chế độ nghỉ');
  if (!validDate(dateFrom) || !validDate(dateTo) || dateTo < dateFrom) return fail('INVALID_LEAVE_PERIOD', 'Khoảng ngày nghỉ không hợp lệ');
  if (periodDays(dateFrom, dateTo) > MAX_REQUEST_DAYS) return fail('LEAVE_PERIOD_TOO_LARGE', 'Một đơn nghỉ không được vượt quá 366 ngày');
  if (!DAY_PART_VALUES.has(dayPart)) return fail('INVALID_LEAVE_DAY_PART', 'Phần ngày nghỉ không hợp lệ');
  if (dayPart !== 'FULL_DAY' && dateFrom !== dateTo) return fail('HALF_DAY_SINGLE_DATE_REQUIRED', 'Nghỉ nửa ngày chỉ áp dụng cho một ngày');
  const reason = reasonValue(payload?.reason);
  if (!reason.ok) return reason;
  const attachmentReference = text(payload?.attachmentReference) || null;
  if (attachmentReference && attachmentReference.length > 1000) return fail('INVALID_LEAVE_ATTACHMENT', 'Thông tin chứng từ tối đa 1.000 ký tự');
  return { ok: true, value: { leaveTypeId, dateFrom, dateTo, dayPart, reason: reason.value, attachmentReference } };
}
function businessDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: INSTALLATION_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function employeeForScope(client, {
  installationId, employeeId, companyScope, branchIds, businessDateValue = businessDate(),
}) {
  if (!validUuid(employeeId)) return fail('EMPLOYEE_NOT_FOUND', 'Không tìm thấy nhân sự');
  const employee = await employeeRepo.resolveEmployeeAtDate(client, {
    installationId, employeeId, businessDate: businessDateValue,
  });
  if (!employee) return fail('EMPLOYEE_NOT_FOUND', 'Không tìm thấy nhân sự tại ngày đã chọn');
  if (!employeeInScope(employee, { companyScope, branchIds })) return fail('SCOPE_FORBIDDEN', 'Nhân sự nằm ngoài phạm vi được cấp tại ngày đã chọn');
  return { ok: true, employee };
}

async function leavePeriodScope(client, {
  installationId, employeeId, dateFrom, dateTo, companyScope = true, branchIds = [],
}) {
  const rows = await leaveRepo.getLeavePeriodScopeRows(client, { installationId, employeeId, dateFrom, dateTo });
  const missingEmployment = rows.find((row) => !row.employment_id);
  if (missingEmployment) {
    return fail('EMPLOYEE_NOT_EMPLOYED_ON_LEAVE_DATE', `Nhân sự không có quan hệ lao động hiệu lực ngày ${missingEmployment.work_date}`);
  }
  if (!companyScope) {
    const allowed = new Set((branchIds ?? []).map(String));
    const outside = rows.find((row) => !row.branch_id || !allowed.has(String(row.branch_id)));
    if (outside) return fail('SCOPE_FORBIDDEN', `Đơn nghỉ có ngày ${outside.work_date} nằm ngoài phạm vi chi nhánh được cấp`);
  }
  return { ok: true, rows };
}

async function findLockedDay(client, { installationId, scopeRows }) {
  for (const row of scopeRows) {
    const lock = await adjustmentRepo.getPeriodLockForEmployeeDate(client, {
      installationId, branchId: row.branch_id ?? null, workDate: row.work_date,
    });
    if (lock) return { workDate: row.work_date, lock };
  }
  return null;
}

async function usagePlan(client, {
  installationId, employeeId, dateFrom, dateTo, dayPart, tracksBalance,
}) {
  if (!tracksBalance) return { ok: true, days: [] };
  const days = await leaveRepo.listChargeableLeaveDays(client, {
    installationId, employeeId, dateFrom, dateTo, dayPart,
  });
  if (days.length === 0) return fail('LEAVE_NO_SCHEDULED_WORKDAYS', 'Khoảng nghỉ không có ngày làm việc cần trừ phép');
  return { ok: true, days };
}

async function ensureBalanceForUsage(client, {
  installationId, employeeId, leaveTypeId, allowNegativeBalance, days,
}) {
  if (allowNegativeBalance || days.length === 0) return { ok: true };
  let plannedBefore = 0;
  for (const day of days) {
    const balance = await leaveRepo.getLeaveBalanceAsOf(client, {
      installationId, employeeId, leaveTypeId, asOfDate: day.work_date,
    });
    const units = Number(day.units);
    const remaining = balance - plannedBefore - units;
    if (remaining < -0.00001) {
      return fail('LEAVE_BALANCE_INSUFFICIENT', `Số dư phép không đủ tại ngày ${day.work_date}`);
    }
    plannedBefore += units;
  }
  return { ok: true };
}

async function postUsage(client, { requestContext, request, days }) {
  if (!request.leave_tracks_balance_snapshot || days.length === 0) return [];
  return leaveRepo.insertLeaveBalanceEntries(client, {
    installationId: requestContext.installationId,
    employeeId: request.employee_id,
    leaveTypeId: request.leave_type_id,
    leaveTypeCodeSnapshot: request.leave_type_code_snapshot,
    leaveTypeNameSnapshot: request.leave_type_name_snapshot,
    actorId: requestContext.actorId,
    requestId: requestContext.requestId,
    entries: days.map((day) => ({
      entryType: 'USAGE',
      quantityDays: -Number(day.units),
      effectiveDate: day.work_date,
      sourceType: 'LEAVE_REQUEST',
      sourceId: request.id,
      reason: `Trừ phép theo đơn nghỉ ${request.id}`,
    })),
  });
}

async function reverseUsage(client, { requestContext, request, reason }) {
  if (!request.leave_tracks_balance_snapshot) return [];
  const usages = await leaveRepo.listUsageEntriesForRequest(client, {
    installationId: requestContext.installationId, requestId: request.id,
  });
  if (usages.length === 0) return fail('LEAVE_BALANCE_LEDGER_MISSING', 'Không tìm thấy bút toán trừ phép của đơn đã duyệt');
  const cancellationDate = businessDate();
  const entries = usages.map((usage) => ({
    entryType: 'REVERSAL',
    quantityDays: -Number(usage.quantity_days),
    effectiveDate: String(usage.effective_date) > cancellationDate ? String(usage.effective_date) : cancellationDate,
    sourceType: 'LEAVE_CANCELLATION',
    sourceId: `${request.id}:${usage.id}`,
    reversesEntryId: usage.id,
    reason,
  }));
  const inserted = await leaveRepo.insertLeaveBalanceEntries(client, {
    installationId: requestContext.installationId,
    employeeId: request.employee_id,
    leaveTypeId: request.leave_type_id,
    leaveTypeCodeSnapshot: request.leave_type_code_snapshot,
    leaveTypeNameSnapshot: request.leave_type_name_snapshot,
    entries,
    actorId: requestContext.actorId,
    requestId: requestContext.requestId,
  });
  return { ok: true, entries: inserted };
}

function normalizeBalanceEntry(payload) {
  const employeeId = text(payload?.employeeId);
  const leaveTypeId = text(payload?.leaveTypeId);
  const entryType = text(payload?.entryType).toUpperCase();
  const effectiveDate = text(payload?.effectiveDate);
  const rawDays = Number(payload?.days);
  if (!validUuid(employeeId)) return fail('EMPLOYEE_NOT_FOUND', 'Không tìm thấy nhân sự');
  if (!validUuid(leaveTypeId)) return fail('LEAVE_TYPE_NOT_FOUND', 'Không tìm thấy chế độ nghỉ');
  if (!MANUAL_BALANCE_ENTRY_TYPES.has(entryType)) return fail('INVALID_LEAVE_BALANCE_ENTRY_TYPE', 'Loại phát sinh sổ phép không hợp lệ');
  if (!validDate(effectiveDate)) return fail('INVALID_LEAVE_BALANCE_DATE', 'Ngày hiệu lực sổ phép không hợp lệ');
  if (!Number.isFinite(rawDays) || rawDays === 0 || Math.abs(rawDays) > 3660 || Math.round(rawDays * 100) !== rawDays * 100) {
    return fail('INVALID_LEAVE_BALANCE_DAYS', 'Số ngày phải khác 0, tối đa 3.660 ngày và có tối đa 2 chữ số thập phân');
  }
  if (entryType !== 'ADJUSTMENT' && rawDays < 0) return fail('INVALID_LEAVE_BALANCE_DAYS', 'Số ngày của phát sinh này phải lớn hơn 0');
  const reason = reasonValue(payload?.reason, { required: true, code: 'INVALID_LEAVE_BALANCE_REASON', label: 'Lý do' });
  if (!reason.ok) return reason;
  const quantityDays = entryType === 'EXPIRY' ? -rawDays : rawDays;
  return { ok: true, value: { employeeId, leaveTypeId, entryType, effectiveDate, quantityDays, reason: reason.value } };
}

export async function listLeaveTypes(client, { installationId, includeInactive = false }) {
  return { ok: true, leaveTypes: await leaveRepo.listLeaveTypes(client, { installationId, includeInactive }) };
}

export async function createLeaveType(client, { installationId, payload, actorId }) {
  const normalized = normalizeLeaveType(payload);
  if (!normalized.ok) return normalized;
  const existing = await leaveRepo.findLeaveTypeByCode(client, { installationId, code: normalized.value.code });
  if (existing) return fail('LEAVE_TYPE_CODE_EXISTS', 'Mã chế độ nghỉ đã tồn tại');
  try {
    const leaveType = await leaveRepo.insertLeaveType(client, { installationId, ...normalized.value, actorId });
    return { ok: true, leaveType };
  } catch (error) {
    if (error?.code === '23505') return fail('LEAVE_TYPE_CODE_EXISTS', 'Mã chế độ nghỉ đã tồn tại');
    throw error;
  }
}

export async function updateLeaveType(client, { installationId, payload, actorId }) {
  const id = text(payload?.id);
  const expectedVersion = Number(payload?.expectedVersion);
  if (!validUuid(id)) return fail('LEAVE_TYPE_NOT_FOUND', 'Không tìm thấy chế độ nghỉ');
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) return fail('INVALID_EXPECTED_VERSION', 'Phiên bản chế độ nghỉ không hợp lệ');
  const beforeLeaveType = await leaveRepo.getLeaveTypeById(client, { installationId, id, forUpdate: true });
  if (!beforeLeaveType) return fail('LEAVE_TYPE_NOT_FOUND', 'Không tìm thấy chế độ nghỉ');
  if (beforeLeaveType.version !== expectedVersion) return fail('LEAVE_TYPE_CONFLICT', 'Chế độ nghỉ vừa thay đổi; hãy tải lại dữ liệu');
  const normalized = normalizeLeaveType({ ...payload, code: beforeLeaveType.code, tracksBalance: payload?.tracksBalance ?? beforeLeaveType.tracks_balance, allowNegativeBalance: payload?.allowNegativeBalance ?? beforeLeaveType.allow_negative_balance });
  if (!normalized.ok) return normalized;
  const leaveType = await leaveRepo.updateLeaveType(client, { installationId, id, expectedVersion, ...normalized.value, actorId });
  if (!leaveType) return fail('LEAVE_TYPE_CONFLICT', 'Chế độ nghỉ vừa thay đổi; hãy tải lại dữ liệu');
  return { ok: true, leaveType, beforeLeaveType };
}

export async function listLeaveRequests(client, {
  installationId, selfOnly, ownEmployeeId, companyScope, branchIds,
  rawEmployeeId, rawEmployeeQuery, rawBranchId, rawStatus,
  rawDateFrom, rawDateTo, rawLimit, rawOffset,
}) {
  const status = text(rawStatus).toUpperCase() || null;
  if (status && !STATUS_VALUES.has(status)) return fail('INVALID_LEAVE_STATUS', 'Trạng thái đơn nghỉ không hợp lệ');
  const dateFrom = text(rawDateFrom) || null;
  const dateTo = text(rawDateTo) || null;
  if ((dateFrom && !validDate(dateFrom)) || (dateTo && !validDate(dateTo)) || (dateFrom && dateTo && dateTo < dateFrom)) return fail('INVALID_LEAVE_PERIOD', 'Khoảng thời gian đơn nghỉ không hợp lệ');
  if (dateFrom && dateTo && periodDays(dateFrom, dateTo) > MAX_QUERY_DAYS) return fail('LEAVE_QUERY_PERIOD_TOO_LARGE', 'Mỗi lần chỉ xem tối đa 366 ngày');
  const employeeQuery = text(rawEmployeeQuery) || null;
  if (employeeQuery && employeeQuery.length > 80) return fail('INVALID_EMPLOYEE_FILTER', 'Từ khóa nhân sự tối đa 80 ký tự');
  const branchId = text(rawBranchId) || null;
  if (branchId && !validUuid(branchId)) return fail('BRANCH_NOT_FOUND', 'Chi nhánh không hợp lệ');
  if (branchId && !companyScope && !new Set(branchIds ?? []).has(branchId)) return fail('SCOPE_FORBIDDEN', 'Chi nhánh nằm ngoài phạm vi được cấp');
  let employeeId = text(rawEmployeeId) || null;
  let selectedEmployee = null;
  if (selfOnly) {
    employeeId = text(ownEmployeeId);
    if (!validUuid(employeeId)) return fail('EMPLOYEE_ID_REQUIRED', 'Tài khoản chưa liên kết hồ sơ nhân sự');
  } else if (employeeId) {
    const scoped = await employeeForScope(client, { installationId, employeeId, companyScope, branchIds, businessDateValue: dateFrom ?? dateTo ?? businessDate() });
    if (!scoped.ok) return scoped;
    selectedEmployee = employeeSummary(scoped.employee);
  }
  const limit = integer(rawLimit, 1, 100, 50);
  const offset = integer(rawOffset, 0, 1_000_000, 0);
  if (Number.isNaN(limit) || Number.isNaN(offset)) return fail('INVALID_PAGINATION', 'Thông tin phân trang không hợp lệ');
  const balanceAsOfDate = dateTo ?? dateFrom ?? businessDate();
  const balanceBranchIds = selfOnly || companyScope ? null : (branchId ? [branchId] : branchIds);
  const [page, branches, leaveBalances, balanceEntries] = await Promise.all([
    leaveRepo.listLeaveRequests(client, {
      installationId, employeeId, employeeQuery: selfOnly ? null : employeeQuery,
      branchId: selfOnly ? null : branchId, branchIds: selfOnly || companyScope ? null : branchIds,
      status, dateFrom, dateTo, limit, offset,
    }),
    workforceRepo.listAttendanceBranches(client, { installationId, branchIds: selfOnly ? [] : (companyScope ? null : branchIds) }),
    leaveRepo.listLeaveBalances(client, {
      installationId,
      asOfDate: balanceAsOfDate,
      employeeId,
      employeeQuery: selfOnly ? null : employeeQuery,
      branchIds: balanceBranchIds,
      leaveTypeId: null,
      limit: 100,
    }),
    employeeId
      ? leaveRepo.listLeaveBalanceEntries(client, {
        installationId,
        employeeId,
        leaveTypeId: null,
        branchIds: selfOnly || companyScope ? null : balanceBranchIds,
        limit: 100,
      })
      : Promise.resolve([]),
  ]);
  if (selfOnly && employeeId) {
    selectedEmployee = employeeSummary(await employeeRepo.resolveEmployeeAtDate(client, {
      installationId, employeeId, businessDate: balanceAsOfDate,
    }));
  }
  return {
    ok: true,
    data: {
      selectedEmployee,
      branches,
      balanceAsOfDate,
      leaveBalances: leaveBalances.map((row) => ({ ...row, balance_days: Number(row.balance_days ?? 0) })),
      balanceEntries: balanceEntries.map((row) => ({ ...row, quantity_days: Number(row.quantity_days ?? 0) })),
      pagination: { limit, offset, total: page.total, hasPrevious: offset > 0, hasNext: offset + page.rows.length < page.total },
      requests: page.rows,
    },
  };
}

export async function submitLeaveRequest(client, { requestContext, payload }) {
  const employeeId = text(requestContext.employeeId);
  if (!validUuid(employeeId)) return fail('EMPLOYEE_ID_REQUIRED', 'Tài khoản chưa liên kết hồ sơ nhân sự');
  const normalized = normalizeRequestPayload(payload);
  if (!normalized.ok) return normalized;
  await adjustmentRepo.lockAttendanceMutationScope(client, { installationId: requestContext.installationId });
  const scoped = await leavePeriodScope(client, {
    installationId: requestContext.installationId,
    employeeId,
    dateFrom: normalized.value.dateFrom,
    dateTo: normalized.value.dateTo,
  });
  if (!scoped.ok) return scoped;
  const locked = await findLockedDay(client, {
    installationId: requestContext.installationId, scopeRows: scoped.rows,
  });
  if (locked) return fail('ATTENDANCE_PERIOD_LOCKED', `Kỳ công ngày ${locked.workDate} đã khóa; không thể gửi đơn nghỉ`);
  const leaveType = await leaveRepo.getLeaveTypeById(client, {
    installationId: requestContext.installationId, id: normalized.value.leaveTypeId,
  });
  if (!leaveType) return fail('LEAVE_TYPE_NOT_FOUND', 'Không tìm thấy chế độ nghỉ');
  if (!leaveType.is_active) return fail('LEAVE_TYPE_INACTIVE', 'Chế độ nghỉ này đã ngừng áp dụng');
  if (normalized.value.dayPart === 'FULL_DAY' && !leaveType.allows_full_day) return fail('LEAVE_FULL_DAY_NOT_ALLOWED', 'Chế độ nghỉ này không cho phép nghỉ cả ngày');
  if (normalized.value.dayPart !== 'FULL_DAY' && !leaveType.allows_half_day) return fail('LEAVE_HALF_DAY_NOT_ALLOWED', 'Chế độ nghỉ này không cho phép nghỉ nửa ngày');
  if (leaveType.requires_attachment && !normalized.value.attachmentReference) return fail('LEAVE_ATTACHMENT_REQUIRED', 'Chế độ nghỉ này yêu cầu chứng từ');
  const overlap = await leaveRepo.findOverlappingLeaveRequest(client, {
    installationId: requestContext.installationId, employeeId,
    dateFrom: normalized.value.dateFrom, dateTo: normalized.value.dateTo, dayPart: normalized.value.dayPart,
  });
  if (overlap) return fail('LEAVE_REQUEST_OVERLAP', 'Thời gian nghỉ đã có đơn khác đang chờ hoặc đã duyệt');
  const plan = await usagePlan(client, {
    installationId: requestContext.installationId, employeeId,
    dateFrom: normalized.value.dateFrom, dateTo: normalized.value.dateTo,
    dayPart: normalized.value.dayPart, tracksBalance: leaveType.tracks_balance,
  });
  if (!plan.ok) return plan;
  const balance = await ensureBalanceForUsage(client, {
    installationId: requestContext.installationId, employeeId, leaveTypeId: leaveType.id,
    allowNegativeBalance: leaveType.allow_negative_balance, days: plan.days,
  });
  if (!balance.ok) return balance;
  const autoApproved = !leaveType.requires_approval;
  const now = autoApproved ? new Date().toISOString() : null;
  const request = await leaveRepo.insertLeaveRequest(client, {
    installationId: requestContext.installationId,
    employeeId,
    leaveTypeId: leaveType.id,
    leaveTypeCodeSnapshot: leaveType.code,
    leaveTypeNameSnapshot: leaveType.name,
    leaveIsPaidSnapshot: leaveType.is_paid,
    leaveCountsAsWorkdaySnapshot: leaveType.counts_as_workday,
    leaveRequiresApprovalSnapshot: leaveType.requires_approval,
    leaveTracksBalanceSnapshot: leaveType.tracks_balance,
    leaveAllowNegativeBalanceSnapshot: leaveType.allow_negative_balance,
    dateFrom: normalized.value.dateFrom,
    dateTo: normalized.value.dateTo,
    dayPart: normalized.value.dayPart,
    reason: normalized.value.reason,
    attachmentReference: normalized.value.attachmentReference,
    status: autoApproved ? 'APPROVED' : 'SUBMITTED',
    requestedByActorId: requestContext.actorId,
    requestedByEmployeeId: employeeId,
    reviewedByActorId: autoApproved ? requestContext.actorId : null,
    reviewReason: autoApproved ? 'Tự động duyệt theo chế độ nghỉ' : null,
    reviewedAt: now,
    requestId: requestContext.requestId,
  });
  if (autoApproved) await postUsage(client, { requestContext, request, days: plan.days });
  return { ok: true, request, autoApproved };
}

export async function reviewLeaveRequest(client, { requestContext, payload, companyScope, branchIds, allowLockedOverride }) {
  const requestId = text(payload?.requestId);
  const action = text(payload?.action).toUpperCase();
  const expectedVersion = Number(payload?.expectedVersion);
  if (!validUuid(requestId)) return fail('LEAVE_REQUEST_NOT_FOUND', 'Không tìm thấy đơn nghỉ');
  if (!['APPROVE', 'REJECT'].includes(action)) return fail('INVALID_LEAVE_ACTION', 'Thao tác xử lý đơn nghỉ không hợp lệ');
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) return fail('INVALID_EXPECTED_VERSION', 'Phiên bản đơn nghỉ không hợp lệ');
  const reviewReason = reasonValue(payload?.reviewReason, { required: action === 'REJECT', code: 'INVALID_LEAVE_REVIEW_REASON', label: 'Ý kiến xử lý' });
  if (!reviewReason.ok) return reviewReason;
  await adjustmentRepo.lockAttendanceMutationScope(client, { installationId: requestContext.installationId });
  const beforeRequest = await leaveRepo.getLeaveRequestById(client, {
    installationId: requestContext.installationId, id: requestId, forUpdate: true,
  });
  if (!beforeRequest) return fail('LEAVE_REQUEST_NOT_FOUND', 'Không tìm thấy đơn nghỉ');
  if (beforeRequest.version !== expectedVersion || beforeRequest.status !== 'SUBMITTED') return fail('LEAVE_REQUEST_CONFLICT', 'Đơn nghỉ đã được xử lý hoặc vừa thay đổi; hãy tải lại dữ liệu');
  const scoped = await leavePeriodScope(client, {
    installationId: requestContext.installationId,
    employeeId: beforeRequest.employee_id,
    dateFrom: String(beforeRequest.date_from),
    dateTo: String(beforeRequest.date_to),
    companyScope,
    branchIds,
  });
  if (!scoped.ok) return scoped;
  const locked = await findLockedDay(client, {
    installationId: requestContext.installationId, scopeRows: scoped.rows,
  });
  if (locked && !allowLockedOverride) return fail('ATTENDANCE_PERIOD_LOCKED', `Kỳ công ngày ${locked.workDate} đã khóa; cần quyền khóa kỳ để xử lý ngoại lệ`);
  let plan = { ok: true, days: [] };
  if (action === 'APPROVE') {
    const overlap = await leaveRepo.findOverlappingLeaveRequest(client, {
      installationId: requestContext.installationId,
      employeeId: beforeRequest.employee_id,
      dateFrom: String(beforeRequest.date_from),
      dateTo: String(beforeRequest.date_to),
      dayPart: beforeRequest.day_part,
      excludeId: beforeRequest.id,
    });
    if (overlap) return fail('LEAVE_REQUEST_OVERLAP', 'Thời gian nghỉ đã có đơn khác đang chờ hoặc đã duyệt');
    plan = await usagePlan(client, {
      installationId: requestContext.installationId,
      employeeId: beforeRequest.employee_id,
      dateFrom: String(beforeRequest.date_from),
      dateTo: String(beforeRequest.date_to),
      dayPart: beforeRequest.day_part,
      tracksBalance: beforeRequest.leave_tracks_balance_snapshot,
    });
    if (!plan.ok) return plan;
    const balance = await ensureBalanceForUsage(client, {
      installationId: requestContext.installationId,
      employeeId: beforeRequest.employee_id,
      leaveTypeId: beforeRequest.leave_type_id,
      allowNegativeBalance: beforeRequest.leave_allow_negative_balance_snapshot,
      days: plan.days,
    });
    if (!balance.ok) return balance;
  }
  const request = await leaveRepo.reviewLeaveRequest(client, {
    installationId: requestContext.installationId,
    id: requestId,
    expectedVersion,
    nextStatus: action === 'APPROVE' ? 'APPROVED' : 'REJECTED',
    reviewerActorId: requestContext.actorId,
    reviewReason: reviewReason.value,
  });
  if (!request) return fail('LEAVE_REQUEST_CONFLICT', 'Đơn nghỉ đã được xử lý hoặc vừa thay đổi; hãy tải lại dữ liệu');
  if (action === 'APPROVE') {
    request.leave_tracks_balance_snapshot = beforeRequest.leave_tracks_balance_snapshot;
    request.leave_allow_negative_balance_snapshot = beforeRequest.leave_allow_negative_balance_snapshot;
    await postUsage(client, { requestContext, request, days: plan.days });
  }
  return { ok: true, request, beforeRequest, lockedOverride: Boolean(locked) };
}

export async function cancelLeaveRequest(client, { requestContext, payload, selfOnly, companyScope, branchIds, allowLockedOverride }) {
  const requestId = text(payload?.requestId);
  const expectedVersion = Number(payload?.expectedVersion);
  if (!validUuid(requestId)) return fail('LEAVE_REQUEST_NOT_FOUND', 'Không tìm thấy đơn nghỉ');
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) return fail('INVALID_EXPECTED_VERSION', 'Phiên bản đơn nghỉ không hợp lệ');
  const cancelReason = reasonValue(payload?.cancelReason, { required: true, code: 'INVALID_LEAVE_CANCEL_REASON', label: 'Lý do hủy' });
  if (!cancelReason.ok) return cancelReason;
  await adjustmentRepo.lockAttendanceMutationScope(client, { installationId: requestContext.installationId });
  const beforeRequest = await leaveRepo.getLeaveRequestById(client, {
    installationId: requestContext.installationId, id: requestId, forUpdate: true,
  });
  if (!beforeRequest) return fail('LEAVE_REQUEST_NOT_FOUND', 'Không tìm thấy đơn nghỉ');
  if (beforeRequest.version !== expectedVersion) return fail('LEAVE_REQUEST_CONFLICT', 'Đơn nghỉ vừa thay đổi; hãy tải lại dữ liệu');
  if (selfOnly && String(beforeRequest.employee_id) !== String(requestContext.employeeId ?? '')) return fail('SCOPE_FORBIDDEN', 'Bạn chỉ có thể hủy đơn nghỉ của chính mình');
  const allowedStatuses = selfOnly ? ['SUBMITTED'] : ['SUBMITTED', 'APPROVED'];
  if (!allowedStatuses.includes(beforeRequest.status)) return fail('LEAVE_REQUEST_CONFLICT', selfOnly ? 'Chỉ có thể tự hủy đơn đang chờ duyệt' : 'Đơn nghỉ không còn ở trạng thái có thể hủy');
  const scoped = await leavePeriodScope(client, {
    installationId: requestContext.installationId,
    employeeId: beforeRequest.employee_id,
    dateFrom: String(beforeRequest.date_from),
    dateTo: String(beforeRequest.date_to),
    companyScope: selfOnly ? true : companyScope,
    branchIds: selfOnly ? [] : branchIds,
  });
  if (!scoped.ok) return scoped;
  const locked = await findLockedDay(client, {
    installationId: requestContext.installationId, scopeRows: scoped.rows,
  });
  if (locked && !allowLockedOverride) return fail('ATTENDANCE_PERIOD_LOCKED', `Kỳ công ngày ${locked.workDate} đã khóa; cần quyền khóa kỳ để hủy ngoại lệ`);
  const request = await leaveRepo.cancelLeaveRequest(client, {
    installationId: requestContext.installationId, id: requestId, expectedVersion,
    allowedStatuses, actorId: requestContext.actorId, cancelReason: cancelReason.value,
  });
  if (!request) return fail('LEAVE_REQUEST_CONFLICT', 'Đơn nghỉ vừa thay đổi; hãy tải lại dữ liệu');
  let balanceEntries = [];
  if (beforeRequest.status === 'APPROVED' && beforeRequest.leave_tracks_balance_snapshot) {
    const reversed = await reverseUsage(client, {
      requestContext, request: beforeRequest, reason: `Hoàn phép do hủy đơn: ${cancelReason.value}`,
    });
    if (!reversed.ok) return reversed;
    balanceEntries = reversed.entries;
  }
  return { ok: true, request, beforeRequest, balanceEntries, lockedOverride: Boolean(locked) };
}

export async function listLeaveBalances(client, {
  installationId, selfOnly, ownEmployeeId, companyScope, branchIds,
  rawEmployeeId, rawEmployeeQuery, rawLeaveTypeId, rawAsOfDate,
}) {
  const asOfDate = text(rawAsOfDate) || businessDate();
  if (!validDate(asOfDate)) return fail('INVALID_LEAVE_BALANCE_DATE', 'Ngày xem số dư phép không hợp lệ');
  let employeeId = text(rawEmployeeId) || null;
  const employeeQuery = text(rawEmployeeQuery) || null;
  const leaveTypeId = text(rawLeaveTypeId) || null;
  if (employeeQuery && employeeQuery.length > 80) return fail('INVALID_EMPLOYEE_FILTER', 'Từ khóa nhân sự tối đa 80 ký tự');
  if (leaveTypeId && !validUuid(leaveTypeId)) return fail('LEAVE_TYPE_NOT_FOUND', 'Chế độ nghỉ không hợp lệ');
  if (selfOnly) {
    employeeId = text(ownEmployeeId);
    if (!validUuid(employeeId)) return fail('EMPLOYEE_ID_REQUIRED', 'Tài khoản chưa liên kết hồ sơ nhân sự');
  } else if (employeeId) {
    const scoped = await employeeForScope(client, {
      installationId, employeeId, companyScope, branchIds, businessDateValue: asOfDate,
    });
    if (!scoped.ok) return scoped;
  }
  const balances = await leaveRepo.listLeaveBalances(client, {
    installationId,
    asOfDate,
    employeeId,
    employeeQuery: selfOnly ? null : employeeQuery,
    branchIds: selfOnly || companyScope ? null : branchIds,
    leaveTypeId,
    limit: 100,
  });
  const entries = employeeId && leaveTypeId
    ? await leaveRepo.listLeaveBalanceEntries(client, {
      installationId,
      employeeId,
      leaveTypeId,
      branchIds: selfOnly || companyScope ? null : branchIds,
      limit: 100,
    })
    : [];
  return {
    ok: true,
    data: {
      asOfDate,
      balances: balances.map((row) => ({ ...row, balance_days: Number(row.balance_days ?? 0) })),
      entries: entries.map((row) => ({ ...row, quantity_days: Number(row.quantity_days ?? 0) })),
    },
  };
}

export async function postLeaveBalanceEntry(client, {
  requestContext, payload, companyScope, branchIds,
}) {
  const normalized = normalizeBalanceEntry(payload);
  if (!normalized.ok) return normalized;
  await adjustmentRepo.lockAttendanceMutationScope(client, { installationId: requestContext.installationId });
  const scoped = await employeeForScope(client, {
    installationId: requestContext.installationId,
    employeeId: normalized.value.employeeId,
    companyScope,
    branchIds,
    businessDateValue: normalized.value.effectiveDate,
  });
  if (!scoped.ok) return scoped;
  const leaveType = await leaveRepo.getLeaveTypeById(client, {
    installationId: requestContext.installationId, id: normalized.value.leaveTypeId,
  });
  if (!leaveType) return fail('LEAVE_TYPE_NOT_FOUND', 'Không tìm thấy chế độ nghỉ');
  if (!leaveType.tracks_balance) return fail('LEAVE_BALANCE_NOT_TRACKED', 'Chế độ nghỉ này không theo dõi số dư phép');
  if (normalized.value.quantityDays < 0 && !leaveType.allow_negative_balance) {
    const minimumFutureBalance = await leaveRepo.getMinimumLeaveBalanceFromDate(client, {
      installationId: requestContext.installationId,
      employeeId: normalized.value.employeeId,
      leaveTypeId: leaveType.id,
      fromDate: normalized.value.effectiveDate,
    });
    if (minimumFutureBalance + normalized.value.quantityDays < -0.00001) {
      return fail('LEAVE_BALANCE_INSUFFICIENT', 'Phát sinh này làm số dư phép âm tại ngày hiệu lực hoặc một ngày sau đó');
    }
  }
  const [entry] = await leaveRepo.insertLeaveBalanceEntries(client, {
    installationId: requestContext.installationId,
    employeeId: normalized.value.employeeId,
    leaveTypeId: leaveType.id,
    leaveTypeCodeSnapshot: leaveType.code,
    leaveTypeNameSnapshot: leaveType.name,
    actorId: requestContext.actorId,
    requestId: requestContext.requestId,
    entries: [{
      entryType: normalized.value.entryType,
      quantityDays: normalized.value.quantityDays,
      effectiveDate: normalized.value.effectiveDate,
      sourceType: 'MANUAL',
      sourceId: requestContext.requestId,
      reason: normalized.value.reason,
    }],
  });
  return { ok: true, entry: { ...entry, quantity_days: Number(entry.quantity_days) } };
}


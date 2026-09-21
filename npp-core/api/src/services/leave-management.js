import * as leaveRepo from '../db/repositories/leave-management.js';
import * as workforceRepo from '../db/repositories/workforce.js';
import * as adjustmentRepo from '../db/repositories/attendance-adjustments.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,31}$/;
const STATUS_VALUES = new Set(['SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED']);
const DAY_PART_VALUES = new Set(['FULL_DAY', 'FIRST_HALF', 'SECOND_HALF']);
const MAX_REQUEST_DAYS = 366;
const MAX_QUERY_DAYS = 366;

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
  if ([isActive, isPaid, countsAsWorkday, requiresApproval, allowsFullDay, allowsHalfDay, requiresAttachment].includes(null)) {
    return fail('INVALID_LEAVE_TYPE_CONFIGURATION', 'Thiết lập chế độ nghỉ không hợp lệ');
  }
  if (!allowsFullDay && !allowsHalfDay) return fail('INVALID_LEAVE_TYPE_CONFIGURATION', 'Chế độ nghỉ phải cho phép nghỉ cả ngày hoặc nửa ngày');
  return { ok: true, value: { code, name, isActive, isPaid, countsAsWorkday, requiresApproval, allowsFullDay, allowsHalfDay, requiresAttachment } };
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
async function employeeForScope(client, { installationId, employeeId, companyScope, branchIds }) {
  if (!validUuid(employeeId)) return fail('EMPLOYEE_NOT_FOUND', 'Không tìm thấy nhân sự');
  const employee = await workforceRepo.getEmployeeScopeRecord(client, { installationId, employeeId, lock: 'share' });
  if (!employee) return fail('EMPLOYEE_NOT_FOUND', 'Không tìm thấy nhân sự');
  if (!employeeInScope(employee, { companyScope, branchIds })) return fail('SCOPE_FORBIDDEN', 'Nhân sự nằm ngoài phạm vi được cấp');
  return { ok: true, employee };
}
async function findLockedDay(client, { installationId, branchId, dateFrom, dateTo }) {
  const cursor = new Date(`${dateFrom}T00:00:00Z`);
  const end = new Date(`${dateTo}T00:00:00Z`);
  while (cursor <= end) {
    const workDate = cursor.toISOString().slice(0, 10);
    const lock = await adjustmentRepo.getPeriodLockForEmployeeDate(client, { installationId, branchId, workDate });
    if (lock) return { workDate, lock };
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return null;
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
  const normalized = normalizeLeaveType({ ...payload, code: beforeLeaveType.code });
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
    const scoped = await employeeForScope(client, { installationId, employeeId, companyScope, branchIds });
    if (!scoped.ok) return scoped;
    selectedEmployee = employeeSummary(scoped.employee);
  }
  const limit = integer(rawLimit, 1, 100, 50);
  const offset = integer(rawOffset, 0, 1_000_000, 0);
  if (Number.isNaN(limit) || Number.isNaN(offset)) return fail('INVALID_PAGINATION', 'Thông tin phân trang không hợp lệ');
  const [page, branches] = await Promise.all([
    leaveRepo.listLeaveRequests(client, {
      installationId, employeeId, employeeQuery: selfOnly ? null : employeeQuery,
      branchId: selfOnly ? null : branchId, branchIds: selfOnly || companyScope ? null : branchIds,
      status, dateFrom, dateTo, limit, offset,
    }),
    workforceRepo.listAttendanceBranches(client, { installationId, branchIds: selfOnly ? [] : (companyScope ? null : branchIds) }),
  ]);
  if (selfOnly && employeeId) {
    selectedEmployee = employeeSummary(await workforceRepo.getEmployeeScopeRecord(client, { installationId, employeeId, lock: 'share' }));
  }
  return { ok: true, data: { selectedEmployee, branches, pagination: { limit, offset, total: page.total, hasPrevious: offset > 0, hasNext: offset + page.rows.length < page.total }, requests: page.rows } };
}

export async function submitLeaveRequest(client, { requestContext, payload }) {
  const employeeId = text(requestContext.employeeId);
  if (!validUuid(employeeId)) return fail('EMPLOYEE_ID_REQUIRED', 'Tài khoản chưa liên kết hồ sơ nhân sự');
  const normalized = normalizeRequestPayload(payload);
  if (!normalized.ok) return normalized;
  await adjustmentRepo.lockAttendanceMutationScope(client, { installationId: requestContext.installationId });
  const employee = await workforceRepo.getEmployeeScopeRecord(client, { installationId: requestContext.installationId, employeeId, lock: 'share' });
  if (!employee || !employee.is_active) return fail('EMPLOYEE_NOT_FOUND', 'Không tìm thấy hồ sơ nhân sự đang hoạt động');
  const locked = await findLockedDay(client, { installationId: requestContext.installationId, branchId: employee.branch_id ?? null, dateFrom: normalized.value.dateFrom, dateTo: normalized.value.dateTo });
  if (locked) return fail('ATTENDANCE_PERIOD_LOCKED', `Kỳ công ngày ${locked.workDate} đã khóa; không thể gửi đơn nghỉ`);
  const leaveType = await leaveRepo.getLeaveTypeById(client, { installationId: requestContext.installationId, id: normalized.value.leaveTypeId });
  if (!leaveType) return fail('LEAVE_TYPE_NOT_FOUND', 'Không tìm thấy chế độ nghỉ');
  if (!leaveType.is_active) return fail('LEAVE_TYPE_INACTIVE', 'Chế độ nghỉ này đã ngừng áp dụng');
  if (normalized.value.dayPart === 'FULL_DAY' && !leaveType.allows_full_day) return fail('LEAVE_FULL_DAY_NOT_ALLOWED', 'Chế độ nghỉ này không cho phép nghỉ cả ngày');
  if (normalized.value.dayPart !== 'FULL_DAY' && !leaveType.allows_half_day) return fail('LEAVE_HALF_DAY_NOT_ALLOWED', 'Chế độ nghỉ này không cho phép nghỉ nửa ngày');
  if (leaveType.requires_attachment && !normalized.value.attachmentReference) return fail('LEAVE_ATTACHMENT_REQUIRED', 'Chế độ nghỉ này yêu cầu chứng từ');
  const overlap = await leaveRepo.findOverlappingLeaveRequest(client, { installationId: requestContext.installationId, employeeId, dateFrom: normalized.value.dateFrom, dateTo: normalized.value.dateTo, dayPart: normalized.value.dayPart });
  if (overlap) return fail('LEAVE_REQUEST_OVERLAP', 'Thời gian nghỉ đã có đơn khác đang chờ hoặc đã duyệt');
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
  const beforeRequest = await leaveRepo.getLeaveRequestById(client, { installationId: requestContext.installationId, id: requestId, forUpdate: true });
  if (!beforeRequest) return fail('LEAVE_REQUEST_NOT_FOUND', 'Không tìm thấy đơn nghỉ');
  if (beforeRequest.version !== expectedVersion || beforeRequest.status !== 'SUBMITTED') return fail('LEAVE_REQUEST_CONFLICT', 'Đơn nghỉ đã được xử lý hoặc vừa thay đổi; hãy tải lại dữ liệu');
  const scoped = await employeeForScope(client, { installationId: requestContext.installationId, employeeId: beforeRequest.employee_id, companyScope, branchIds });
  if (!scoped.ok) return scoped;
  const locked = await findLockedDay(client, { installationId: requestContext.installationId, branchId: scoped.employee.branch_id ?? null, dateFrom: String(beforeRequest.date_from), dateTo: String(beforeRequest.date_to) });
  if (locked && !allowLockedOverride) return fail('ATTENDANCE_PERIOD_LOCKED', `Kỳ công ngày ${locked.workDate} đã khóa; cần quyền khóa kỳ để xử lý ngoại lệ`);
  if (action === 'APPROVE') {
    const overlap = await leaveRepo.findOverlappingLeaveRequest(client, { installationId: requestContext.installationId, employeeId: beforeRequest.employee_id, dateFrom: String(beforeRequest.date_from), dateTo: String(beforeRequest.date_to), dayPart: beforeRequest.day_part, excludeId: beforeRequest.id });
    if (overlap) return fail('LEAVE_REQUEST_OVERLAP', 'Thời gian nghỉ đã có đơn khác đang chờ hoặc đã duyệt');
  }
  const request = await leaveRepo.reviewLeaveRequest(client, { installationId: requestContext.installationId, id: requestId, expectedVersion, nextStatus: action === 'APPROVE' ? 'APPROVED' : 'REJECTED', reviewerActorId: requestContext.actorId, reviewReason: reviewReason.value });
  if (!request) return fail('LEAVE_REQUEST_CONFLICT', 'Đơn nghỉ đã được xử lý hoặc vừa thay đổi; hãy tải lại dữ liệu');
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
  const beforeRequest = await leaveRepo.getLeaveRequestById(client, { installationId: requestContext.installationId, id: requestId, forUpdate: true });
  if (!beforeRequest) return fail('LEAVE_REQUEST_NOT_FOUND', 'Không tìm thấy đơn nghỉ');
  if (beforeRequest.version !== expectedVersion) return fail('LEAVE_REQUEST_CONFLICT', 'Đơn nghỉ vừa thay đổi; hãy tải lại dữ liệu');
  if (selfOnly && String(beforeRequest.employee_id) !== String(requestContext.employeeId ?? '')) return fail('SCOPE_FORBIDDEN', 'Bạn chỉ có thể hủy đơn nghỉ của chính mình');
  const scoped = selfOnly ? { ok: true, employee: await workforceRepo.getEmployeeScopeRecord(client, { installationId: requestContext.installationId, employeeId: beforeRequest.employee_id, lock: 'share' }) } : await employeeForScope(client, { installationId: requestContext.installationId, employeeId: beforeRequest.employee_id, companyScope, branchIds });
  if (!scoped.ok || !scoped.employee) return scoped.ok ? fail('EMPLOYEE_NOT_FOUND', 'Không tìm thấy nhân sự') : scoped;
  const allowedStatuses = selfOnly ? ['SUBMITTED'] : ['SUBMITTED', 'APPROVED'];
  if (!allowedStatuses.includes(beforeRequest.status)) return fail('LEAVE_REQUEST_CONFLICT', selfOnly ? 'Chỉ có thể tự hủy đơn đang chờ duyệt' : 'Đơn nghỉ không còn ở trạng thái có thể hủy');
  const locked = await findLockedDay(client, { installationId: requestContext.installationId, branchId: scoped.employee.branch_id ?? null, dateFrom: String(beforeRequest.date_from), dateTo: String(beforeRequest.date_to) });
  if (locked && !allowLockedOverride) return fail('ATTENDANCE_PERIOD_LOCKED', `Kỳ công ngày ${locked.workDate} đã khóa; cần quyền khóa kỳ để hủy ngoại lệ`);
  const request = await leaveRepo.cancelLeaveRequest(client, { installationId: requestContext.installationId, id: requestId, expectedVersion, allowedStatuses, actorId: requestContext.actorId, cancelReason: cancelReason.value });
  if (!request) return fail('LEAVE_REQUEST_CONFLICT', 'Đơn nghỉ vừa thay đổi; hãy tải lại dữ liệu');
  return { ok: true, request, beforeRequest, lockedOverride: Boolean(locked) };
}

import * as adjustmentRepo from '../db/repositories/attendance-adjustments.js';
import * as workforceRepo from '../db/repositories/workforce.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const STATUS_VALUES = new Set(['SUBMITTED', 'APPROVED', 'REJECTED']);
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
function periodDays(from, to) {
  return Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}
function localDate(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: INSTALLATION_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function localDateForInstant(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: INSTALLATION_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(parsed).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function employeeInScope(employee, { companyScope, branchIds }) {
  if (companyScope) return true;
  const allowed = new Set(branchIds ?? []);
  return Boolean(employee?.branch_id) && allowed.has(String(employee.branch_id));
}
function employeeSummary(employee) {
  return employee ? {
    id: employee.id,
    code: employee.code,
    name: employee.full_name,
    branchId: employee.branch_id ?? null,
  } : null;
}
function reasonValue(value, { required = true } = {}) {
  const reason = text(value);
  if ((required && !reason) || reason.length > 1000) {
    return fail('INVALID_ADJUSTMENT_REASON', required
      ? 'Lý do điều chỉnh là bắt buộc và tối đa 1.000 ký tự'
      : 'Ý kiến xử lý tối đa 1.000 ký tự');
  }
  return { ok: true, value: reason || null };
}
function normalizeRequestedTimes(payload, workDate) {
  const rawIn = text(payload?.requestedCheckInAt) || null;
  const rawOut = text(payload?.requestedCheckOutAt) || null;
  if (!rawIn && !rawOut) {
    return fail('ADJUSTMENT_TIME_REQUIRED', 'Cần nhập ít nhất giờ vào hoặc giờ ra cần điều chỉnh');
  }
  const allowedDates = new Set([workDate, nextDate(workDate)]);
  const normalize = (value) => {
    if (!value) return { ok: true, value: null };
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return fail('INVALID_ADJUSTMENT_TIME', 'Thời gian điều chỉnh không hợp lệ');
    const date = localDateForInstant(parsed);
    if (!date || !allowedDates.has(date)) {
      return fail('ADJUSTMENT_TIME_OUTSIDE_WORKDAY', 'Giờ điều chỉnh phải nằm trong ngày công hoặc ngày kế tiếp đối với ca qua ngày');
    }
    return { ok: true, value: parsed.toISOString() };
  };
  const checkIn = normalize(rawIn);
  if (!checkIn.ok) return checkIn;
  const checkOut = normalize(rawOut);
  if (!checkOut.ok) return checkOut;
  if (checkIn.value && checkOut.value && new Date(checkOut.value).getTime() < new Date(checkIn.value).getTime()) {
    return fail('ADJUSTMENT_TIME_ORDER_INVALID', 'Giờ ra không được sớm hơn giờ vào');
  }
  return { ok: true, checkInAt: checkIn.value, checkOutAt: checkOut.value };
}
function auditWindow(workDate) {
  return {
    fromAt: new Date(`${workDate}T00:00:00+07:00`).toISOString(),
    toAt: new Date(`${nextDate(nextDate(workDate))}T00:00:00+07:00`).toISOString(),
  };
}
async function employeeForScope(client, {
  installationId,
  employeeId,
  companyScope,
  branchIds,
}) {
  if (!validUuid(employeeId)) return fail('EMPLOYEE_NOT_FOUND', 'Không tìm thấy nhân sự');
  const employee = await workforceRepo.getEmployeeScopeRecord(client, {
    installationId,
    employeeId,
    lock: 'share',
  });
  if (!employee) return fail('EMPLOYEE_NOT_FOUND', 'Không tìm thấy nhân sự');
  if (!employeeInScope(employee, { companyScope, branchIds })) {
    return fail('SCOPE_FORBIDDEN', 'Nhân sự nằm ngoài phạm vi được cấp');
  }
  return { ok: true, employee };
}
async function resolveLineage(client, { installationId, employeeId, workDate }) {
  const [schedule, assignment] = await Promise.all([
    workforceRepo.getWorkScheduleForEmployeeDate(client, { installationId, employeeId, workDate }),
    workforceRepo.getEffectiveEmployeePolicyAssignment(client, { installationId, employeeId, workDate }),
  ]);
  let workPolicyId = assignment?.work_policy_id ?? schedule?.work_policy_id ?? null;
  if (!workPolicyId && schedule?.work_policy_id) workPolicyId = schedule.work_policy_id;
  return {
    scheduleId: schedule?.id ?? null,
    workPolicyId,
  };
}
async function existingEvents(client, { installationId, employeeId, workDate }) {
  return adjustmentRepo.listAttendanceEventsForAudit(client, {
    installationId,
    employeeId,
    ...auditWindow(workDate),
  });
}
async function applyRequestEvents(client, {
  installationId,
  request,
  actorId,
  requestId,
}) {
  const lineage = await resolveLineage(client, {
    installationId,
    employeeId: request.employee_id,
    workDate: String(request.work_date),
  });
  const events = [];
  const specs = [
    ['CHECK_IN', request.requested_check_in_at, 'check-in'],
    ['CHECK_OUT', request.requested_check_out_at, 'check-out'],
  ];
  for (const [eventType, occurredAt, suffix] of specs) {
    if (!occurredAt) continue;
    const event = await adjustmentRepo.insertAdjustmentEvent(client, {
      installationId,
      employeeId: request.employee_id,
      scheduleId: lineage.scheduleId,
      workPolicyId: lineage.workPolicyId,
      eventType,
      occurredAt: new Date(occurredAt).toISOString(),
      sourceReference: `attendance-adjustment.${request.id}.${suffix}`,
      note: request.reason,
      actorId,
      requestId,
    });
    if (!event) return fail('ATTENDANCE_ADJUSTMENT_EVENT_FAILED', 'Không ghi được sự kiện điều chỉnh công');
    events.push(event);
  }
  return { ok: true, events };
}

export async function listAdjustmentRequests(client, {
  installationId,
  selfOnly,
  ownEmployeeId,
  companyScope,
  branchIds,
  rawEmployeeId,
  rawEmployeeQuery,
  rawBranchId,
  rawStatus,
  rawDateFrom,
  rawDateTo,
  rawLimit,
  rawOffset,
}) {
  const today = localDate();
  const defaultFrom = `${today.slice(0, 8)}01`;
  const dateFrom = text(rawDateFrom) || defaultFrom;
  const dateTo = text(rawDateTo) || today;
  if (!validDate(dateFrom) || !validDate(dateTo) || dateTo < dateFrom) {
    return fail('INVALID_ATTENDANCE_PERIOD', 'Khoảng thời gian điều chỉnh công không hợp lệ');
  }
  if (periodDays(dateFrom, dateTo) > MAX_PERIOD_DAYS) {
    return fail('ATTENDANCE_PERIOD_TOO_LARGE', 'Mỗi lần chỉ xem tối đa 93 ngày điều chỉnh công');
  }
  const status = text(rawStatus).toUpperCase() || null;
  if (status && !STATUS_VALUES.has(status)) {
    return fail('INVALID_ADJUSTMENT_STATUS', 'Trạng thái yêu cầu điều chỉnh không hợp lệ');
  }
  const employeeQuery = text(rawEmployeeQuery) || null;
  if (employeeQuery && employeeQuery.length > 80) {
    return fail('INVALID_EMPLOYEE_FILTER', 'Từ khóa nhân sự tối đa 80 ký tự');
  }
  const branchId = text(rawBranchId) || null;
  if (branchId && !validUuid(branchId)) return fail('BRANCH_NOT_FOUND', 'Chi nhánh không hợp lệ');
  if (branchId && !companyScope && !new Set(branchIds ?? []).has(branchId)) {
    return fail('SCOPE_FORBIDDEN', 'Chi nhánh nằm ngoài phạm vi được cấp');
  }

  let employeeId = text(rawEmployeeId) || null;
  let selectedEmployee = null;
  if (selfOnly) {
    employeeId = text(ownEmployeeId);
    if (!validUuid(employeeId)) return fail('EMPLOYEE_ID_REQUIRED', 'Tài khoản chưa liên kết hồ sơ nhân sự');
  } else if (employeeId) {
    const scoped = await employeeForScope(client, {
      installationId, employeeId, companyScope, branchIds,
    });
    if (!scoped.ok) return scoped;
    selectedEmployee = employeeSummary(scoped.employee);
  }

  const limit = integer(rawLimit, 1, 100, 50);
  const offset = integer(rawOffset, 0, 1_000_000, 0);
  if (Number.isNaN(limit) || Number.isNaN(offset)) {
    return fail('INVALID_PAGINATION', 'Thông tin phân trang không hợp lệ');
  }
  const [page, branches] = await Promise.all([
    adjustmentRepo.listAdjustmentRequests(client, {
      installationId,
      employeeId,
      employeeQuery: selfOnly ? null : employeeQuery,
      branchId: selfOnly ? null : branchId,
      branchIds: selfOnly || companyScope ? null : branchIds,
      status,
      dateFrom,
      dateTo,
      limit,
      offset,
    }),
    workforceRepo.listAttendanceBranches(client, {
      installationId,
      branchIds: selfOnly ? [] : (companyScope ? null : branchIds),
    }),
  ]);
  if (selfOnly && employeeId) {
    const own = await workforceRepo.getEmployeeScopeRecord(client, {
      installationId,
      employeeId,
      lock: 'share',
    });
    selectedEmployee = employeeSummary(own);
  }
  return {
    ok: true,
    data: {
      period: { from: dateFrom, to: dateTo },
      selectedEmployee,
      branches,
      pagination: {
        limit,
        offset,
        total: page.total,
        hasPrevious: offset > 0,
        hasNext: offset + page.rows.length < page.total,
      },
      requests: page.rows,
    },
  };
}

export async function submitSelfAdjustmentRequest(client, {
  requestContext,
  payload,
}) {
  const employeeId = text(requestContext.employeeId);
  if (!validUuid(employeeId)) return fail('EMPLOYEE_ID_REQUIRED', 'Tài khoản chưa liên kết hồ sơ nhân sự');
  const workDate = text(payload?.workDate);
  if (!validDate(workDate) || workDate > localDate()) {
    return fail('INVALID_ADJUSTMENT_WORK_DATE', 'Ngày công cần điều chỉnh không hợp lệ');
  }
  const times = normalizeRequestedTimes(payload, workDate);
  if (!times.ok) return times;
  const reason = reasonValue(payload?.reason);
  if (!reason.ok) return reason;

  await adjustmentRepo.lockAttendanceMutationScope(client, {
    installationId: requestContext.installationId,
  });
  const employee = await workforceRepo.getEmployeeScopeRecord(client, {
    installationId: requestContext.installationId,
    employeeId,
    lock: 'share',
  });
  if (!employee) return fail('EMPLOYEE_NOT_FOUND', 'Không tìm thấy hồ sơ nhân sự');
  const locked = await adjustmentRepo.getPeriodLockForEmployeeDate(client, {
    installationId: requestContext.installationId,
    branchId: employee.branch_id ?? null,
    workDate,
  });
  if (locked) return fail('ATTENDANCE_PERIOD_LOCKED', 'Kỳ công này đã khóa; không thể gửi yêu cầu mới');
  const pending = await adjustmentRepo.findPendingAdjustmentRequest(client, {
    installationId: requestContext.installationId,
    employeeId,
    workDate,
  });
  if (pending) return fail('ATTENDANCE_ADJUSTMENT_PENDING', 'Ngày công này đang có yêu cầu chờ xử lý');

  try {
    const request = await adjustmentRepo.insertAdjustmentRequest(client, {
      installationId: requestContext.installationId,
      employeeId,
      workDate,
      requestedCheckInAt: times.checkInAt,
      requestedCheckOutAt: times.checkOutAt,
      reason: reason.value,
      requestSource: 'SELF_REQUEST',
      status: 'SUBMITTED',
      requestedByActorId: requestContext.actorId,
      requestedByEmployeeId: employeeId,
      reviewedByActorId: null,
      reviewReason: null,
      reviewedAt: null,
      requestId: requestContext.requestId,
    });
    return { ok: true, request };
  } catch (error) {
    if (error?.code === '23505') return fail('ATTENDANCE_ADJUSTMENT_PENDING', 'Ngày công này đang có yêu cầu chờ xử lý');
    throw error;
  }
}

export async function reviewAdjustmentRequest(client, {
  requestContext,
  payload,
  companyScope,
  branchIds,
  allowLockedOverride,
}) {
  const requestId = text(payload?.requestId);
  const action = text(payload?.action).toUpperCase();
  const expectedVersion = Number(payload?.expectedVersion);
  if (!validUuid(requestId)) return fail('ADJUSTMENT_REQUEST_NOT_FOUND', 'Không tìm thấy yêu cầu điều chỉnh');
  if (!['APPROVE', 'REJECT'].includes(action)) {
    return fail('INVALID_ADJUSTMENT_ACTION', 'Thao tác xử lý yêu cầu không hợp lệ');
  }
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    return fail('INVALID_EXPECTED_VERSION', 'Phiên bản yêu cầu không hợp lệ');
  }
  const reviewReason = reasonValue(payload?.reviewReason, { required: action === 'REJECT' });
  if (!reviewReason.ok) return reviewReason;

  await adjustmentRepo.lockAttendanceMutationScope(client, {
    installationId: requestContext.installationId,
  });
  const beforeRequest = await adjustmentRepo.getAdjustmentRequestById(client, {
    installationId: requestContext.installationId,
    id: requestId,
    forUpdate: true,
  });
  if (!beforeRequest) return fail('ADJUSTMENT_REQUEST_NOT_FOUND', 'Không tìm thấy yêu cầu điều chỉnh');
  if (beforeRequest.version !== expectedVersion || beforeRequest.status !== 'SUBMITTED') {
    return fail('ADJUSTMENT_REQUEST_CONFLICT', 'Yêu cầu đã được xử lý hoặc vừa thay đổi; hãy tải lại dữ liệu');
  }
  const scoped = await employeeForScope(client, {
    installationId: requestContext.installationId,
    employeeId: beforeRequest.employee_id,
    companyScope,
    branchIds,
  });
  if (!scoped.ok) return scoped;
  const locked = await adjustmentRepo.getPeriodLockForEmployeeDate(client, {
    installationId: requestContext.installationId,
    branchId: scoped.employee.branch_id ?? null,
    workDate: String(beforeRequest.work_date),
  });
  if (locked && !allowLockedOverride) {
    return fail('ATTENDANCE_PERIOD_LOCKED', 'Kỳ công đã khóa; cần quyền khóa kỳ để xử lý ngoại lệ');
  }

  const beforeEvents = action === 'APPROVE'
    ? await existingEvents(client, {
      installationId: requestContext.installationId,
      employeeId: beforeRequest.employee_id,
      workDate: String(beforeRequest.work_date),
    })
    : [];
  const nextStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
  const request = await adjustmentRepo.transitionAdjustmentRequest(client, {
    installationId: requestContext.installationId,
    id: requestId,
    expectedVersion,
    nextStatus,
    reviewerActorId: requestContext.actorId,
    reviewReason: reviewReason.value,
  });
  if (!request) return fail('ADJUSTMENT_REQUEST_CONFLICT', 'Yêu cầu đã được xử lý hoặc vừa thay đổi; hãy tải lại dữ liệu');

  let events = [];
  if (action === 'APPROVE') {
    const applied = await applyRequestEvents(client, {
      installationId: requestContext.installationId,
      request,
      actorId: requestContext.actorId,
      requestId: requestContext.requestId,
    });
    if (!applied.ok) return applied;
    events = applied.events;
  }
  return {
    ok: true,
    request,
    events,
    beforeRequest,
    beforeEvents,
    lockedOverride: Boolean(locked),
  };
}

export async function directAdjustment(client, {
  requestContext,
  payload,
  companyScope,
  branchIds,
  allowLockedOverride,
}) {
  const employeeId = text(payload?.employeeId);
  const workDate = text(payload?.workDate);
  if (!validDate(workDate) || workDate > localDate()) {
    return fail('INVALID_ADJUSTMENT_WORK_DATE', 'Ngày công cần điều chỉnh không hợp lệ');
  }
  const times = normalizeRequestedTimes(payload, workDate);
  if (!times.ok) return times;
  const reason = reasonValue(payload?.reason);
  if (!reason.ok) return reason;

  await adjustmentRepo.lockAttendanceMutationScope(client, {
    installationId: requestContext.installationId,
  });
  const scoped = await employeeForScope(client, {
    installationId: requestContext.installationId,
    employeeId,
    companyScope,
    branchIds,
  });
  if (!scoped.ok) return scoped;
  const locked = await adjustmentRepo.getPeriodLockForEmployeeDate(client, {
    installationId: requestContext.installationId,
    branchId: scoped.employee.branch_id ?? null,
    workDate,
  });
  if (locked && !allowLockedOverride) {
    return fail('ATTENDANCE_PERIOD_LOCKED', 'Kỳ công đã khóa; cần quyền khóa kỳ để điều chỉnh ngoại lệ');
  }
  const pending = await adjustmentRepo.findPendingAdjustmentRequest(client, {
    installationId: requestContext.installationId,
    employeeId,
    workDate,
  });
  if (pending) {
    return fail('ATTENDANCE_ADJUSTMENT_PENDING', 'Ngày công này đang có yêu cầu chờ xử lý; hãy duyệt hoặc từ chối yêu cầu trước');
  }
  const beforeEvents = await existingEvents(client, {
    installationId: requestContext.installationId,
    employeeId,
    workDate,
  });
  const now = new Date().toISOString();
  const request = await adjustmentRepo.insertAdjustmentRequest(client, {
    installationId: requestContext.installationId,
    employeeId,
    workDate,
    requestedCheckInAt: times.checkInAt,
    requestedCheckOutAt: times.checkOutAt,
    reason: reason.value,
    requestSource: 'DIRECT',
    status: 'APPROVED',
    requestedByActorId: requestContext.actorId,
    requestedByEmployeeId: requestContext.employeeId ?? null,
    reviewedByActorId: requestContext.actorId,
    reviewReason: reason.value,
    reviewedAt: now,
    requestId: requestContext.requestId,
  });
  const applied = await applyRequestEvents(client, {
    installationId: requestContext.installationId,
    request,
    actorId: requestContext.actorId,
    requestId: requestContext.requestId,
  });
  if (!applied.ok) return applied;
  return {
    ok: true,
    request,
    events: applied.events,
    beforeEvents,
    lockedOverride: Boolean(locked),
  };
}

export async function listPeriodLocks(client, {
  installationId,
  companyScope,
  branchIds,
  rawBranchId,
  rawDateFrom,
  rawDateTo,
}) {
  const branchId = text(rawBranchId) || null;
  if (branchId && !validUuid(branchId)) return fail('BRANCH_NOT_FOUND', 'Chi nhánh không hợp lệ');
  if (branchId && !companyScope && !new Set(branchIds ?? []).has(branchId)) {
    return fail('SCOPE_FORBIDDEN', 'Chi nhánh nằm ngoài phạm vi được cấp');
  }
  const dateFrom = text(rawDateFrom) || null;
  const dateTo = text(rawDateTo) || null;
  if ((dateFrom && !validDate(dateFrom)) || (dateTo && !validDate(dateTo)) || (dateFrom && dateTo && dateTo < dateFrom)) {
    return fail('INVALID_ATTENDANCE_PERIOD', 'Khoảng thời gian khóa kỳ không hợp lệ');
  }
  const [locks, branches] = await Promise.all([
    adjustmentRepo.listPeriodLocks(client, {
      installationId,
      branchId,
      branchIds: companyScope ? null : branchIds,
      dateFrom,
      dateTo,
    }),
    workforceRepo.listAttendanceBranches(client, {
      installationId,
      branchIds: companyScope ? null : branchIds,
    }),
  ]);
  return { ok: true, data: { locks, branches, companyScope } };
}

export async function createPeriodLock(client, {
  requestContext,
  payload,
  companyScope,
  branchIds,
}) {
  const periodStart = text(payload?.periodStart);
  const periodEnd = text(payload?.periodEnd);
  if (!validDate(periodStart) || !validDate(periodEnd) || periodEnd < periodStart) {
    return fail('INVALID_ATTENDANCE_PERIOD', 'Khoảng thời gian khóa kỳ không hợp lệ');
  }
  if (periodDays(periodStart, periodEnd) > MAX_PERIOD_DAYS) {
    return fail('ATTENDANCE_PERIOD_TOO_LARGE', 'Mỗi lần chỉ khóa tối đa 93 ngày công');
  }
  const reason = reasonValue(payload?.reason);
  if (!reason.ok) return reason;
  const branchId = text(payload?.branchId) || null;
  if (branchId && !validUuid(branchId)) return fail('BRANCH_NOT_FOUND', 'Chi nhánh không hợp lệ');
  if (!companyScope) {
    if (!branchId || !new Set(branchIds ?? []).has(branchId)) {
      return fail('SCOPE_FORBIDDEN', 'Chỉ được khóa kỳ trong chi nhánh được cấp');
    }
  }
  if (branchId) {
    const branch = await workforceRepo.getAttendanceBranchById(client, {
      installationId: requestContext.installationId,
      id: branchId,
    });
    if (!branch || !branch.is_active) return fail('BRANCH_NOT_FOUND', 'Không tìm thấy chi nhánh đang hoạt động');
  }

  await adjustmentRepo.lockAttendanceMutationScope(client, {
    installationId: requestContext.installationId,
  });
  const overlap = await adjustmentRepo.findOverlappingPeriodLock(client, {
    installationId: requestContext.installationId,
    branchId,
    periodStart,
    periodEnd,
  });
  if (overlap) return fail('ATTENDANCE_PERIOD_LOCK_OVERLAP', 'Khoảng thời gian này đã nằm trong một kỳ công bị khóa');
  const lock = await adjustmentRepo.insertPeriodLock(client, {
    installationId: requestContext.installationId,
    branchId,
    periodStart,
    periodEnd,
    reason: reason.value,
    actorId: requestContext.actorId,
    requestId: requestContext.requestId,
  });
  return { ok: true, lock };
}

import * as workforceRepo from '../db/repositories/workforce.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODE_PATTERN = /^[A-Z0-9_-]{1,64}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;
const POLICY_TIME_MODES = new Set(['FIXED', 'SHIFT', 'FLEXIBLE', 'NO_ATTENDANCE']);
const ATTENDANCE_METHODS = new Set(['QR', 'MANUAL', 'BOTH', 'NONE']);
const SCHEDULE_KINDS = new Set(['WORK', 'OFF']);
const INSTALLATION_TIMEZONE = 'Asia/Ho_Chi_Minh';

function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function fail(code, message) { return { ok: false, code, message, retryable: false }; }
function validUuid(value) { return typeof value === 'string' && UUID_PATTERN.test(value.trim()); }
function validDate(value) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function previousDate(value) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
function localDate(timeZone = INSTALLATION_TIMEZONE, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}
function integer(value, min, max, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : NaN;
}
function dateTime(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
function sameInstant(left, right) {
  const a = dateTime(left);
  const b = dateTime(right);
  return a !== null && b !== null && a === b;
}

function normalizePolicy(payload, codeOverride = null) {
  if (!payload || typeof payload !== 'object') return fail('INVALID_INPUT', 'Dữ liệu chính sách làm việc là bắt buộc');
  const code = (codeOverride ?? text(payload.code)).toUpperCase();
  if (!CODE_PATTERN.test(code)) return fail('INVALID_POLICY_CODE', 'Mã chính sách chỉ dùng chữ in hoa, số, gạch ngang hoặc gạch dưới');
  const name = text(payload.name);
  if (!name || name.length > 256) return fail('INVALID_POLICY_NAME', 'Tên chính sách là bắt buộc và tối đa 256 ký tự');
  const workNature = text(payload.workNature);
  if (workNature.length > 128) return fail('INVALID_WORK_NATURE', 'Tính chất công việc tối đa 128 ký tự');
  const timeMode = text(payload.timeMode).toUpperCase();
  if (!POLICY_TIME_MODES.has(timeMode)) return fail('INVALID_TIME_MODE', 'Kiểu thời gian làm việc không hợp lệ');
  const fixedStartTime = text(payload.fixedStartTime) || null;
  const fixedEndTime = text(payload.fixedEndTime) || null;
  if (fixedStartTime && !TIME_PATTERN.test(fixedStartTime)) return fail('INVALID_FIXED_START_TIME', 'Giờ bắt đầu không hợp lệ');
  if (fixedEndTime && !TIME_PATTERN.test(fixedEndTime)) return fail('INVALID_FIXED_END_TIME', 'Giờ kết thúc không hợp lệ');
  if (timeMode === 'FIXED' && (!fixedStartTime || !fixedEndTime)) {
    return fail('FIXED_TIME_REQUIRED', 'Chính sách giờ cố định phải có giờ bắt đầu và kết thúc');
  }
  const days = Array.isArray(payload.workingDays) ? [...new Set(payload.workingDays.map(Number))].sort((a, b) => a - b) : [];
  if (!days.length || days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    return fail('INVALID_WORKING_DAYS', 'Phải chọn ít nhất một ngày làm việc hợp lệ trong tuần');
  }
  const breakMinutes = integer(payload.breakMinutes, 0, 720, 0);
  const lateGraceMinutes = integer(payload.lateGraceMinutes, 0, 240, 0);
  const earlyLeaveGraceMinutes = integer(payload.earlyLeaveGraceMinutes, 0, 240, 0);
  const roundingMinutes = integer(payload.roundingMinutes, 0, 60, 0);
  const minimumFullDayMinutes = integer(payload.minimumFullDayMinutes, 1, 1440, null);
  const minimumHalfDayMinutes = integer(payload.minimumHalfDayMinutes, 1, 1440, null);
  if ([breakMinutes, lateGraceMinutes, earlyLeaveGraceMinutes, roundingMinutes, minimumFullDayMinutes, minimumHalfDayMinutes].some(Number.isNaN)) {
    return fail('INVALID_POLICY_MINUTES', 'Các giá trị phút của chính sách không hợp lệ');
  }
  const attendanceMethod = text(payload.attendanceMethod).toUpperCase();
  if (!ATTENDANCE_METHODS.has(attendanceMethod)) return fail('INVALID_ATTENDANCE_METHOD', 'Phương thức chấm công không hợp lệ');
  if (timeMode === 'NO_ATTENDANCE' && attendanceMethod !== 'NONE') {
    return fail('ATTENDANCE_METHOD_CONFLICT', 'Chính sách không bắt buộc chấm công phải dùng phương thức Không chấm công');
  }
  const timezone = text(payload.timezone) || INSTALLATION_TIMEZONE;
  if (timezone.length > 64) return fail('INVALID_TIMEZONE', 'Múi giờ không hợp lệ');
  const effectiveFrom = text(payload.effectiveFrom);
  const effectiveTo = text(payload.effectiveTo) || null;
  if (!validDate(effectiveFrom) || (effectiveTo && !validDate(effectiveTo))) {
    return fail('INVALID_EFFECTIVE_DATE', 'Ngày hiệu lực không hợp lệ');
  }
  if (effectiveTo && effectiveTo < effectiveFrom) return fail('INVALID_EFFECTIVE_RANGE', 'Ngày kết thúc hiệu lực phải từ ngày bắt đầu trở đi');
  return {
    ok: true,
    normalized: {
      code, name, workNature: workNature || null, timeMode,
      fixedStartTime, fixedEndTime, workingDays: days,
      breakMinutes, lateGraceMinutes, earlyLeaveGraceMinutes,
      overtimeEnabled: payload.overtimeEnabled === true,
      overtimeRequiresApproval: payload.overtimeRequiresApproval !== false,
      attendanceMethod, timezone, roundingMinutes,
      minimumFullDayMinutes, minimumHalfDayMinutes,
      effectiveFrom, effectiveTo,
    },
  };
}

export async function listWorkPolicies(client, { installationId }) {
  return { ok: true, policies: await workforceRepo.listWorkPolicies(client, { installationId }) };
}

export async function createWorkPolicyVersion(client, { installationId, payload, actorId }) {
  const basePolicyId = text(payload?.basePolicyId) || null;
  if (basePolicyId && !validUuid(basePolicyId)) return fail('INVALID_BASE_POLICY_ID', 'Chính sách gốc không hợp lệ');

  let latest = null;
  let codeOverride = null;
  if (basePolicyId) {
    const base = await workforceRepo.getWorkPolicyByIdForUpdate(client, { installationId, id: basePolicyId });
    if (!base) return fail('POLICY_NOT_FOUND', 'Không tìm thấy chính sách làm việc');
    codeOverride = base.code;
    latest = await workforceRepo.getLatestWorkPolicyVersionForUpdate(client, { installationId, code: base.code });
    if (!latest || latest.id !== base.id) {
      return fail('POLICY_VERSION_CONFLICT', 'Chỉ có thể tạo phiên bản mới từ phiên bản mới nhất');
    }
  }

  const validation = normalizePolicy(payload, codeOverride);
  if (!validation.ok) return validation;
  if (!latest) {
    latest = await workforceRepo.getLatestWorkPolicyVersionForUpdate(client, {
      installationId,
      code: validation.normalized.code,
    });
    if (latest) return fail('POLICY_CODE_EXISTS', 'Mã chính sách đã tồn tại; hãy tạo phiên bản mới từ chính sách hiện có');
  }

  const version = latest ? Number(latest.version) + 1 : 1;
  if (latest && validation.normalized.effectiveFrom <= String(latest.effective_from)) {
    return fail('POLICY_EFFECTIVE_DATE_CONFLICT', 'Phiên bản mới phải có ngày hiệu lực sau phiên bản hiện tại');
  }

  if (latest && (!latest.effective_to || String(latest.effective_to) >= validation.normalized.effectiveFrom)) {
    await workforceRepo.closeWorkPolicyVersion(client, {
      installationId,
      id: latest.id,
      effectiveTo: previousDate(validation.normalized.effectiveFrom),
    });
  }

  const policy = await workforceRepo.insertWorkPolicy(client, {
    installationId,
    ...validation.normalized,
    version,
    supersedesPolicyId: latest?.id ?? null,
    createdBy: actorId,
  });
  return { ok: true, policy, beforePolicy: latest, action: latest ? 'version' : 'create' };
}

export async function getEmployeeScopeRecord(client, { installationId, employeeId }) {
  if (!validUuid(employeeId)) return fail('EMPLOYEE_NOT_FOUND', 'Không tìm thấy nhân sự');
  const employee = await workforceRepo.getEmployeeScopeRecord(client, { installationId, employeeId, lock: 'share' });
  return employee ? { ok: true, employee } : fail('EMPLOYEE_NOT_FOUND', 'Không tìm thấy nhân sự');
}

export async function listEmployeePolicyAssignments(client, { installationId, employeeId }) {
  if (!validUuid(employeeId)) return fail('EMPLOYEE_NOT_FOUND', 'Không tìm thấy nhân sự');
  return {
    ok: true,
    assignments: await workforceRepo.listEmployeePolicyAssignments(client, { installationId, employeeId }),
  };
}

export async function assignWorkPolicy(client, { installationId, payload, actorId }) {
  const employeeId = text(payload?.employeeId);
  const workPolicyId = text(payload?.workPolicyId);
  const effectiveFrom = text(payload?.effectiveFrom);
  const reason = text(payload?.reason) || null;
  if (!validUuid(employeeId)) return fail('EMPLOYEE_NOT_FOUND', 'Không tìm thấy nhân sự');
  if (!validUuid(workPolicyId)) return fail('POLICY_NOT_FOUND', 'Không tìm thấy chính sách làm việc');
  if (!validDate(effectiveFrom)) return fail('INVALID_EFFECTIVE_DATE', 'Ngày bắt đầu áp dụng không hợp lệ');
  if (effectiveFrom < localDate()) return fail('RETROACTIVE_ASSIGNMENT_FORBIDDEN', 'Không thể gán chính sách lùi về ngày đã qua');
  if (reason && reason.length > 512) return fail('INVALID_REASON', 'Lý do tối đa 512 ký tự');

  const employee = await workforceRepo.getEmployeeScopeRecord(client, { installationId, employeeId, lock: 'share' });
  if (!employee) return fail('EMPLOYEE_NOT_FOUND', 'Không tìm thấy nhân sự');
  if (!employee.is_active) return fail('EMPLOYEE_INACTIVE', 'Nhân sự đã ngừng làm việc');

  const policy = await workforceRepo.getWorkPolicyById(client, { installationId, id: workPolicyId });
  if (!policy || !policy.is_active) return fail('POLICY_NOT_FOUND', 'Không tìm thấy chính sách làm việc đang hiệu lực');
  if (String(policy.effective_from) > effectiveFrom || (policy.effective_to && String(policy.effective_to) < effectiveFrom)) {
    return fail('POLICY_NOT_EFFECTIVE', 'Chính sách không có hiệu lực tại ngày bắt đầu đã chọn');
  }

  const latest = await workforceRepo.getLatestEmployeePolicyAssignmentForUpdate(client, { installationId, employeeId });
  if (latest && effectiveFrom <= String(latest.effective_from)) {
    return fail('ASSIGNMENT_EFFECTIVE_DATE_CONFLICT', 'Ngày áp dụng mới phải sau lần gán chính sách gần nhất');
  }
  if (latest && (!latest.effective_to || String(latest.effective_to) >= effectiveFrom)) {
    await workforceRepo.closeEmployeePolicyAssignment(client, {
      installationId,
      id: latest.id,
      effectiveTo: previousDate(effectiveFrom),
    });
  }
  const assignment = await workforceRepo.insertEmployeePolicyAssignment(client, {
    installationId, employeeId, workPolicyId, effectiveFrom, reason, createdBy: actorId,
  });
  return { ok: true, assignment, beforeAssignment: latest, employee };
}

export async function listWorkSchedules(client, {
  installationId,
  employeeId = null,
  dateFrom,
  dateTo,
  branchIds = null,
}) {
  if (employeeId && !validUuid(employeeId)) return fail('EMPLOYEE_NOT_FOUND', 'Không tìm thấy nhân sự');
  if (!validDate(dateFrom) || !validDate(dateTo) || dateTo < dateFrom) {
    return fail('INVALID_DATE_RANGE', 'Khoảng ngày tra cứu không hợp lệ');
  }
  const span = (new Date(`${dateTo}T00:00:00Z`) - new Date(`${dateFrom}T00:00:00Z`)) / 86_400_000;
  if (span > 93) return fail('DATE_RANGE_TOO_LARGE', 'Mỗi lần chỉ tra cứu tối đa 94 ngày');
  const schedules = await workforceRepo.listWorkSchedules(client, {
    installationId, employeeId, dateFrom, dateTo, branchIds,
  });
  return { ok: true, schedules };
}

export async function upsertWorkSchedule(client, { installationId, payload, actorId }) {
  const employeeId = text(payload?.employeeId);
  const workDate = text(payload?.workDate);
  const scheduleKind = text(payload?.scheduleKind).toUpperCase();
  const overrideReason = text(payload?.overrideReason);
  if (!validUuid(employeeId)) return fail('EMPLOYEE_NOT_FOUND', 'Không tìm thấy nhân sự');
  if (!validDate(workDate)) return fail('INVALID_WORK_DATE', 'Ngày làm việc không hợp lệ');
  if (workDate <= localDate()) return fail('HISTORICAL_SCHEDULE_LOCKED', 'Lịch trong hôm nay và quá khứ chỉ được xem; hãy điều chỉnh từ ngày mai');
  if (!SCHEDULE_KINDS.has(scheduleKind)) return fail('INVALID_SCHEDULE_KIND', 'Trạng thái ngày làm việc không hợp lệ');
  if (!overrideReason || overrideReason.length > 512) return fail('OVERRIDE_REASON_REQUIRED', 'Phải nhập lý do xếp hoặc điều chỉnh lịch');

  const employee = await workforceRepo.getEmployeeScopeRecord(client, { installationId, employeeId, lock: 'share' });
  if (!employee) return fail('EMPLOYEE_NOT_FOUND', 'Không tìm thấy nhân sự');
  if (!employee.is_active) return fail('EMPLOYEE_INACTIVE', 'Nhân sự đã ngừng làm việc');

  let workPolicyId = text(payload?.workPolicyId) || null;
  let policy = null;
  if (workPolicyId) {
    if (!validUuid(workPolicyId)) return fail('POLICY_NOT_FOUND', 'Không tìm thấy chính sách làm việc');
    policy = await workforceRepo.getWorkPolicyById(client, { installationId, id: workPolicyId });
  } else {
    const assignment = await workforceRepo.getEffectiveEmployeePolicyAssignment(client, {
      installationId, employeeId, workDate,
    });
    workPolicyId = assignment?.work_policy_id ?? null;
    if (workPolicyId) policy = await workforceRepo.getWorkPolicyById(client, { installationId, id: workPolicyId });
  }
  if (!policy || !policy.is_active || String(policy.effective_from) > workDate || (policy.effective_to && String(policy.effective_to) < workDate)) {
    return fail('WORK_POLICY_REQUIRED', 'Nhân sự chưa có chính sách làm việc phù hợp cho ngày đã chọn');
  }

  let scheduledStartAt = null;
  let scheduledEndAt = null;
  if (scheduleKind === 'WORK') {
    scheduledStartAt = dateTime(payload?.scheduledStartAt);
    scheduledEndAt = dateTime(payload?.scheduledEndAt);
    if (!scheduledStartAt || !scheduledEndAt || scheduledEndAt <= scheduledStartAt) {
      return fail('INVALID_SCHEDULE_TIME', 'Giờ bắt đầu và kết thúc ca làm việc không hợp lệ');
    }
  }

  const existing = await workforceRepo.getWorkScheduleForEmployeeDateForUpdate(client, {
    installationId, employeeId, workDate,
  });
  if (existing) {
    if (!sameInstant(existing.updated_at, payload?.expectedUpdatedAt)) {
      return fail('SCHEDULE_CONFLICT', 'Lịch đã thay đổi ở nơi khác; hãy cập nhật dữ liệu và thử lại');
    }
    const schedule = await workforceRepo.updateWorkSchedule(client, {
      installationId, employeeId, workDate, workPolicyId, scheduleKind,
      scheduledStartAt, scheduledEndAt, overrideReason, actorId,
      expectedUpdatedAt: dateTime(payload.expectedUpdatedAt),
    });
    if (!schedule) return fail('SCHEDULE_CONFLICT', 'Lịch đã thay đổi ở nơi khác; hãy cập nhật dữ liệu và thử lại');
    return { ok: true, schedule, beforeSchedule: existing, employee, action: 'update' };
  }

  const schedule = await workforceRepo.insertWorkSchedule(client, {
    installationId, employeeId, workDate, workPolicyId, scheduleKind,
    scheduledStartAt, scheduledEndAt, overrideReason, actorId,
  });
  return { ok: true, schedule, beforeSchedule: null, employee, action: 'create' };
}

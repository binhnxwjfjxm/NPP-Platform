import { createHash, randomBytes } from 'node:crypto';
import * as workforceRepo from '../db/repositories/workforce.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODE_PATTERN = /^[A-Z0-9_-]{1,64}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;
const POLICY_TIME_MODES = new Set(['FIXED', 'SHIFT', 'FLEXIBLE', 'NO_ATTENDANCE']);
const ATTENDANCE_METHODS = new Set(['QR', 'MANUAL', 'BOTH', 'FACE', 'QR_FACE', 'NONE']);
const ATTENDANCE_BASES = new Set(['TIME', 'PRESENCE', 'NONE']);
const TEMP_EXIT_REASONS = new Set(['WORK_BUSINESS', 'PERSONAL', 'BREAK', 'OTHER']);
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
export function effectiveDateOnly(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') {
    const prefix = value.trim().slice(0, 10);
    if (validDate(prefix)) return prefix;
  }
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: INSTALLATION_TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(parsed).map((part) => [part.type, part.value]));
  const normalized = `${parts.year}-${parts.month}-${parts.day}`;
  return validDate(normalized) ? normalized : null;
}
function withEffectiveDates(record) {
  if (!record) return record;
  return {
    ...record,
    effective_from: effectiveDateOnly(record.effective_from),
    effective_to: record.effective_to ? effectiveDateOnly(record.effective_to) : null,
  };
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
  const attendanceBasis = (text(payload.attendanceBasis) || (timeMode === 'NO_ATTENDANCE' ? 'NONE' : 'TIME')).toUpperCase();
  if (!ATTENDANCE_BASES.has(attendanceBasis)) return fail('INVALID_ATTENDANCE_BASIS', 'Cách ghi nhận công không hợp lệ');
  if (timeMode === 'NO_ATTENDANCE' && (attendanceMethod !== 'NONE' || attendanceBasis !== 'NONE')) {
    return fail('ATTENDANCE_METHOD_CONFLICT', 'Chính sách không bắt buộc chấm công phải dùng phương thức và cách ghi nhận Không chấm công');
  }
  if ((attendanceBasis === 'NONE') !== (attendanceMethod === 'NONE')) {
    return fail('ATTENDANCE_METHOD_CONFLICT', 'Phương thức chấm công và cách ghi nhận công đang mâu thuẫn');
  }
  const timezone = text(payload.timezone) || INSTALLATION_TIMEZONE;
  if (timezone.length > 64) return fail('INVALID_TIMEZONE', 'Múi giờ không hợp lệ');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
  } catch {
    return fail('INVALID_TIMEZONE', 'Múi giờ không hợp lệ');
  }
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
      attendanceMethod, attendanceBasis, timezone, roundingMinutes,
      minimumFullDayMinutes, minimumHalfDayMinutes,
      effectiveFrom, effectiveTo,
    },
  };
}

export async function listWorkPolicies(client, { installationId }) {
  const policies = await workforceRepo.listWorkPolicies(client, { installationId });
  return { ok: true, policies: policies.map(withEffectiveDates) };
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
  const latestEffectiveFrom = latest ? effectiveDateOnly(latest.effective_from) : null;
  const latestEffectiveTo = latest?.effective_to ? effectiveDateOnly(latest.effective_to) : null;
  if (latest && (!latestEffectiveFrom || validation.normalized.effectiveFrom <= latestEffectiveFrom)) {
    return fail('POLICY_EFFECTIVE_DATE_CONFLICT', 'Phiên bản mới phải có ngày hiệu lực sau phiên bản hiện tại');
  }

  if (latest && (!latest.effective_to || !latestEffectiveTo || latestEffectiveTo >= validation.normalized.effectiveFrom)) {
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
  return {
    ok: true,
    policy: withEffectiveDates(policy),
    beforePolicy: withEffectiveDates(latest),
    action: latest ? 'version' : 'create',
  };
}

export async function getEmployeeScopeRecord(client, { installationId, employeeId }) {
  if (!validUuid(employeeId)) return fail('EMPLOYEE_NOT_FOUND', 'Không tìm thấy nhân sự');
  const employee = await workforceRepo.getEmployeeScopeRecord(client, { installationId, employeeId, lock: 'update' });
  return employee ? { ok: true, employee } : fail('EMPLOYEE_NOT_FOUND', 'Không tìm thấy nhân sự');
}

export async function listEmployeePolicyAssignments(client, { installationId, employeeId }) {
  if (!validUuid(employeeId)) return fail('EMPLOYEE_NOT_FOUND', 'Không tìm thấy nhân sự');
  const assignments = await workforceRepo.listEmployeePolicyAssignments(client, { installationId, employeeId });
  return {
    ok: true,
    assignments: assignments.map(withEffectiveDates),
  };
}

async function preparePolicyAssignment(client, {
  installationId,
  employee,
  workPolicyId,
  effectiveFrom,
  reason,
  bootstrap,
}) {
  const today = localDate();
  if (!validUuid(workPolicyId)) return fail('POLICY_NOT_FOUND', 'Không tìm thấy chính sách làm việc');
  if (!validDate(effectiveFrom)) return fail('INVALID_EFFECTIVE_DATE', 'Ngày bắt đầu áp dụng không hợp lệ');
  if (reason && reason.length > 512) return fail('INVALID_REASON', 'Lý do tối đa 512 ký tự');
  if (effectiveFrom < today && !bootstrap) {
    return fail('RETROACTIVE_ASSIGNMENT_FORBIDDEN', 'Ngày đã qua chỉ được dùng trong khởi tạo chính sách ban đầu có kiểm soát');
  }
  if (effectiveFrom < today && bootstrap && !reason) {
    return fail('BOOTSTRAP_REASON_REQUIRED', 'Khởi tạo chính sách cho giai đoạn trước phải có lý do');
  }

  const policy = await workforceRepo.getWorkPolicyById(client, { installationId, id: workPolicyId });
  if (!policy || !policy.is_active) return fail('POLICY_NOT_FOUND', 'Không tìm thấy chính sách làm việc đang hiệu lực');
  const policyEffectiveFrom = effectiveDateOnly(policy.effective_from);
  const policyEffectiveTo = policy.effective_to ? effectiveDateOnly(policy.effective_to) : null;
  if (
    !policyEffectiveFrom
    || policyEffectiveFrom > effectiveFrom
    || (policy.effective_to && (!policyEffectiveTo || policyEffectiveTo < effectiveFrom))
  ) {
    return fail(
      'POLICY_NOT_EFFECTIVE',
      effectiveFrom < today
        ? 'Ngày khởi tạo sớm hơn thời gian hiệu lực của chính sách; hãy chọn ngày nằm trong thời gian hiệu lực'
        : 'Chính sách không có hiệu lực tại ngày bắt đầu đã chọn',
    );
  }

  const latest = await workforceRepo.getLatestEmployeePolicyAssignmentForUpdate(client, {
    installationId,
    employeeId: employee.id,
  });
  if (effectiveFrom < today && bootstrap && latest) {
    return fail('BOOTSTRAP_ASSIGNMENT_EXISTS', `${employee.code} đã có lịch sử chính sách; không được dùng khởi tạo lùi ngày`);
  }
  const latestAssignmentFrom = latest ? effectiveDateOnly(latest.effective_from) : null;
  if (latest && (!latestAssignmentFrom || effectiveFrom <= latestAssignmentFrom)) {
    return fail('ASSIGNMENT_EFFECTIVE_DATE_CONFLICT', `Ngày áp dụng của ${employee.code} phải sau lần gán chính sách gần nhất`);
  }
  return { ok: true, policy, latest };
}

async function applyPreparedPolicyAssignment(client, {
  installationId,
  employee,
  workPolicyId,
  effectiveFrom,
  reason,
  actorId,
  prepared,
}) {
  const latestEffectiveTo = prepared.latest?.effective_to
    ? effectiveDateOnly(prepared.latest.effective_to)
    : null;
  if (prepared.latest && (!prepared.latest.effective_to || !latestEffectiveTo || latestEffectiveTo >= effectiveFrom)) {
    await workforceRepo.closeEmployeePolicyAssignment(client, {
      installationId,
      id: prepared.latest.id,
      effectiveTo: previousDate(effectiveFrom),
    });
  }
  const assignment = await workforceRepo.insertEmployeePolicyAssignment(client, {
    installationId,
    employeeId: employee.id,
    workPolicyId,
    effectiveFrom,
    reason,
    createdBy: actorId,
  });
  return {
    assignment: withEffectiveDates(assignment),
    beforeAssignment: withEffectiveDates(prepared.latest ?? null),
  };
}

export async function listWorkPolicyCoverage(client, {
  installationId,
  workDate,
  branchId = null,
  branchIds = null,
}) {
  const date = text(workDate) || localDate();
  if (!validDate(date)) return fail('INVALID_EFFECTIVE_DATE', 'Ngày kiểm tra chính sách không hợp lệ');
  if (branchId && !validUuid(branchId)) return fail('INVALID_BRANCH_ID', 'Chi nhánh không hợp lệ');
  const rows = await workforceRepo.listEmployeePolicyCoverage(client, {
    installationId,
    workDate: date,
    branchId,
    branchIds,
  });
  const employees = rows.map((row) => ({
    id: row.employee_id,
    code: row.employee_code,
    name: row.employee_name,
    branchId: row.employee_branch_id ?? null,
    branchCode: row.branch_code ?? null,
    branchName: row.branch_name ?? null,
    assignment: row.assignment_id ? {
      id: row.assignment_id,
      workPolicyId: row.work_policy_id,
      effectiveFrom: effectiveDateOnly(row.effective_from),
      effectiveTo: row.effective_to ? effectiveDateOnly(row.effective_to) : null,
      policyCode: row.policy_code,
      policyVersion: Number(row.policy_version),
      policyName: row.policy_name,
    } : null,
  }));
  const missing = employees.filter((employee) => !employee.assignment);
  return {
    ok: true,
    coverage: {
      asOfDate: date,
      totalActive: employees.length,
      assignedCount: employees.length - missing.length,
      missingCount: missing.length,
      employees,
    },
  };
}

export async function assignWorkPolicy(client, { installationId, payload, actorId }) {
  const employeeId = text(payload?.employeeId);
  const workPolicyId = text(payload?.workPolicyId);
  const effectiveFrom = text(payload?.effectiveFrom);
  const reason = text(payload?.reason) || null;
  const bootstrap = payload?.bootstrap === true && effectiveFrom < localDate();
  if (!validUuid(employeeId)) return fail('EMPLOYEE_NOT_FOUND', 'Không tìm thấy nhân sự');

  const employee = await workforceRepo.getEmployeeScopeRecord(client, { installationId, employeeId, lock: 'share' });
  if (!employee) return fail('EMPLOYEE_NOT_FOUND', 'Không tìm thấy nhân sự');
  if (!employee.is_active) return fail('EMPLOYEE_INACTIVE', 'Nhân sự đã ngừng làm việc');

  const prepared = await preparePolicyAssignment(client, {
    installationId, employee, workPolicyId, effectiveFrom, reason, bootstrap,
  });
  if (!prepared.ok) return prepared;
  const applied = await applyPreparedPolicyAssignment(client, {
    installationId, employee, workPolicyId, effectiveFrom, reason, actorId, prepared,
  });
  return { ok: true, ...applied, employee, bootstrap };
}

export async function assignWorkPolicyBulk(client, {
  installationId,
  payload,
  actorId,
  branchIds = null,
}) {
  const targetMode = text(payload?.targetMode).toUpperCase();
  const workPolicyId = text(payload?.workPolicyId);
  const effectiveFrom = text(payload?.effectiveFrom);
  const reason = text(payload?.reason) || null;
  const bootstrap = payload?.bootstrap === true && effectiveFrom < localDate();
  const branchId = text(payload?.branchId) || null;
  const employeeIds = Array.isArray(payload?.employeeIds)
    ? [...new Set(payload.employeeIds.map((value) => text(value)).filter(Boolean))]
    : [];

  if (!['ALL_ACTIVE', 'BRANCH', 'EMPLOYEES'].includes(targetMode)) {
    return fail('INVALID_ASSIGNMENT_TARGET', 'Phạm vi áp dụng chính sách không hợp lệ');
  }
  if (targetMode === 'BRANCH' && !validUuid(branchId)) return fail('INVALID_BRANCH_ID', 'Phải chọn chi nhánh hợp lệ');
  if (targetMode === 'EMPLOYEES' && (!employeeIds.length || employeeIds.length > 1000 || employeeIds.some((id) => !validUuid(id)))) {
    return fail('INVALID_EMPLOYEE_SELECTION', 'Danh sách nhân sự áp dụng không hợp lệ hoặc vượt quá 1.000 người');
  }
  if (Array.isArray(branchIds) && branchId && !branchIds.map(String).includes(branchId)) {
    return fail('SCOPE_FORBIDDEN', 'Chi nhánh nằm ngoài phạm vi được cấp');
  }

  const targets = await workforceRepo.listEmployeePolicyCoverage(client, {
    installationId,
    workDate: localDate(),
    branchId: targetMode === 'BRANCH' ? branchId : null,
    branchIds,
    employeeIds: targetMode === 'EMPLOYEES' ? employeeIds : null,
  });
  if (!targets.length) return fail('NO_EMPLOYEES_SELECTED', 'Không có nhân sự đang làm việc trong phạm vi đã chọn');
  if (targetMode === 'EMPLOYEES' && targets.length !== employeeIds.length) {
    return fail('SCOPE_FORBIDDEN', 'Một hoặc nhiều nhân sự không còn hoạt động hoặc nằm ngoài phạm vi được cấp');
  }

  const plans = [];
  for (const row of targets) {
    const employee = await workforceRepo.getEmployeeScopeRecord(client, {
      installationId,
      employeeId: row.employee_id,
      lock: 'update',
    });
    if (!employee || !employee.is_active) {
      return fail('EMPLOYEE_INACTIVE', `${row.employee_code} không còn ở trạng thái đang làm việc`);
    }
    const prepared = await preparePolicyAssignment(client, {
      installationId, employee, workPolicyId, effectiveFrom, reason, bootstrap,
    });
    if (!prepared.ok) return prepared;
    plans.push({ employee, prepared });
  }

  const assignments = [];
  for (const plan of plans) {
    const applied = await applyPreparedPolicyAssignment(client, {
      installationId,
      employee: plan.employee,
      workPolicyId,
      effectiveFrom,
      reason,
      actorId,
      prepared: plan.prepared,
    });
    assignments.push(applied.assignment);
  }
  return {
    ok: true,
    assignments,
    affectedCount: assignments.length,
    bootstrap,
    targetMode,
    workPolicyId,
    effectiveFrom,
    reason,
  };
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
  const policyEffectiveFrom = policy ? effectiveDateOnly(policy.effective_from) : null;
  const policyEffectiveTo = policy?.effective_to ? effectiveDateOnly(policy.effective_to) : null;
  if (
    !policy
    || !policy.is_active
    || !policyEffectiveFrom
    || policyEffectiveFrom > workDate
    || (policy.effective_to && (!policyEffectiveTo || policyEffectiveTo < workDate))
  ) {
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


const ATTENDANCE_QR_PREFIX = 'NPPATT.';
const ATTENDANCE_QR_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const ATTENDANCE_QR_TTL_MS = 120_000;
const ATTENDANCE_MIN_EVENT_GAP_MS = 60_000;

function nextDate(value) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function dayOfWeek(value) {
  return new Date(`${value}T00:00:00Z`).getUTCDay();
}

function localClockMinutes(timeZone, now) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(map.hour) * 60 + Number(map.minute);
}

function timeMinutes(value) {
  const match = /^(\d{2}):(\d{2})/.exec(String(value ?? ''));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function zonedLocalDateTimeToIso(dateValue, timeValue, timeZone) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
  const clock = /^(\d{2}):(\d{2})/.exec(String(timeValue ?? ''));
  if (!match || !clock) return null;
  const wanted = Date.UTC(
    Number(match[1]), Number(match[2]) - 1, Number(match[3]),
    Number(clock[1]), Number(clock[2]), 0,
  );
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
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
  if (secondOffset !== offset) {
    offset = secondOffset;
    utc = wanted - offset;
  }
  return new Date(utc).toISOString();
}

function attendanceEventWindow({ workDate, timeZone, expectedStartAt, expectedEndAt }) {
  const start = expectedStartAt
    ? new Date(new Date(expectedStartAt).getTime() - 12 * 60 * 60 * 1000).toISOString()
    : zonedLocalDateTimeToIso(workDate, '00:00', timeZone);
  const end = expectedEndAt
    ? new Date(new Date(expectedEndAt).getTime() + 12 * 60 * 60 * 1000).toISOString()
    : zonedLocalDateTimeToIso(nextDate(workDate), '00:00', timeZone);
  return { fromAt: start, toAt: end };
}

function attendanceState(events, now, attendanceBasis = 'TIME') {
  const validEvents = events.filter((event) => event.validation_status === 'VALID');
  const latest = validEvents.at(-1) ?? null;
  if (!latest) return { status: 'NOT_STARTED', nextAction: 'CHECK_IN', latestEvent: null, tooSoon: false };
  const elapsed = now.getTime() - new Date(latest.occurred_at).getTime();
  const tooSoon = elapsed >= 0 && elapsed < ATTENDANCE_MIN_EVENT_GAP_MS;
  if (latest.event_type === 'CHECK_IN' || latest.event_type === 'RETURN') {
    if (attendanceBasis === 'PRESENCE' && latest.event_type === 'CHECK_IN') {
      return { status: 'COMPLETE', nextAction: null, latestEvent: latest, tooSoon: false };
    }
    return { status: 'WORKING', nextAction: 'EXIT', latestEvent: latest, tooSoon };
  }
  if (latest.event_type === 'TEMP_EXIT') {
    return { status: 'OUTSIDE', nextAction: 'RETURN', latestEvent: latest, tooSoon };
  }
  return { status: 'COMPLETE', nextAction: null, latestEvent: latest, tooSoon: false };
}

function attendanceEventChoice(attendance, payload) {
  if (attendance.nextAction === 'CHECK_IN') {
    return { ok: true, eventType: 'CHECK_IN', movementReason: null, note: null };
  }
  if (attendance.nextAction === 'RETURN') {
    return { ok: true, eventType: 'RETURN', movementReason: null, note: 'Quay lại nơi làm việc' };
  }
  if (attendance.nextAction !== 'EXIT') {
    return fail('ATTENDANCE_ALREADY_COMPLETE', 'Ngày làm việc này đã kết thúc');
  }
  const exitReason = text(payload?.exitReason).toUpperCase();
  const note = text(payload?.note) || null;
  if (exitReason === 'END_WORK') {
    return { ok: true, eventType: 'CHECK_OUT', movementReason: null, note: note || 'Kết thúc làm việc' };
  }
  if (!TEMP_EXIT_REASONS.has(exitReason)) {
    return fail('EXIT_REASON_REQUIRED', 'Vui lòng chọn lý do rời nơi làm việc');
  }
  if (exitReason === 'OTHER' && !note) {
    return fail('EXIT_NOTE_REQUIRED', 'Lý do khác phải có ghi chú');
  }
  const labels = {
    WORK_BUSINESS: 'Ra ngoài làm công việc',
    PERSONAL: 'Ra ngoài việc cá nhân',
    BREAK: 'Nghỉ giữa ca',
    OTHER: 'Lý do khác',
  };
  return {
    ok: true,
    eventType: 'TEMP_EXIT',
    movementReason: exitReason,
    note: note || labels[exitReason],
  };
}

async function policyForDate(client, { installationId, employeeId, workDate }) {
  const assignment = await workforceRepo.getEffectiveEmployeePolicyAssignment(client, {
    installationId, employeeId, workDate,
  });
  if (!assignment) return null;
  const policy = await workforceRepo.getWorkPolicyById(client, {
    installationId, id: assignment.work_policy_id,
  });
  return policy ? { assignment, policy } : null;
}

async function resolveAttendanceContext(client, { installationId, employeeId, now = new Date() }) {
  const employee = await workforceRepo.getEmployeeScopeRecord(client, {
    installationId, employeeId, lock: 'share',
  });
  if (!employee || !employee.is_active) return fail('EMPLOYEE_NOT_FOUND', 'Không tìm thấy hồ sơ nhân sự đang hoạt động');

  const defaultToday = localDate(INSTALLATION_TIMEZONE, now);
  const yesterday = previousDate(defaultToday);
  const [todaySchedule, yesterdaySchedule] = await Promise.all([
    workforceRepo.getWorkScheduleForEmployeeDate(client, { installationId, employeeId, workDate: defaultToday }),
    workforceRepo.getWorkScheduleForEmployeeDate(client, { installationId, employeeId, workDate: yesterday }),
  ]);

  let workDate = defaultToday;
  let schedule = todaySchedule ?? null;
  if (yesterdaySchedule?.schedule_kind === 'WORK' && yesterdaySchedule.scheduled_end_at) {
    const end = new Date(yesterdaySchedule.scheduled_end_at).getTime();
    const start = new Date(yesterdaySchedule.scheduled_start_at).getTime();
    const current = now.getTime();
    if (current >= start && current <= end + 4 * 60 * 60 * 1000) {
      workDate = yesterday;
      schedule = yesterdaySchedule;
    }
  }

  let policyBundle = await policyForDate(client, { installationId, employeeId, workDate });
  if (!schedule && workDate === defaultToday) {
    const yesterdayPolicy = await policyForDate(client, { installationId, employeeId, workDate: yesterday });
    if (yesterdayPolicy?.policy?.time_mode === 'FIXED') {
      const startMinutes = timeMinutes(yesterdayPolicy.policy.fixed_start_time);
      const endMinutes = timeMinutes(yesterdayPolicy.policy.fixed_end_time);
      if (startMinutes !== null && endMinutes !== null && endMinutes <= startMinutes) {
        try {
          const nowMinutes = localClockMinutes(yesterdayPolicy.policy.timezone || INSTALLATION_TIMEZONE, now);
          if (nowMinutes <= endMinutes) {
            workDate = yesterday;
            policyBundle = yesterdayPolicy;
          }
        } catch {
          return fail('INVALID_POLICY_TIMEZONE', 'Múi giờ của chính sách làm việc không hợp lệ');
        }
      }
    }
  }

  if (!policyBundle && schedule?.work_policy_id) {
    const policy = await workforceRepo.getWorkPolicyById(client, {
      installationId, id: schedule.work_policy_id,
    });
    if (policy) policyBundle = { assignment: null, policy };
  }
  if (!policyBundle) return fail('WORK_POLICY_REQUIRED', 'Nhân sự chưa có chính sách làm việc phù hợp cho ngày chấm công');

  const policy = policyBundle.policy;
  if (policy.time_mode === 'NO_ATTENDANCE') {
    return fail('ATTENDANCE_NOT_REQUIRED', 'Chính sách làm việc hiện tại không yêu cầu chấm công');
  }
  if (schedule?.schedule_kind === 'OFF') {
    return fail('WORK_DAY_OFF', 'Hôm nay là ngày nghỉ theo lịch làm việc');
  }
  if (!schedule && policy.time_mode === 'SHIFT') {
    return fail('WORK_SCHEDULE_REQUIRED', 'Nhân sự làm theo ca nhưng chưa có lịch làm việc cho ngày này');
  }
  if (!schedule && !Array.isArray(policy.working_days)) {
    return fail('WORK_POLICY_INVALID', 'Chính sách làm việc chưa có ngày làm việc hợp lệ');
  }
  if (!schedule && !policy.working_days.map(Number).includes(dayOfWeek(workDate))) {
    return fail('WORK_DAY_OFF', 'Hôm nay không nằm trong ngày làm việc của chính sách');
  }

  const timeZone = policy.timezone || INSTALLATION_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(now);
  } catch {
    return fail('INVALID_POLICY_TIMEZONE', 'Múi giờ của chính sách làm việc không hợp lệ');
  }
  let expectedStartAt = schedule?.scheduled_start_at ? new Date(schedule.scheduled_start_at).toISOString() : null;
  let expectedEndAt = schedule?.scheduled_end_at ? new Date(schedule.scheduled_end_at).toISOString() : null;
  if (!schedule && policy.time_mode === 'FIXED') {
    try {
      expectedStartAt = zonedLocalDateTimeToIso(workDate, policy.fixed_start_time, timeZone);
      const startMinutes = timeMinutes(policy.fixed_start_time);
      const endMinutes = timeMinutes(policy.fixed_end_time);
      const endDate = startMinutes !== null && endMinutes !== null && endMinutes <= startMinutes
        ? nextDate(workDate)
        : workDate;
      expectedEndAt = zonedLocalDateTimeToIso(endDate, policy.fixed_end_time, timeZone);
    } catch {
      return fail('INVALID_POLICY_TIMEZONE', 'Múi giờ của chính sách làm việc không hợp lệ');
    }
  }

  const window = attendanceEventWindow({ workDate, timeZone, expectedStartAt, expectedEndAt });
  if (!window.fromAt || !window.toAt) return fail('ATTENDANCE_WINDOW_INVALID', 'Không xác định được ngày chấm công');
  const events = await workforceRepo.listAttendanceEventsForRange(client, {
    installationId, employeeId, ...window,
  });
  const state = attendanceState(events, now, policy.attendance_basis);

  return {
    ok: true,
    context: {
      employee,
      workDate,
      policy,
      schedule,
      expectedStartAt,
      expectedEndAt,
      timeZone,
      events,
      ...state,
    },
  };
}

export function parseAttendanceQrPayload(value) {
  const raw = text(value);
  if (!raw.startsWith(ATTENDANCE_QR_PREFIX)) return null;
  const token = raw.slice(ATTENDANCE_QR_PREFIX.length);
  return ATTENDANCE_QR_TOKEN_PATTERN.test(token) ? token : null;
}

export function hashAttendanceQrToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function attendancePointCode(branch) {
  const branchCode = text(branch?.code).toUpperCase();
  const branchKey = text(branch?.id).replace(/-/g, '').toUpperCase();
  return `WORK_${branchCode.slice(0, 26)}_${branchKey}`;
}

export async function listAttendancePointManagement(client, { installationId, branchIds = null }) {
  const [points, branches] = await Promise.all([
    workforceRepo.listAttendancePoints(client, { installationId, branchIds }),
    workforceRepo.listAttendanceBranches(client, { installationId, branchIds }),
  ]);
  return { ok: true, points, branches };
}

export async function createAttendancePoint(client, { installationId, payload, actorId }) {
  const branchId = text(payload?.branchId);
  if (!validUuid(branchId)) return fail('WORKPLACE_REQUIRED', 'Vui lòng chọn nơi làm việc');

  const branch = await workforceRepo.getAttendanceBranchById(client, { installationId, id: branchId });
  if (!branch || !branch.is_active) return fail('BRANCH_NOT_FOUND', 'Không tìm thấy nơi làm việc đang hoạt động');

  const existing = await workforceRepo.getActiveAttendancePointByBranchId(client, { installationId, branchId });
  if (existing) return { ok: true, point: existing, reused: true };

  const point = await workforceRepo.insertAttendancePoint(client, {
    installationId,
    code: attendancePointCode(branch),
    name: branch.name,
    branchId,
    actorId,
  });
  if (!point) return fail('ATTENDANCE_POINT_CREATE_FAILED', 'Không thiết lập được mã QR cho nơi làm việc này');
  return { ok: true, point, reused: false };
}

export async function createAttendanceQrToken(client, { installationId, attendancePointId, actorId, now = new Date() }) {
  if (!validUuid(attendancePointId)) return fail('ATTENDANCE_POINT_NOT_FOUND', 'Không tìm thấy nơi chấm công');
  const point = await workforceRepo.getAttendancePointById(client, { installationId, id: attendancePointId });
  if (!point || !point.is_active || !point.branch_id) return fail('ATTENDANCE_POINT_NOT_FOUND', 'Không tìm thấy nơi chấm công đang hoạt động');

  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashAttendanceQrToken(token);
  const expiresAt = new Date(now.getTime() + ATTENDANCE_QR_TTL_MS).toISOString();
  await workforceRepo.pruneExpiredAttendanceQrTokens(client, { installationId });
  const row = await workforceRepo.insertAttendanceQrToken(client, {
    installationId,
    attendancePointId,
    tokenHash,
    expiresAt,
    actorId,
  });
  if (!row) return fail('QR_TOKEN_CREATE_FAILED', 'Không phát được mã QR chấm công');
  return {
    ok: true,
    token: {
      id: row.id,
      attendancePointId,
      pointCode: point.code,
      pointName: point.branch_name ?? point.name,
      branchName: point.branch_name ?? null,
      qrPayload: `${ATTENDANCE_QR_PREFIX}${token}`,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    },
    auditToken: {
      id: row.id,
      attendancePointId,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    },
    point,
  };
}

export async function getAttendanceToday(client, { installationId, employeeId, now = new Date() }) {
  if (!validUuid(employeeId)) return fail('EMPLOYEE_ID_REQUIRED', 'Tài khoản chưa liên kết hồ sơ nhân sự để chấm công');
  const resolved = await resolveAttendanceContext(client, { installationId, employeeId, now });
  if (!resolved.ok) return resolved;
  const value = resolved.context;
  return {
    ok: true,
    today: {
      workDate: value.workDate,
      status: value.status,
      nextAction: value.nextAction,
      tooSoon: Boolean(value.tooSoon),
      employee: value.employee,
      policy: {
        id: value.policy.id,
        code: value.policy.code,
        version: value.policy.version,
        name: value.policy.name,
        timeMode: value.policy.time_mode,
        attendanceMethod: value.policy.attendance_method,
        attendanceBasis: value.policy.attendance_basis,
        timezone: value.timeZone,
      },
      schedule: value.schedule ? {
        id: value.schedule.id,
        kind: value.schedule.schedule_kind,
        source: value.schedule.source,
      } : null,
      expectedStartAt: value.expectedStartAt,
      expectedEndAt: value.expectedEndAt,
      events: value.events,
    },
  };
}

export async function recordQrAttendance(client, {
  installationId,
  employeeId,
  payload,
  actorId,
  requestId,
  now = new Date(),
}) {
  if (!validUuid(employeeId)) return fail('EMPLOYEE_ID_REQUIRED', 'Tài khoản chưa liên kết hồ sơ nhân sự để chấm công');
  const token = parseAttendanceQrPayload(payload?.qrPayload);
  if (!token) return fail('QR_TOKEN_INVALID', 'Mã QR chấm công không hợp lệ');
  const tokenRow = await workforceRepo.getAttendanceQrTokenByHash(client, {
    installationId,
    tokenHash: hashAttendanceQrToken(token),
  });
  if (!tokenRow) return fail('QR_TOKEN_INVALID', 'Mã QR chấm công không hợp lệ');
  if (!tokenRow.point_active) return fail('ATTENDANCE_POINT_INACTIVE', 'Điểm chấm công hiện không hoạt động');
  if (new Date(tokenRow.expires_at).getTime() <= now.getTime()) {
    return fail('QR_TOKEN_EXPIRED', 'Mã QR đã hết hạn; vui lòng quét mã đang hiển thị tại nơi làm việc');
  }

  const resolved = await resolveAttendanceContext(client, { installationId, employeeId, now });
  if (!resolved.ok) return resolved;
  const attendance = resolved.context;
  if (!['QR', 'BOTH', 'QR_FACE'].includes(attendance.policy.attendance_method)) {
    return fail('QR_ATTENDANCE_NOT_ALLOWED', 'Chính sách làm việc hiện tại không cho phép chấm công bằng QR');
  }
  if (!attendance.nextAction) return fail('ATTENDANCE_ALREADY_COMPLETE', 'Ngày làm việc này đã kết thúc');
  if (attendance.tooSoon) return fail('ATTENDANCE_TOO_SOON', 'Vừa ghi nhận chấm công; vui lòng đợi một phút trước thao tác tiếp theo');

  const employeeBranchId = attendance.employee.branch_id ? String(attendance.employee.branch_id) : null;
  const pointBranchId = tokenRow.branch_id ? String(tokenRow.branch_id) : null;
  if (!employeeBranchId) {
    return fail('EMPLOYEE_WORKPLACE_REQUIRED', 'Hồ sơ nhân sự chưa có nơi làm việc; vui lòng liên hệ quản lý');
  }
  if (!pointBranchId || pointBranchId !== employeeBranchId) {
    return fail('ATTENDANCE_WORKPLACE_MISMATCH', 'Mã QR này không thuộc nơi làm việc đã gắn cho bạn');
  }

  const choice = attendanceEventChoice(attendance, payload);
  if (!choice.ok) return choice;
  const sourceReference = createHash('sha256')
    .update(`attendance-qr|${tokenRow.id}|${employeeId}|${attendance.latestEvent?.id ?? 'START'}|${choice.eventType}|${choice.movementReason ?? 'NONE'}`)
    .digest('hex');
  const event = await workforceRepo.insertAttendanceEvent(client, {
    installationId,
    employeeId,
    scheduleId: attendance.schedule?.id ?? null,
    workPolicyId: attendance.policy.id,
    attendancePointId: tokenRow.attendance_point_id,
    eventType: choice.eventType,
    movementReason: choice.movementReason,
    occurredAt: now.toISOString(),
    source: 'QR',
    sourceReference,
    note: choice.note,
    actorId,
    requestId,
  });
  if (!event) return fail('ATTENDANCE_DUPLICATE_SCAN', 'Lần quét này đã được ghi nhận trước đó');

  return {
    ok: true,
    event: {
      ...event,
      point_code: tokenRow.point_code,
      point_name: tokenRow.branch_name ?? tokenRow.point_name,
    },
    workDate: attendance.workDate,
    point: {
      id: tokenRow.attendance_point_id,
      code: tokenRow.point_code,
      name: tokenRow.branch_name ?? tokenRow.point_name,
      branchId: tokenRow.branch_id,
      branchName: tokenRow.branch_name,
    },
  };
}

export async function recordManualAttendance(client, {
  installationId,
  employeeId,
  payload,
  actorId,
  requestId,
  now = new Date(),
}) {
  if (!validUuid(employeeId)) return fail('EMPLOYEE_ID_REQUIRED', 'Tài khoản chưa liên kết hồ sơ nhân sự để chấm công');
  const resolved = await resolveAttendanceContext(client, { installationId, employeeId, now });
  if (!resolved.ok) return resolved;
  const attendance = resolved.context;
  if (!['MANUAL', 'BOTH'].includes(attendance.policy.attendance_method)) {
    return fail('MANUAL_ATTENDANCE_NOT_ALLOWED', 'Chính sách làm việc hiện tại không cho phép chấm công trực tiếp');
  }
  if (!attendance.nextAction) return fail('ATTENDANCE_ALREADY_COMPLETE', 'Ngày làm việc này đã kết thúc');
  if (attendance.tooSoon) return fail('ATTENDANCE_TOO_SOON', 'Vừa ghi nhận chấm công; vui lòng đợi một phút trước thao tác tiếp theo');

  const choice = attendanceEventChoice(attendance, payload);
  if (!choice.ok) return choice;
  const sourceReference = createHash('sha256')
    .update(`attendance-manual|${employeeId}|${attendance.workDate}|${attendance.latestEvent?.id ?? 'START'}|${choice.eventType}|${choice.movementReason ?? 'NONE'}`)
    .digest('hex');
  const event = await workforceRepo.insertAttendanceEvent(client, {
    installationId,
    employeeId,
    scheduleId: attendance.schedule?.id ?? null,
    workPolicyId: attendance.policy.id,
    attendancePointId: null,
    eventType: choice.eventType,
    movementReason: choice.movementReason,
    occurredAt: now.toISOString(),
    source: 'MANUAL',
    sourceReference,
    note: choice.note || 'Nhân viên chấm công trực tiếp theo chính sách làm việc',
    actorId,
    requestId,
  });
  if (!event) return fail('ATTENDANCE_DUPLICATE_SCAN', 'Lần chấm công này đã được ghi nhận trước đó');

  return {
    ok: true,
    event,
    workDate: attendance.workDate,
    point: null,
  };
}


export async function recordFaceAttendance(client, {
  installationId,
  employeeId,
  payload,
  actorId,
  requestId,
  device,
  now = new Date(),
}) {
  if (!validUuid(employeeId)) return fail('EMPLOYEE_ID_REQUIRED', 'Không tìm thấy hồ sơ nhân sự để chấm công');
  if (!device?.id || !device?.branch_id || !device?.attendance_point_id) {
    return fail('FACE_DEVICE_UNAUTHORIZED', 'Thiết bị chấm công chưa được xác thực');
  }

  const resolved = await resolveAttendanceContext(client, { installationId, employeeId, now });
  if (!resolved.ok) return resolved;
  const attendance = resolved.context;
  if (!['FACE', 'QR_FACE'].includes(attendance.policy.attendance_method)) {
    return fail('FACE_ATTENDANCE_NOT_ALLOWED', 'Chính sách làm việc hiện tại không cho phép chấm công bằng khuôn mặt');
  }
  if (!attendance.nextAction) return fail('ATTENDANCE_ALREADY_COMPLETE', 'Ngày làm việc này đã kết thúc');
  if (attendance.tooSoon) return fail('ATTENDANCE_TOO_SOON', 'Vừa ghi nhận chấm công; vui lòng đợi một phút trước thao tác tiếp theo');

  const employeeBranchId = attendance.employee.branch_id ? String(attendance.employee.branch_id) : null;
  const deviceBranchId = device.branch_id ? String(device.branch_id) : null;
  if (!employeeBranchId) {
    return fail('EMPLOYEE_WORKPLACE_REQUIRED', 'Hồ sơ nhân sự chưa có nơi làm việc; vui lòng liên hệ quản lý');
  }
  if (!deviceBranchId || deviceBranchId !== employeeBranchId) {
    return fail('ATTENDANCE_WORKPLACE_MISMATCH', 'Thiết bị này không thuộc nơi làm việc đã gắn cho nhân sự');
  }

  const choice = attendanceEventChoice(attendance, payload);
  if (!choice.ok) return choice;
  const sourceReference = createHash('sha256')
    .update(`attendance-face|${device.id}|${employeeId}|${attendance.workDate}|${attendance.latestEvent?.id ?? 'START'}|${choice.eventType}|${choice.movementReason ?? 'NONE'}`)
    .digest('hex');
  const event = await workforceRepo.insertAttendanceEvent(client, {
    installationId,
    employeeId,
    scheduleId: attendance.schedule?.id ?? null,
    workPolicyId: attendance.policy.id,
    attendancePointId: device.attendance_point_id,
    eventType: choice.eventType,
    movementReason: choice.movementReason,
    occurredAt: now.toISOString(),
    source: 'FACE',
    sourceReference,
    note: choice.note,
    actorId,
    requestId,
  });
  if (!event) return fail('ATTENDANCE_DUPLICATE_SCAN', 'Lần điểm danh này đã được ghi nhận trước đó');

  return {
    ok: true,
    event,
    workDate: attendance.workDate,
    point: {
      id: device.attendance_point_id,
      code: device.point_code,
      name: device.branch_name ?? device.point_name,
      branchId: device.branch_id,
      branchName: device.branch_name ?? null,
    },
  };
}

export async function recordAttendance(client, options) {
  const method = text(options?.payload?.method || (options?.payload?.qrPayload ? 'QR' : '')).toUpperCase();
  if (method === 'QR') return recordQrAttendance(client, options);
  if (method === 'MANUAL') return recordManualAttendance(client, options);
  return fail('INVALID_ATTENDANCE_METHOD', 'Phương thức chấm công không hợp lệ');
}

import * as employeeRepo from '../db/repositories/employee.js';
import * as branchRepo from '../db/repositories/branch.js';
import * as workforceRepo from '../db/repositories/workforce.js';
import * as organizationRepo from '../db/repositories/employee-organization.js';
import { effectiveDateOnly } from './workforce.js';

const CODE_PATTERN = /^[A-Z0-9_-]{1,64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeCode(value) {
  return normalizeText(value).toUpperCase();
}

function normalizeOptionalUuid(value) {
  if (value === undefined || value === null || value === '') return null;
  return normalizeText(value);
}

function isValidUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value.trim());
}

function validateEmail(value) {
  return !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validatePhone(value) {
  return !value || /^[0-9\s\-+()]{5,20}$/.test(value);
}

function validDate(value) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function localDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function normalizeDateTime(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value.trim());
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function validateExpectedUpdatedAt(value) {
  if (value === undefined || value === null || value === '') {
    return { ok: false, code: 'MISSING_EXPECTED_UPDATED_AT', message: 'expectedUpdatedAt is required' };
  }
  const normalized = normalizeDateTime(value);
  if (!normalized) {
    return { ok: false, code: 'INVALID_EXPECTED_UPDATED_AT', message: 'expectedUpdatedAt must be a valid date-time' };
  }
  return { ok: true, value: normalized };
}

function conflictResult(message = 'Employee update conflict') {
  return { ok: false, code: 'CONFLICT', message, retryable: false };
}

export function validateEmployeeInput(payload, { codeRequired = true } = {}) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, code: 'INVALID_INPUT', message: 'Employee data is required' };
  }

  const code = normalizeCode(payload.code);
  if (codeRequired && !CODE_PATTERN.test(code)) {
    return { ok: false, code: 'INVALID_CODE', message: 'Code must contain only uppercase letters, digits, hyphens, or underscores' };
  }

  const fullName = normalizeText(payload.fullName);
  if (!fullName || fullName.length > 256) {
    return { ok: false, code: 'INVALID_FULL_NAME', message: 'Full name is required and must not exceed 256 characters' };
  }

  const jobTitle = normalizeText(payload.jobTitle);
  if (jobTitle.length > 128) {
    return { ok: false, code: 'INVALID_JOB_TITLE', message: 'Job title must not exceed 128 characters' };
  }

  const phone = normalizeText(payload.phone);
  if (!validatePhone(phone)) {
    return { ok: false, code: 'INVALID_PHONE', message: 'Phone number format is invalid' };
  }

  const email = normalizeText(payload.email).toLowerCase();
  if (email.length > 256 || !validateEmail(email)) {
    return { ok: false, code: 'INVALID_EMAIL', message: 'Email address format is invalid' };
  }

  const branchId = normalizeOptionalUuid(payload.branchId);
  if (branchId && !isValidUuid(branchId)) {
    return { ok: false, code: 'INVALID_BRANCH_ID', message: 'Branch ID must be a valid UUID' };
  }

  return {
    ok: true,
    normalized: {
      code,
      fullName,
      jobTitle: jobTitle || null,
      phone: phone || null,
      email: email || null,
      branchId,
    },
  };
}

const EMPLOYMENT_TYPES = new Set(['PROBATION', 'PERMANENT', 'FIXED_TERM', 'PART_TIME', 'TEMPORARY', 'OTHER']);

function previousDate(value) {
  const parsed = new Date(`${value}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  return parsed.toISOString().slice(0, 10);
}

function normalizeEmploymentType(value, fallback = 'OTHER') {
  const normalized = normalizeText(value).toUpperCase() || fallback;
  return EMPLOYMENT_TYPES.has(normalized) ? normalized : null;
}

async function employeeWithHistory(client, employee) {
  if (!employee) return employee;
  const [employmentHistory, assignmentHistory] = await Promise.all([
    employeeRepo.listEmployeeEmployments(client, { installationId: employee.installation_id, employeeId: employee.id }),
    employeeRepo.listEmployeeAssignments(client, { installationId: employee.installation_id, employeeId: employee.id }),
  ]);
  return {
    ...employee,
    employment_history: employmentHistory,
    assignment_history: assignmentHistory,
    current_employment: employmentHistory.find((item) => item.effective_to == null) ?? employmentHistory[0] ?? null,
    current_assignment: assignmentHistory.find((item) => item.effective_to == null) ?? assignmentHistory[0] ?? null,
  };
}
function assignmentIds(payload) {
  const departmentId = normalizeOptionalUuid(payload?.departmentId);
  const positionId = normalizeOptionalUuid(payload?.positionId);
  const managerEmployeeId = normalizeOptionalUuid(payload?.managerEmployeeId);
  if (departmentId && !isValidUuid(departmentId)) return { ok: false, code: 'INVALID_DEPARTMENT_ID', message: 'Phòng/Bộ phận không hợp lệ' };
  if (positionId && !isValidUuid(positionId)) return { ok: false, code: 'INVALID_POSITION_ID', message: 'Vị trí công việc không hợp lệ' };
  if (managerEmployeeId && !isValidUuid(managerEmployeeId)) return { ok: false, code: 'INVALID_MANAGER_EMPLOYEE_ID', message: 'Quản lý trực tiếp không hợp lệ' };
  return { ok: true, departmentId, positionId, managerEmployeeId };
}

async function resolveAssignmentReferences(client, {
  installationId, payload, effectiveDate, employeeId = null, requireActive = true,
}) {
  const ids = assignmentIds(payload);
  if (!ids.ok) return ids;

  const [department, position] = await Promise.all([
    ids.departmentId ? organizationRepo.getDepartmentById(client, { installationId, id: ids.departmentId }) : null,
    ids.positionId ? organizationRepo.getPositionById(client, { installationId, id: ids.positionId }) : null,
  ]);

  if (ids.departmentId && !department) return { ok: false, code: 'DEPARTMENT_NOT_FOUND', message: 'Không tìm thấy Phòng/Bộ phận' };
  if (ids.positionId && !position) return { ok: false, code: 'POSITION_NOT_FOUND', message: 'Không tìm thấy Vị trí công việc' };
  if (requireActive && department && !department.is_active) return { ok: false, code: 'DEPARTMENT_INACTIVE', message: 'Phòng/Bộ phận đang ngừng sử dụng' };
  if (requireActive && position && !position.is_active) return { ok: false, code: 'POSITION_INACTIVE', message: 'Vị trí công việc đang ngừng sử dụng' };
  if (position?.department_id && position.department_id !== ids.departmentId) {
    return { ok: false, code: 'POSITION_DEPARTMENT_MISMATCH', message: 'Vị trí công việc không thuộc Phòng/Bộ phận đã chọn' };
  }
  if (ids.managerEmployeeId && ids.managerEmployeeId === employeeId) {
    return { ok: false, code: 'MANAGER_SELF_REFERENCE', message: 'Nhân sự không thể là quản lý trực tiếp của chính mình' };
  }

  let manager = null;
  if (ids.managerEmployeeId) {
    manager = await employeeRepo.resolveEmployeeAtDate(client, {
      installationId,
      employeeId: ids.managerEmployeeId,
      businessDate: effectiveDate,
    });
    if (!manager) {
      return { ok: false, code: 'MANAGER_NOT_EFFECTIVE', message: 'Quản lý trực tiếp không thuộc lực lượng lao động tại ngày hiệu lực đã chọn' };
    }

    if (employeeId) {
      const visited = new Set();
      let cursor = manager;
      while (cursor) {
        if (cursor.id === employeeId || cursor.manager_employee_id === employeeId) {
          return { ok: false, code: 'MANAGER_HIERARCHY_CYCLE', message: 'Tuyến quản lý trực tiếp không được tạo vòng lặp' };
        }
        if (!cursor.manager_employee_id || visited.has(cursor.manager_employee_id)) break;
        visited.add(cursor.id);
        cursor = await employeeRepo.resolveEmployeeAtDate(client, {
          installationId,
          employeeId: cursor.manager_employee_id,
          businessDate: effectiveDate,
        });
      }
    }
  }

  return {
    ok: true,
    departmentId: ids.departmentId,
    positionId: ids.positionId,
    managerEmployeeId: ids.managerEmployeeId,
    department,
    position,
    manager,
  };
}

async function resolveBranch(client, { installationId, branchId, requireActive }) {
  if (!branchId) return { ok: true, branch: null };
  const branch = await branchRepo.getBranchByIdForInstallationForShare(client, { id: branchId, installationId });
  if (!branch) return { ok: false, code: 'BRANCH_NOT_FOUND', message: 'Assigned branch was not found' };
  if (requireActive && !branch.is_active) {
    return { ok: false, code: 'BRANCH_INACTIVE', message: 'Assigned branch is not active' };
  }
  return { ok: true, branch };
}

export async function createEmployee(client, { installationId, payload, createdBy }) {
  const validation = validateEmployeeInput(payload);
  if (!validation.ok) return validation;

  const today = localDate();
  const employmentStartDate = normalizeText(payload?.employmentStartDate) || today;
  const employmentType = normalizeEmploymentType(payload?.employmentType);
  if (!employmentType) return { ok: false, code: 'INVALID_EMPLOYMENT_TYPE', message: 'Hình thức lao động không hợp lệ' };
  if (!validDate(employmentStartDate) || employmentStartDate > today) {
    return { ok: false, code: 'INVALID_EMPLOYMENT_START_DATE', message: 'Ngày bắt đầu làm việc không hợp lệ' };
  }
  const assignmentEffectiveFrom = normalizeText(payload?.assignmentEffectiveFrom) || employmentStartDate;
  if (!validDate(assignmentEffectiveFrom) || assignmentEffectiveFrom < employmentStartDate || assignmentEffectiveFrom > today) {
    return { ok: false, code: 'INVALID_ASSIGNMENT_EFFECTIVE_DATE', message: 'Ngày bắt đầu đơn vị công tác không hợp lệ' };
  }

  const assignmentRefs = await resolveAssignmentReferences(client, {
    installationId,
    payload,
    effectiveDate: assignmentEffectiveFrom,
    requireActive: true,
  });
  if (!assignmentRefs.ok) return assignmentRefs;

  const workPolicyId = normalizeText(payload?.workPolicyId) || null;
  const policyEffectiveFrom = normalizeText(payload?.policyEffectiveFrom) || today;
  let policy = null;
  if (workPolicyId) {
    if (!isValidUuid(workPolicyId)) return { ok: false, code: 'POLICY_NOT_FOUND', message: 'Chính sách làm việc không hợp lệ' };
    if (!validDate(policyEffectiveFrom)) return { ok: false, code: 'INVALID_EFFECTIVE_DATE', message: 'Ngày áp dụng chính sách không hợp lệ' };
    if (policyEffectiveFrom < today) return { ok: false, code: 'RETROACTIVE_ASSIGNMENT_FORBIDDEN', message: 'Nhân sự mới không được gán chính sách lùi ngày' };
    policy = await workforceRepo.getWorkPolicyById(client, { installationId, id: workPolicyId });
    if (!policy || !policy.is_active) return { ok: false, code: 'POLICY_NOT_FOUND', message: 'Không tìm thấy chính sách làm việc đang hiệu lực' };
    const policyFrom = effectiveDateOnly(policy.effective_from);
    const policyTo = policy.effective_to ? effectiveDateOnly(policy.effective_to) : null;
    if (!policyFrom || policyFrom > policyEffectiveFrom || (policy.effective_to && (!policyTo || policyTo < policyEffectiveFrom))) {
      return { ok: false, code: 'POLICY_NOT_EFFECTIVE', message: 'Chính sách không có hiệu lực tại ngày bắt đầu đã chọn' };
    }
  }

  const existing = await employeeRepo.getEmployeeByCode(client, { installationId, code: validation.normalized.code });
  if (existing) return { ok: false, code: 'DUPLICATE_CODE', message: 'Mã nhân sự đã tồn tại' };
  const branchResult = await resolveBranch(client, { installationId, branchId: validation.normalized.branchId, requireActive: true });
  if (!branchResult.ok) return branchResult;

  const jobTitle = assignmentRefs.position?.name ?? validation.normalized.jobTitle;
  const employee = await employeeRepo.insertEmployee(client, {
    installationId, code: validation.normalized.code, fullName: validation.normalized.fullName,
    jobTitle, phone: validation.normalized.phone, email: validation.normalized.email,
    branchId: validation.normalized.branchId, createdBy,
  });
  if (!employee) return { ok: false, code: 'DUPLICATE_CODE', message: 'Mã nhân sự đã tồn tại' };

  await employeeRepo.insertEmployeeEmployment(client, {
    installationId, employeeId: employee.id, employmentType, effectiveFrom: employmentStartDate,
    dataQuality: 'CONFIRMED', source: 'HR', sourceReference: 'employee-create', createdBy,
  });
  await employeeRepo.insertEmployeeAssignment(client, {
    installationId,
    employeeId: employee.id,
    branchId: validation.normalized.branchId,
    departmentId: assignmentRefs.departmentId,
    positionId: assignmentRefs.positionId,
    managerEmployeeId: assignmentRefs.managerEmployeeId,
    effectiveFrom: assignmentEffectiveFrom,
    reason: normalizeText(payload?.assignmentReason) || 'Phân công khi tạo hồ sơ nhân sự',
    dataQuality: 'CONFIRMED', source: 'HR', sourceReference: 'employee-create', createdBy,
  });

  let policyAssignment = null;
  if (policy) {
    policyAssignment = await workforceRepo.insertEmployeePolicyAssignment(client, {
      installationId, employeeId: employee.id, workPolicyId: policy.id, effectiveFrom: policyEffectiveFrom,
      reason: 'Gán khi tạo hồ sơ nhân sự', createdBy,
    });
  }
  return { ok: true, employee: await employeeWithHistory(client, employee), policyAssignment };
}

export async function getEmployee(client, { installationId, id }) {
  if (!isValidUuid(id)) return { ok: false, code: 'NOT_FOUND', message: 'Employee not found' };
  const employee = await employeeRepo.getEmployeeByIdForInstallation(client, { id: id.trim(), installationId });
  return employee
    ? { ok: true, employee: await employeeWithHistory(client, employee) }
    : { ok: false, code: 'NOT_FOUND', message: 'Employee not found' };
}

export async function listEmployees(client, { installationId, active, branchId, limit, offset }) {
  if (branchId && !isValidUuid(branchId)) {
    return { ok: false, code: 'INVALID_BRANCH_ID', message: 'Branch ID must be a valid UUID' };
  }
  const rows = await employeeRepo.listEmployeesForInstallation(client, {
    installationId,
    active,
    branchId: branchId || null,
    limit,
    offset,
  });
  const employees = rows.map((row) => ({
    ...row,
    current_assignment: row.assignment_id ? {
      id: row.assignment_id,
      branch_id: row.branch_id,
      department_id: row.department_id,
      department_code: row.department_code,
      department_name: row.department_name,
      position_id: row.position_id,
      position_code: row.position_code,
      position_name: row.position_name,
      manager_employee_id: row.manager_employee_id,
      manager_code: row.manager_code,
      manager_name: row.manager_name,
      effective_from: row.assignment_effective_from,
      effective_to: row.assignment_effective_to,
    } : null,
  }));
  return { ok: true, employees };
}

export async function updateEmployee(client, { id, installationId, payload, updatedBy }) {
  if (!isValidUuid(id)) return { ok: false, code: 'INVALID_ID', message: 'Employee ID must be a valid UUID' };
  const existing = await employeeRepo.getEmployeeByIdForInstallationForUpdate(client, { id: id.trim(), installationId });
  if (!existing) return { ok: false, code: 'NOT_FOUND', message: 'Employee not found' };

  const validation = validateEmployeeInput({
    code: existing.code, fullName: payload?.fullName ?? existing.full_name,
    jobTitle: payload?.jobTitle ?? existing.job_title ?? '', phone: payload?.phone ?? existing.phone ?? '',
    email: payload?.email ?? existing.email ?? '',
    branchId: Object.prototype.hasOwnProperty.call(payload ?? {}, 'branchId') ? payload.branchId : existing.branch_id,
  });
  if (!validation.ok) return validation;
  const expected = validateExpectedUpdatedAt(payload?.expectedUpdatedAt);
  if (!expected.ok) return expected;
  if (normalizeDateTime(existing.updated_at) !== expected.value) return conflictResult();

  const today = localDate();
  const latestEmployment = await employeeRepo.getLatestEmployeeEmploymentForUpdate(client, { installationId, employeeId: existing.id });
  const latestAssignment = await employeeRepo.getLatestEmployeeAssignmentForUpdate(client, { installationId, employeeId: existing.id });
  const effectiveFrom = normalizeText(payload?.assignmentEffectiveFrom) || latestAssignment?.effective_from || today;
  const proposedIds = assignmentIds({
    departmentId: Object.prototype.hasOwnProperty.call(payload ?? {}, 'departmentId') ? payload.departmentId : latestAssignment?.department_id,
    positionId: Object.prototype.hasOwnProperty.call(payload ?? {}, 'positionId') ? payload.positionId : latestAssignment?.position_id,
    managerEmployeeId: Object.prototype.hasOwnProperty.call(payload ?? {}, 'managerEmployeeId') ? payload.managerEmployeeId : latestAssignment?.manager_employee_id,
  });
  if (!proposedIds.ok) return proposedIds;

  const branchChanged = validation.normalized.branchId !== existing.branch_id;
  const assignmentChanged = !latestAssignment
    || branchChanged
    || proposedIds.departmentId !== latestAssignment.department_id
    || proposedIds.positionId !== latestAssignment.position_id
    || proposedIds.managerEmployeeId !== latestAssignment.manager_employee_id;
  let assignmentRefs = {
    ok: true,
    departmentId: proposedIds.departmentId,
    positionId: proposedIds.positionId,
    managerEmployeeId: proposedIds.managerEmployeeId,
    position: latestAssignment?.position_id ? { name: latestAssignment.position_name } : null,
  };
  if (assignmentChanged || payload?.confirmAssignment === true) {
    assignmentRefs = await resolveAssignmentReferences(client, {
      installationId,
      payload: proposedIds,
      effectiveDate: effectiveFrom,
      employeeId: existing.id,
      requireActive: assignmentChanged,
    });
    if (!assignmentRefs.ok) return assignmentRefs;
  }

  const branchResult = await resolveBranch(client, { installationId, branchId: validation.normalized.branchId, requireActive: branchChanged });
  if (!branchResult.ok) return branchResult;

  if (payload?.confirmEmployment === true) {
    if (!latestEmployment) return { ok: false, code: 'EMPLOYMENT_HISTORY_REQUIRED', message: 'Chưa có lịch sử lao động để xác nhận' };
    const from = normalizeText(payload?.employmentEffectiveFrom);
    const to = normalizeText(payload?.employmentEffectiveTo) || null;
    const type = normalizeEmploymentType(payload?.employmentType, latestEmployment.employment_type);
    if (!type || !validDate(from) || (to && (!validDate(to) || to < from))) {
      return { ok: false, code: 'INVALID_EMPLOYMENT_PERIOD', message: 'Khoảng thời gian lao động không hợp lệ' };
    }
    const overlap = await employeeRepo.findEmploymentOverlap(client, {
      installationId, employeeId: existing.id, effectiveFrom: from, effectiveTo: to, excludeId: latestEmployment.id,
    });
    if (overlap) return { ok: false, code: 'EMPLOYMENT_PERIOD_CONFLICT', message: 'Khoảng thời gian lao động bị chồng với lịch sử hiện có' };
    await employeeRepo.updateEmployeeEmploymentPeriod(client, {
      installationId, id: latestEmployment.id, employmentType: type, effectiveFrom: from, effectiveTo: to,
      endReason: normalizeText(payload?.employmentEndReason) || null, dataQuality: 'CONFIRMED',
    });
  }

  if (assignmentChanged) {
    const reason = normalizeText(payload?.assignmentReason);
    if (!validDate(effectiveFrom) || effectiveFrom > today) return { ok: false, code: 'INVALID_ASSIGNMENT_EFFECTIVE_DATE', message: 'Ngày điều chuyển không hợp lệ' };
    if (!reason) return { ok: false, code: 'ASSIGNMENT_REASON_REQUIRED', message: 'Vui lòng nhập lý do thay đổi phân công' };
    if (latestEmployment && effectiveFrom < latestEmployment.effective_from) return { ok: false, code: 'ASSIGNMENT_EFFECTIVE_DATE_CONFLICT', message: 'Ngày điều chuyển không được trước ngày bắt đầu làm việc' };
    if (latestAssignment && effectiveFrom <= latestAssignment.effective_from) return { ok: false, code: 'ASSIGNMENT_EFFECTIVE_DATE_CONFLICT', message: 'Ngày điều chuyển phải sau lần phân công gần nhất' };
    if (latestAssignment?.effective_to == null) {
      await employeeRepo.updateEmployeeAssignmentPeriod(client, {
        installationId,
        id: latestAssignment.id,
        branchId: latestAssignment.branch_id,
        departmentId: latestAssignment.department_id,
        positionId: latestAssignment.position_id,
        managerEmployeeId: latestAssignment.manager_employee_id,
        effectiveFrom: latestAssignment.effective_from,
        effectiveTo: previousDate(effectiveFrom),
        reason: latestAssignment.reason,
        dataQuality: latestAssignment.data_quality,
      });
    }
    await employeeRepo.insertEmployeeAssignment(client, {
      installationId,
      employeeId: existing.id,
      branchId: validation.normalized.branchId,
      departmentId: assignmentRefs.departmentId,
      positionId: assignmentRefs.positionId,
      managerEmployeeId: assignmentRefs.managerEmployeeId,
      effectiveFrom,
      reason,
      dataQuality: 'CONFIRMED', source: 'HR', sourceReference: 'employee-transfer', createdBy: updatedBy,
    });
  } else if (payload?.confirmAssignment === true && latestAssignment) {
    if (!validDate(effectiveFrom) || effectiveFrom > today) return { ok: false, code: 'INVALID_ASSIGNMENT_EFFECTIVE_DATE', message: 'Ngày bắt đầu đơn vị công tác không hợp lệ' };
    const overlap = await employeeRepo.findAssignmentOverlap(client, {
      installationId, employeeId: existing.id, effectiveFrom, effectiveTo: latestAssignment.effective_to, excludeId: latestAssignment.id,
    });
    if (overlap) return { ok: false, code: 'ASSIGNMENT_PERIOD_CONFLICT', message: 'Khoảng phân công bị chồng với lịch sử hiện có' };
    await employeeRepo.updateEmployeeAssignmentPeriod(client, {
      installationId,
      id: latestAssignment.id,
      branchId: validation.normalized.branchId,
      departmentId: assignmentRefs.departmentId,
      positionId: assignmentRefs.positionId,
      managerEmployeeId: assignmentRefs.managerEmployeeId,
      effectiveFrom,
      effectiveTo: latestAssignment.effective_to,
      reason: normalizeText(payload?.assignmentReason) || latestAssignment.reason,
      dataQuality: 'CONFIRMED',
    });
  }

  const projectedJobTitle = assignmentRefs.position?.name ?? validation.normalized.jobTitle;
  const employee = await employeeRepo.updateEmployee(client, {
    id: existing.id, installationId, fullName: validation.normalized.fullName, jobTitle: projectedJobTitle,
    phone: validation.normalized.phone, email: validation.normalized.email, branchId: validation.normalized.branchId,
    updatedBy, expectedUpdatedAt: expected.value,
  });
  if (!employee) return conflictResult();
  return { ok: true, employee: await employeeWithHistory(client, employee), beforeData: existing, changed: true };
}

export async function updateEmployeeStatus(client, { id, installationId, isActive, updatedBy, expectedUpdatedAt, employmentEffectiveDate, employmentReason, employmentType }) {
  if (!isValidUuid(id)) return { ok: false, code: 'INVALID_ID', message: 'Employee ID must be a valid UUID' };
  if (typeof isActive !== 'boolean') return { ok: false, code: 'INVALID_ACTIVE_STATUS', message: 'isActive must be a boolean' };
  const existing = await employeeRepo.getEmployeeByIdForInstallationForUpdate(client, { id: id.trim(), installationId });
  if (!existing) return { ok: false, code: 'NOT_FOUND', message: 'Employee not found' };
  const expected = validateExpectedUpdatedAt(expectedUpdatedAt);
  if (!expected.ok) return expected;
  if (normalizeDateTime(existing.updated_at) !== expected.value) return conflictResult('Employee status update conflict');
  if (existing.is_active === isActive) return { ok: true, employee: await employeeWithHistory(client, existing), beforeData: existing, changed: false };

  const effectiveDate = normalizeText(employmentEffectiveDate) || localDate();
  const reason = normalizeText(employmentReason);
  if (!validDate(effectiveDate) || effectiveDate > localDate()) return { ok: false, code: 'INVALID_EMPLOYMENT_EFFECTIVE_DATE', message: 'Ngày thay đổi trạng thái làm việc không hợp lệ' };
  if (!reason) return { ok: false, code: 'EMPLOYMENT_REASON_REQUIRED', message: 'Vui lòng nhập lý do thay đổi trạng thái làm việc' };
  const latestEmployment = await employeeRepo.getLatestEmployeeEmploymentForUpdate(client, { installationId, employeeId: existing.id });
  const latestAssignment = await employeeRepo.getLatestEmployeeAssignmentForUpdate(client, { installationId, employeeId: existing.id });

  if (!isActive) {
    if (!latestEmployment || latestEmployment.effective_to != null || effectiveDate < latestEmployment.effective_from) {
      return { ok: false, code: 'EMPLOYMENT_STATUS_CONFLICT', message: 'Lịch sử lao động hiện tại không phù hợp để kết thúc' };
    }
    await employeeRepo.updateEmployeeEmploymentPeriod(client, {
      installationId, id: latestEmployment.id, employmentType: latestEmployment.employment_type,
      effectiveFrom: latestEmployment.effective_from, effectiveTo: effectiveDate, endReason: reason, dataQuality: 'CONFIRMED',
    });
    if (latestAssignment?.effective_to == null && effectiveDate >= latestAssignment.effective_from) {
      await employeeRepo.updateEmployeeAssignmentPeriod(client, {
        installationId,
        id: latestAssignment.id,
        branchId: latestAssignment.branch_id,
        departmentId: latestAssignment.department_id,
        positionId: latestAssignment.position_id,
        managerEmployeeId: latestAssignment.manager_employee_id,
        effectiveFrom: latestAssignment.effective_from,
        effectiveTo: effectiveDate,
        reason: latestAssignment.reason,
        dataQuality: latestAssignment.data_quality,
      });
    }
  } else {
    const type = normalizeEmploymentType(employmentType, latestEmployment?.employment_type || 'OTHER');
    if (!type) return { ok: false, code: 'INVALID_EMPLOYMENT_TYPE', message: 'Hình thức lao động không hợp lệ' };
    if (latestEmployment?.effective_to == null || (latestEmployment?.effective_to && effectiveDate <= latestEmployment.effective_to)) {
      return { ok: false, code: 'EMPLOYMENT_STATUS_CONFLICT', message: 'Ngày trở lại làm việc phải sau kỳ lao động trước' };
    }
    await employeeRepo.insertEmployeeEmployment(client, {
      installationId, employeeId: existing.id, employmentType: type, effectiveFrom: effectiveDate,
      dataQuality: 'CONFIRMED', source: 'HR', sourceReference: 'employee-reactivate', createdBy: updatedBy,
    });
    await employeeRepo.insertEmployeeAssignment(client, {
      installationId,
      employeeId: existing.id,
      branchId: existing.branch_id,
      departmentId: latestAssignment?.department_id ?? null,
      positionId: latestAssignment?.position_id ?? null,
      managerEmployeeId: latestAssignment?.manager_employee_id ?? null,
      effectiveFrom: effectiveDate,
      reason,
      dataQuality: 'CONFIRMED', source: 'HR', sourceReference: 'employee-reactivate', createdBy: updatedBy,
    });
  }

  const employee = await employeeRepo.updateEmployeeActiveStatus(client, {
    id: existing.id, installationId, isActive, updatedBy, expectedUpdatedAt: expected.value,
  });
  if (!employee) return conflictResult('Employee status update conflict');
  return { ok: true, employee: await employeeWithHistory(client, employee), beforeData: existing, changed: true };
}


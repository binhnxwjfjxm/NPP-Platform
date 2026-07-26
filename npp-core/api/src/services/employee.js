import * as employeeRepo from '../db/repositories/employee.js';
import * as branchRepo from '../db/repositories/branch.js';

const CODE_PATTERN = /^[A-Z0-9_-]{1,64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function validateExpectedUpdatedAt(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return { ok: false, code: 'MISSING_EXPECTED_UPDATED_AT', message: 'expectedUpdatedAt is required' };
  }
  const parsed = new Date(value.trim());
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false, code: 'INVALID_EXPECTED_UPDATED_AT', message: 'expectedUpdatedAt must be a valid date-time' };
  }
  return { ok: true, value: parsed.toISOString() };
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

  const existing = await employeeRepo.getEmployeeByCode(client, {
    installationId,
    code: validation.normalized.code,
  });
  if (existing) {
    return { ok: false, code: 'DUPLICATE_CODE', message: 'An employee with this code already exists' };
  }

  const branchResult = await resolveBranch(client, {
    installationId,
    branchId: validation.normalized.branchId,
    requireActive: true,
  });
  if (!branchResult.ok) return branchResult;

  const employee = await employeeRepo.insertEmployee(client, {
    installationId,
    code: validation.normalized.code,
    fullName: validation.normalized.fullName,
    jobTitle: validation.normalized.jobTitle,
    phone: validation.normalized.phone,
    email: validation.normalized.email,
    branchId: validation.normalized.branchId,
    createdBy,
  });

  return { ok: true, employee };
}

export async function getEmployee(client, { installationId, id }) {
  if (!isValidUuid(id)) return { ok: false, code: 'NOT_FOUND', message: 'Employee not found' };
  const employee = await employeeRepo.getEmployeeByIdForInstallation(client, { id: id.trim(), installationId });
  return employee
    ? { ok: true, employee }
    : { ok: false, code: 'NOT_FOUND', message: 'Employee not found' };
}

export async function listEmployees(client, { installationId, active, branchId, limit, offset }) {
  if (branchId && !isValidUuid(branchId)) {
    return { ok: false, code: 'INVALID_BRANCH_ID', message: 'Branch ID must be a valid UUID' };
  }
  const employees = await employeeRepo.listEmployeesForInstallation(client, {
    installationId,
    active,
    branchId: branchId || null,
    limit,
    offset,
  });
  return { ok: true, employees };
}

export async function updateEmployee(client, { id, installationId, payload, updatedBy }) {
  if (!isValidUuid(id)) return { ok: false, code: 'INVALID_ID', message: 'Employee ID must be a valid UUID' };

  const existing = await employeeRepo.getEmployeeByIdForInstallationForUpdate(client, {
    id: id.trim(),
    installationId,
  });
  if (!existing) return { ok: false, code: 'NOT_FOUND', message: 'Employee not found' };

  const validation = validateEmployeeInput({
    code: existing.code,
    fullName: payload?.fullName ?? existing.full_name,
    jobTitle: payload?.jobTitle ?? existing.job_title ?? '',
    phone: payload?.phone ?? existing.phone ?? '',
    email: payload?.email ?? existing.email ?? '',
    branchId: Object.prototype.hasOwnProperty.call(payload ?? {}, 'branchId') ? payload.branchId : existing.branch_id,
  });
  if (!validation.ok) return validation;

  const expected = validateExpectedUpdatedAt(payload?.expectedUpdatedAt);
  if (!expected.ok) return expected;

  const branchResult = await resolveBranch(client, {
    installationId,
    branchId: validation.normalized.branchId,
    requireActive: validation.normalized.branchId !== existing.branch_id,
  });
  if (!branchResult.ok) return branchResult;

  const employee = await employeeRepo.updateEmployee(client, {
    id: existing.id,
    installationId,
    fullName: validation.normalized.fullName,
    jobTitle: validation.normalized.jobTitle,
    phone: validation.normalized.phone,
    email: validation.normalized.email,
    branchId: validation.normalized.branchId,
    updatedBy,
    expectedUpdatedAt: expected.value,
  });

  if (!employee) {
    return { ok: false, code: 'CONFLICT', message: 'Employee update conflict', retryable: false };
  }
  return { ok: true, employee, beforeData: existing };
}

export async function updateEmployeeStatus(client, {
  id,
  installationId,
  isActive,
  updatedBy,
  expectedUpdatedAt,
}) {
  if (!isValidUuid(id)) return { ok: false, code: 'INVALID_ID', message: 'Employee ID must be a valid UUID' };
  if (typeof isActive !== 'boolean') {
    return { ok: false, code: 'INVALID_ACTIVE_STATUS', message: 'isActive must be a boolean' };
  }

  const existing = await employeeRepo.getEmployeeByIdForInstallationForUpdate(client, {
    id: id.trim(),
    installationId,
  });
  if (!existing) return { ok: false, code: 'NOT_FOUND', message: 'Employee not found' };

  const expected = validateExpectedUpdatedAt(expectedUpdatedAt);
  if (!expected.ok) return expected;
  if (existing.is_active === isActive) return { ok: true, employee: existing, beforeData: existing };

  const employee = await employeeRepo.updateEmployeeActiveStatus(client, {
    id: existing.id,
    installationId,
    isActive,
    updatedBy,
    expectedUpdatedAt: expected.value,
  });
  if (!employee) {
    return { ok: false, code: 'CONFLICT', message: 'Employee status update conflict', retryable: false };
  }
  return { ok: true, employee, beforeData: existing };
}

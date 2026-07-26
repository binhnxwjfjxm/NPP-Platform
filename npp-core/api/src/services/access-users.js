import * as userRepo from '../db/repositories/access-users.js';
import * as employeeRepo from '../db/repositories/employee.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOGIN_PATTERN = /^[a-z0-9._-]+$/;

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isValidUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value.trim());
}

function hasOwn(value, key) {
  return Boolean(value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key));
}

function normalizeDateTime(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value !== 'string') return null;
  const parsed = new Date(value.trim());
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function validateExpectedUpdatedAt(value) {
  if (value === undefined || value === null || value === '') {
    return { ok: false, code: 'MISSING_EXPECTED_UPDATED_AT', message: 'expectedUpdatedAt là bắt buộc' };
  }
  const normalized = normalizeDateTime(value);
  if (!normalized) {
    return { ok: false, code: 'INVALID_EXPECTED_UPDATED_AT', message: 'expectedUpdatedAt phải là thời điểm hợp lệ' };
  }
  return { ok: true, value: normalized };
}

function conflict(message = 'Người dùng đang có thay đổi, vui lòng tải lại dữ liệu') {
  return { ok: false, code: 'CONFLICT', message, retryable: false };
}

function notFound() {
  return { ok: false, code: 'NOT_FOUND', message: 'Người dùng không tồn tại' };
}

function normalizeUserRow(row) {
  return {
    id: row.id,
    installation_id: row.installation_id,
    employee_id: row.employee_id,
    employee_code: row.employee_code || null,
    employee_full_name: row.employee_full_name || null,
    login_name: row.login_name,
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
    created_by: row.created_by,
    updated_by: row.updated_by,
    role_ids: Array.isArray(row.role_ids) ? row.role_ids.filter(Boolean).map(String) : [],
  };
}

function normalizeRoleIds(value) {
  if (!Array.isArray(value)) return null;
  return [...new Set(value.filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean))];
}

function sameIds(left, right) {
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

async function requireActiveEmployee(client, installationId, employeeId) {
  const employee = await employeeRepo.getEmployeeByIdForInstallation(client, { installationId, id: employeeId });
  if (!employee) {
    return { ok: false, code: 'INVALID_EMPLOYEE_ID', message: 'Nhân sự liên kết không tồn tại trong installation hiện tại' };
  }
  if (!employee.is_active) {
    return { ok: false, code: 'INVALID_EMPLOYEE_ID', message: 'Nhân sự liên kết phải đang hoạt động' };
  }
  return { ok: true, employee };
}

export async function listUsers(client, { installationId, active, search, limit, offset }) {
  const users = await userRepo.listUsersForInstallation(client, { installationId, active, search, limit, offset });
  return { ok: true, users: users.map(normalizeUserRow) };
}

export async function getUser(client, { installationId, id }) {
  if (!isValidUuid(id)) return { ok: false, code: 'INVALID_ID', message: 'Mã người dùng không hợp lệ' };
  const row = await userRepo.getUserForInstallationWithRoles(client, { installationId, id: id.trim() });
  if (!row) return notFound();
  return { ok: true, user: normalizeUserRow(row) };
}

export async function createUser(client, { installationId, payload, createdBy }) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dữ liệu người dùng là bắt buộc' };
  }
  if (hasOwn(payload, 'roleIds')) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Vai trò phải được gán qua endpoint chuyên biệt' };
  }

  const loginName = normalizeText(payload.loginName ?? payload.login_name).toLowerCase();
  if (!loginName || loginName.length > 128 || !LOGIN_PATTERN.test(loginName)) {
    return { ok: false, code: 'INVALID_LOGIN_NAME', message: 'Tên đăng nhập chỉ gồm chữ thường, số, dấu chấm, gạch dưới hoặc gạch ngang' };
  }

  const employeeId = normalizeText(payload.employeeId ?? payload.employee_id);
  if (!isValidUuid(employeeId)) {
    return { ok: false, code: 'INVALID_EMPLOYEE_ID', message: 'employeeId không hợp lệ' };
  }

  if (hasOwn(payload, 'isActive') && typeof payload.isActive !== 'boolean') {
    return { ok: false, code: 'INVALID_ACTIVE_STATUS', message: 'isActive phải là kiểu boolean' };
  }

  const employeeValidation = await requireActiveEmployee(client, installationId, employeeId);
  if (!employeeValidation.ok) return employeeValidation;

  const duplicateLogin = await userRepo.getUserByLoginNameForInstallation(client, { installationId, loginName });
  if (duplicateLogin) {
    return { ok: false, code: 'DUPLICATE_LOGIN', message: 'Tên đăng nhập đã tồn tại', retryable: false };
  }
  const duplicateEmployee = await userRepo.getUserByEmployeeIdForInstallation(client, { installationId, employeeId });
  if (duplicateEmployee) {
    return { ok: false, code: 'DUPLICATE_EMPLOYEE', message: 'Nhân sự đã được liên kết với người dùng khác', retryable: false };
  }

  let inserted;
  try {
    inserted = await userRepo.insertUser(client, {
      installationId,
      employeeId,
      loginName,
      isActive: payload.isActive !== false,
      createdBy,
    });
  } catch (error) {
    if (error?.code === '23505') {
      if (String(error.constraint).includes('users_installation_login_unique')) {
        return { ok: false, code: 'DUPLICATE_LOGIN', message: 'Tên đăng nhập đã tồn tại', retryable: false };
      }
      if (String(error.constraint).includes('users_installation_employee_unique')) {
        return { ok: false, code: 'DUPLICATE_EMPLOYEE', message: 'Nhân sự đã được liên kết với người dùng khác', retryable: false };
      }
    }
    throw error;
  }

  const created = await userRepo.getUserForInstallationWithRoles(client, { installationId, id: inserted.id });
  return { ok: true, user: normalizeUserRow(created), changed: true };
}

export async function updateUserStatus(client, { id, installationId, payload, updatedBy }) {
  if (!isValidUuid(id)) return { ok: false, code: 'INVALID_ID', message: 'Mã người dùng không hợp lệ' };
  if (!payload || typeof payload !== 'object') {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dữ liệu cập nhật là bắt buộc' };
  }
  if (typeof payload.isActive !== 'boolean') {
    return { ok: false, code: 'INVALID_ACTIVE_STATUS', message: 'isActive phải là kiểu boolean' };
  }
  if (hasOwn(payload, 'loginName') || hasOwn(payload, 'login_name') || hasOwn(payload, 'employeeId') || hasOwn(payload, 'employee_id') || hasOwn(payload, 'roleIds')) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Chỉ hỗ trợ cập nhật trạng thái người dùng' };
  }

  const expected = validateExpectedUpdatedAt(payload.expectedUpdatedAt);
  if (!expected.ok) return expected;

  const locked = await userRepo.getUserByIdForInstallationForUpdate(client, { installationId, id: id.trim() });
  if (!locked) return notFound();
  if (normalizeDateTime(locked.updated_at) !== expected.value) return conflict();

  const beforeRow = await userRepo.getUserForInstallationWithRoles(client, { installationId, id: locked.id });
  const beforeData = normalizeUserRow(beforeRow);
  if (payload.isActive === locked.is_active) {
    return { ok: true, user: beforeData, beforeData, changed: false };
  }

  if (payload.isActive) {
    const employeeValidation = await requireActiveEmployee(client, installationId, locked.employee_id);
    if (!employeeValidation.ok) return employeeValidation;
  }

  const updated = await userRepo.updateUserActiveStatus(client, {
    id: locked.id,
    installationId,
    isActive: payload.isActive,
    updatedBy,
    expectedUpdatedAt: expected.value,
  });
  if (!updated) return conflict();

  const afterRow = await userRepo.getUserForInstallationWithRoles(client, { installationId, id: locked.id });
  return { ok: true, user: normalizeUserRow(afterRow), beforeData, changed: true };
}

export async function replaceUserRoles(client, { id, installationId, payload, updatedBy }) {
  if (!isValidUuid(id)) return { ok: false, code: 'INVALID_ID', message: 'Mã người dùng không hợp lệ' };
  if (!payload || typeof payload !== 'object') {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dữ liệu vai trò là bắt buộc' };
  }

  const roleIds = normalizeRoleIds(payload.roleIds);
  if (roleIds === null || roleIds.some((roleId) => !isValidUuid(roleId))) {
    return { ok: false, code: 'INVALID_ROLE_ID', message: 'roleIds phải là danh sách UUID hợp lệ' };
  }

  const expected = validateExpectedUpdatedAt(payload.expectedUpdatedAt);
  if (!expected.ok) return expected;

  const locked = await userRepo.getUserByIdForInstallationForUpdate(client, { installationId, id: id.trim() });
  if (!locked) return notFound();
  if (normalizeDateTime(locked.updated_at) !== expected.value) return conflict('Tập vai trò đã thay đổi, vui lòng tải lại dữ liệu');

  const beforeRow = await userRepo.getUserForInstallationWithRoles(client, { installationId, id: locked.id });
  const beforeData = normalizeUserRow(beforeRow);
  if (sameIds(beforeData.role_ids, roleIds)) {
    return { ok: true, user: beforeData, beforeData, changed: false };
  }

  const activeRoleIds = await userRepo.listActiveRoleIdsByIds(client, { installationId, roleIds });
  const missing = roleIds.filter((roleId) => !activeRoleIds.includes(roleId));
  if (missing.length > 0) {
    return { ok: false, code: 'INVALID_ROLE_ID', message: 'Danh sách chứa vai trò không tồn tại, khác installation hoặc không hoạt động' };
  }

  const bumped = await userRepo.bumpUserVersion(client, {
    id: locked.id,
    installationId,
    updatedBy,
    expectedUpdatedAt: expected.value,
  });
  if (!bumped) return conflict('Tập vai trò đã thay đổi, vui lòng tải lại dữ liệu');

  await userRepo.replaceUserRoles(client, {
    installationId,
    userId: locked.id,
    roleIds,
    createdBy: updatedBy,
  });

  const afterRow = await userRepo.getUserForInstallationWithRoles(client, { installationId, id: locked.id });
  return { ok: true, user: normalizeUserRow(afterRow), beforeData, changed: true };
}

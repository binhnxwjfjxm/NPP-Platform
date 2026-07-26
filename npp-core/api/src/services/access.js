import * as accessRepo from '../db/repositories/access.js';
import * as employeeRepo from '../db/repositories/employee.js';
import { PERMISSION_CATALOG, isKnownPermissionKey } from '../access/permissions.js';

const CODE_PATTERN = /^[A-Z0-9_-]{1,64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeCode(value) {
  return normalizeText(value).toUpperCase();
}

function isValidUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value.trim());
}

function hasOwn(value, key) {
  return Boolean(value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key));
}

function normalizePermissionKeys(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean))];
}

function normalizeDateTime(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === 'string') {
    const parsed = new Date(value.trim());
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}

function validateExpectedUpdatedAt(value) {
  if (value === undefined || value === null || value === '') {
    return { ok: false, code: 'MISSING_EXPECTED_UPDATED_AT', message: 'expectedUpdatedAt là bắt buộc' };
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return { ok: false, code: 'INVALID_EXPECTED_UPDATED_AT', message: 'expectedUpdatedAt phải là thời điểm hợp lệ' };
    }
    return { ok: true, value: value.toISOString() };
  }
  const parsed = new Date(String(value).trim());
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false, code: 'INVALID_EXPECTED_UPDATED_AT', message: 'expectedUpdatedAt phải là thời điểm hợp lệ' };
  }
  return { ok: true, value: parsed.toISOString() };
}

function conflictResult(message = 'Vai trò đang có thay đổi, vui lòng tải lại dữ liệu') {
  return { ok: false, code: 'CONFLICT', message, retryable: false };
}

function notFoundRole() {
  return { ok: false, code: 'NOT_FOUND', message: 'Vai trò không tồn tại' };
}

export function listPermissions(client) {
  return accessRepo.listPermissionCatalog(client);
}

function normalizeRoleCatalogRows(rows) {
  return rows.map((row) => ({
    ...row,
    permission_keys: Array.isArray(row.permission_keys) ? row.permission_keys.filter(Boolean) : [],
  }));
}

export async function listRoles(client, { installationId, active, search, limit, offset }) {
  const roles = await accessRepo.listRolesForInstallation(client, { installationId, active, search, limit, offset });
  return { ok: true, roles: normalizeRoleCatalogRows(roles) };
}

export async function getRole(client, { installationId, id }) {
  if (!isValidUuid(id)) return notFoundRole();
  const role = await accessRepo.getRoleForInstallationWithPermissions(client, { installationId, id: id.trim() });
  if (!role) return notFoundRole();
  return { ok: true, role: normalizeRoleCatalogRows([role])[0] };
}

function validateRoleInput(payload) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dữ liệu vai trò là bắt buộc' };
  }

  const code = normalizeCode(payload.code);
  if (!CODE_PATTERN.test(code)) {
    return { ok: false, code: 'INVALID_CODE', message: 'Mã vai trò phải gồm chữ hoa, số, dấu gạch ngang hoặc gạch dưới' };
  }

  const name = normalizeText(payload.name);
  if (!name || name.length > 256) {
    return { ok: false, code: 'INVALID_NAME', message: 'Tên vai trò là bắt buộc và không vượt quá 256 ký tự' };
  }

  const description = normalizeText(payload.description);
  if (description.length > 512) {
    return { ok: false, code: 'INVALID_DESCRIPTION', message: 'Mô tả vai trò không vượt quá 512 ký tự' };
  }

  if (hasOwn(payload, 'isActive') && typeof payload.isActive !== 'boolean') {
    return { ok: false, code: 'INVALID_ACTIVE_STATUS', message: 'isActive phải là kiểu boolean' };
  }

  const permissionKeys = normalizePermissionKeys(payload.permissionKeys);
  if (permissionKeys.some((key) => !isKnownPermissionKey(key))) {
    return { ok: false, code: 'INVALID_PERMISSION_KEY', message: 'Danh sách quyền chứa quyền không hợp lệ' };
  }

  return {
    ok: true,
    normalized: {
      code,
      name,
      description: description || null,
      isActive: payload.isActive !== false,
      permissionKeys,
    },
  };
}

async function validatePermissionCatalog(client, permissionKeys) {
  await accessRepo.syncPermissionCatalog(client);
  const missing = await accessRepo.permissionKeysExist(client, permissionKeys);
  if (missing.length > 0) {
    return {
      ok: false,
      code: 'INVALID_PERMISSION_KEY',
      message: `Danh sách quyền chứa quyền không hợp lệ: ${missing.join(', ')}`,
    };
  }
  return { ok: true };
}

async function loadRoleForUpdate(client, { installationId, id }) {
  if (!isValidUuid(id)) return null;
  return accessRepo.getRoleForInstallationWithPermissions(client, { installationId, id: id.trim() });
}

export async function createRole(client, { installationId, payload, createdBy }) {
  const validation = validateRoleInput(payload);
  if (!validation.ok) return validation;

  const permissionValidation = await validatePermissionCatalog(client, validation.normalized.permissionKeys);
  if (!permissionValidation.ok) return permissionValidation;

  const role = await accessRepo.insertRole(client, {
    installationId,
    code: validation.normalized.code,
    name: validation.normalized.name,
    description: validation.normalized.description,
    isActive: validation.normalized.isActive,
    createdBy,
    updatedBy: createdBy,
  });
  if (!role) {
    return { ok: false, code: 'DUPLICATE_CODE', message: 'Đã tồn tại vai trò có mã này', retryable: false };
  }

  await accessRepo.replaceRolePermissions(client, {
    installationId,
    roleId: role.id,
    permissionKeys: validation.normalized.permissionKeys,
    grantedBy: createdBy,
  });

  const createdRole = await accessRepo.getRoleForInstallationWithPermissions(client, { installationId, id: role.id });
  return { ok: true, role: normalizeRoleCatalogRows([createdRole])[0] };
}

export async function updateRole(client, { id, installationId, payload, updatedBy }) {
  if (!isValidUuid(id)) return { ok: false, code: 'INVALID_ID', message: 'Mã vai trò không hợp lệ' };

  const normalizedId = id.trim();
  const existing = await accessRepo.getRoleByIdForInstallationForUpdate(client, { installationId, id: normalizedId });
  if (!existing) return notFoundRole();

  const existingPermissionKeys = await accessRepo.listRolePermissionKeys(client, { installationId, roleId: existing.id });

  if (hasOwn(payload, 'code')) {
    const nextCode = normalizeCode(payload.code);
    if (!CODE_PATTERN.test(nextCode)) {
      return { ok: false, code: 'INVALID_CODE', message: 'Mã vai trò phải gồm chữ hoa, số, dấu gạch ngang hoặc gạch dưới' };
    }
    if (nextCode !== existing.code) {
      return { ok: false, code: 'CODE_IMMUTABLE', message: 'Mã vai trò không thể thay đổi sau khi tạo' };
    }
  }

  if (hasOwn(payload, 'isActive') && typeof payload.isActive !== 'boolean') {
    return { ok: false, code: 'INVALID_ACTIVE_STATUS', message: 'isActive phải là kiểu boolean' };
  }

  const nextName = payload?.name === undefined ? existing.name : normalizeText(payload.name);
  const nextDescription = payload?.description === undefined ? existing.description ?? '' : normalizeText(payload.description);
  const nextPermissionKeys = payload?.permissionKeys === undefined
    ? existingPermissionKeys
    : normalizePermissionKeys(payload.permissionKeys);
  const nextIsActive = payload?.isActive === undefined ? existing.is_active : payload.isActive;

  const validation = validateRoleInput({
    code: existing.code,
    name: nextName,
    description: nextDescription,
    isActive: nextIsActive,
    permissionKeys: nextPermissionKeys,
  });
  if (!validation.ok) return validation;

  const expected = validateExpectedUpdatedAt(payload?.expectedUpdatedAt);
  if (!expected.ok) return expected;
  if (normalizeDateTime(existing.updated_at) !== expected.value) {
    return conflictResult('Vai trò đang có thay đổi, vui lòng tải lại dữ liệu');
  }

  const permissionValidation = await validatePermissionCatalog(client, validation.normalized.permissionKeys);
  if (!permissionValidation.ok) return permissionValidation;

  const currentPermissionKeys = [...existingPermissionKeys].sort();
  const nextSortedPermissionKeys = [...validation.normalized.permissionKeys].sort();
  const permissionsChanged = currentPermissionKeys.length !== nextSortedPermissionKeys.length
    || currentPermissionKeys.some((key, index) => key !== nextSortedPermissionKeys[index]);
  const statusChanged = existing.is_active !== nextIsActive;
  const metadataChanged = nextName !== existing.name || (nextDescription || null) !== (existing.description ?? null);

  if (!permissionsChanged && !statusChanged && !metadataChanged) {
    const snapshot = { ...existing, permission_keys: existingPermissionKeys };
    return { ok: true, role: snapshot, beforeData: snapshot, changed: false };
  }

  const updated = await accessRepo.updateRoleRecord(client, {
    id: normalizedId,
    installationId,
    name: validation.normalized.name,
    description: validation.normalized.description,
    isActive: nextIsActive,
    updatedBy,
    expectedUpdatedAt: expected.value,
  });

  if (!updated) return conflictResult('Vai trò đang có thay đổi, vui lòng tải lại dữ liệu');

  if (permissionsChanged) {
    await accessRepo.replaceRolePermissions(client, {
      installationId,
      roleId: updated.id,
      permissionKeys: validation.normalized.permissionKeys,
      grantedBy: updatedBy,
    });
  }

  const role = await accessRepo.getRoleForInstallationWithPermissions(client, { installationId, id: updated.id });
  if (!role) return conflictResult('Vai trò đang có thay đổi, vui lòng tải lại dữ liệu');

  return {
    ok: true,
    role: normalizeRoleCatalogRows([role])[0],
    beforeData: { ...existing, permission_keys: existingPermissionKeys },
    changed: true,
  };
}

export async function updateRoleStatus(client, { id, installationId, isActive, updatedBy, expectedUpdatedAt }) {
  if (!isValidUuid(id)) return { ok: false, code: 'INVALID_ID', message: 'Mã vai trò không hợp lệ' };
  if (typeof isActive !== 'boolean') return { ok: false, code: 'INVALID_ACTIVE_STATUS', message: 'isActive phải là kiểu boolean' };

  const existing = await accessRepo.getRoleByIdForInstallationForUpdate(client, { installationId, id: id.trim() });
  if (!existing) return notFoundRole();

  const expected = validateExpectedUpdatedAt(expectedUpdatedAt);
  if (!expected.ok) return expected;
  if (normalizeDateTime(existing.updated_at) !== expected.value) return conflictResult('Trạng thái vai trò đã thay đổi, vui lòng tải lại dữ liệu');
  const existingPermissionKeys = await accessRepo.listRolePermissionKeys(client, { installationId, roleId: existing.id });
  if (existing.is_active === isActive) {
    const snapshot = { ...existing, permission_keys: existingPermissionKeys };
    return { ok: true, role: snapshot, beforeData: snapshot, changed: false };
  }

  const updated = await accessRepo.updateRoleActiveStatus(client, {
    id: existing.id,
    installationId,
    isActive,
    updatedBy,
    expectedUpdatedAt: expected.value,
  });
  if (!updated) return conflictResult('Trạng thái vai trò đã thay đổi, vui lòng tải lại dữ liệu');

  const role = await accessRepo.getRoleForInstallationWithPermissions(client, { installationId, id: existing.id });
  return {
    ok: true,
    role: normalizeRoleCatalogRows([role])[0],
    beforeData: { ...existing, permission_keys: existingPermissionKeys },
    changed: true,
  };
}

export async function updateRolePermissions(client, { id, installationId, permissionKeys, updatedBy, expectedUpdatedAt }) {
  if (!isValidUuid(id)) return { ok: false, code: 'INVALID_ID', message: 'Mã vai trò không hợp lệ' };

  const existing = await accessRepo.getRoleByIdForInstallationForUpdate(client, { installationId, id: id.trim() });
  if (!existing) return notFoundRole();
  const existingPermissionKeys = await accessRepo.listRolePermissionKeys(client, { installationId, roleId: existing.id });

  const expected = validateExpectedUpdatedAt(expectedUpdatedAt);
  if (!expected.ok) return expected;
  if (normalizeDateTime(existing.updated_at) !== expected.value) return conflictResult('Tập quyền của vai trò đã thay đổi, vui lòng tải lại dữ liệu');

  const normalizedPermissionKeys = normalizePermissionKeys(permissionKeys);
  if (normalizedPermissionKeys.some((key) => !isKnownPermissionKey(key))) {
    return { ok: false, code: 'INVALID_PERMISSION_KEY', message: 'Danh sách quyền chứa quyền không hợp lệ' };
  }

  const permissionValidation = await validatePermissionCatalog(client, normalizedPermissionKeys);
  if (!permissionValidation.ok) return permissionValidation;

  const currentPermissionKeys = [...existingPermissionKeys].sort();
  const nextSortedPermissionKeys = [...normalizedPermissionKeys].sort();
  const permissionsChanged = currentPermissionKeys.length !== nextSortedPermissionKeys.length
    || currentPermissionKeys.some((key, index) => key !== nextSortedPermissionKeys[index]);

  if (!permissionsChanged) {
    const snapshot = { ...existing, permission_keys: existingPermissionKeys };
    return { ok: true, role: snapshot, beforeData: snapshot, changed: false };
  }

  const updated = await accessRepo.updateRoleRecord(client, {
    id: existing.id,
    installationId,
    name: existing.name,
    description: existing.description,
    isActive: existing.is_active,
    updatedBy,
    expectedUpdatedAt: expected.value,
  });
  if (!updated) return conflictResult('Tập quyền của vai trò đã thay đổi, vui lòng tải lại dữ liệu');

  await accessRepo.replaceRolePermissions(client, {
    installationId,
    roleId: existing.id,
    permissionKeys: normalizedPermissionKeys,
    grantedBy: updatedBy,
  });

  const role = await accessRepo.getRoleForInstallationWithPermissions(client, { installationId, id: existing.id });
  return {
    ok: true,
    role: normalizeRoleCatalogRows([role])[0],
    beforeData: { ...existing, permission_keys: existingPermissionKeys },
    changed: true,
  };
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
    role_ids: Array.isArray(row.role_ids) ? row.role_ids.filter(Boolean) : [],
  };
}

function normalizeLoginName(value) {
  return normalizeText(value).toLowerCase();
}

function validateUserInput(payload, { requireEmployee = false } = {}) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dữ liệu người dùng là bắt buộc' };
  }

  const loginName = normalizeLoginName(payload.loginName ?? payload.login_name ?? '');
  if (!loginName || loginName.length > 128 || !/^[a-z0-9._-]+$/.test(loginName)) {
    return { ok: false, code: 'INVALID_LOGIN_NAME', message: 'loginName là bắt buộc và chỉ chứa chữ thường, chữ số, chấm, gạch dưới hoặc gạch ngang' };
  }

  const employeeId = hasOwn(payload, 'employeeId') ? normalizeText(payload.employeeId) : undefined;
  if (employeeId === '' || employeeId === null) {
    if (requireEmployee) {
      return { ok: false, code: 'INVALID_EMPLOYEE_ID', message: 'employeeId là bắt buộc' };
    }
  } else if (employeeId !== undefined && !isValidUuid(employeeId)) {
    return { ok: false, code: 'INVALID_EMPLOYEE_ID', message: 'employeeId không hợp lệ' };
  }

  const isActive = hasOwn(payload, 'isActive') ? payload.isActive : undefined;
  if (isActive !== undefined && typeof isActive !== 'boolean') {
    return { ok: false, code: 'INVALID_ACTIVE_STATUS', message: 'isActive phải là kiểu boolean' };
  }

  const roleIds = Array.isArray(payload.roleIds)
    ? [...new Set(payload.roleIds.filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean))]
    : undefined;
  if (roleIds && roleIds.some((id) => !isValidUuid(id))) {
    return { ok: false, code: 'INVALID_ROLE_ID', message: 'roleIds chứa mã không hợp lệ' };
  }

  return {
    ok: true,
    normalized: {
      loginName,
      employeeId: employeeId === '' ? null : employeeId,
      isActive,
      roleIds,
    },
  };
}

async function validateUserRelations(client, installationId, { employeeId, requireEmployeeActive = false, roleIds }) {
  if (employeeId) {
    const employee = await employeeRepo.getEmployeeByIdForInstallation(client, { installationId, id: employeeId });
    if (!employee) {
      return { ok: false, code: 'INVALID_EMPLOYEE_ID', message: 'Nhân sự liên kết không tồn tại' };
    }
    if (requireEmployeeActive && !employee.is_active) {
      return { ok: false, code: 'INVALID_EMPLOYEE_ID', message: 'Nhân sự liên kết phải đang hoạt động' };
    }
  }

  if (roleIds && roleIds.length > 0) {
    const existingRoleIds = await accessRepo.listActiveRoleIdsByIds(client, { installationId, roleIds });
    const missing = roleIds.filter((id) => !existingRoleIds.includes(id));
    if (missing.length > 0) {
      return { ok: false, code: 'INVALID_ROLE_ID', message: `roleIds chứa mã vai trò không hợp lệ hoặc vai trò không hoạt động: ${missing.join(', ')}` };
    }
  }

  return { ok: true };
}

function userStatusChanged(existing, normalized) {
  return normalized.isActive !== undefined && normalized.isActive !== existing.is_active;
}

function roleIdsChanged(existingRoleIds, normalizedRoleIds) {
  const nextRoleIds = normalizedRoleIds === undefined ? existingRoleIds : [...new Set(normalizedRoleIds)];
  const currentRoleIds = [...new Set(existingRoleIds)];
  nextRoleIds.sort();
  currentRoleIds.sort();
  return nextRoleIds.length !== currentRoleIds.length || nextRoleIds.some((id, index) => id !== currentRoleIds[index]);
}

export async function listUsers(client, { installationId, active, search, limit, offset }) {
  const users = await accessRepo.listUsersForInstallation(client, { installationId, active, search, limit, offset });
  return { ok: true, users: users.map(normalizeUserRow) };
}

export async function getUser(client, { installationId, id }) {
  if (!isValidUuid(id)) return { ok: false, code: 'NOT_FOUND', message: 'Người dùng không tồn tại' };
  const user = await accessRepo.getUserForInstallationWithRoles(client, { installationId, id: id.trim() });
  if (!user) return { ok: false, code: 'NOT_FOUND', message: 'Người dùng không tồn tại' };
  return { ok: true, user: normalizeUserRow(user) };
}

export async function createUser(client, { installationId, payload, createdBy }) {
  const validation = validateUserInput(payload, { requireEmployee: true });
  if (!validation.ok) return validation;

  const normalized = validation.normalized;
  const relationValidation = await validateUserRelations(client, installationId, {
    employeeId: normalized.employeeId,
    requireEmployeeActive: normalized.isActive !== false,
    roleIds: normalized.roleIds,
  });
  if (!relationValidation.ok) return relationValidation;

  const duplicateLogin = await accessRepo.getUserByLoginNameForInstallation(client, {
    installationId,
    loginName: normalized.loginName,
  });
  if (duplicateLogin) {
    return { ok: false, code: 'DUPLICATE_LOGIN', message: 'Tên đăng nhập đã tồn tại', retryable: false };
  }

  const duplicateEmployee = await accessRepo.getUserByEmployeeIdForInstallation(client, {
    installationId,
    employeeId: normalized.employeeId,
  });
  if (duplicateEmployee) {
    return { ok: false, code: 'DUPLICATE_EMPLOYEE', message: 'Nhân sự đã được liên kết với một người dùng khác', retryable: false };
  }

  let user;
  try {
    user = await accessRepo.insertUser(client, {
      installationId,
      employeeId: normalized.employeeId,
      loginName: normalized.loginName,
      isActive: normalized.isActive !== undefined ? normalized.isActive : true,
      createdBy,
      updatedBy: createdBy,
    });
  } catch (error) {
    if (error && error.code === '23505') {
      if (String(error.constraint).includes('users_installation_login_unique')) {
        return { ok: false, code: 'DUPLICATE_LOGIN', message: 'Tên đăng nhập đã tồn tại', retryable: false };
      }
      if (String(error.constraint).includes('users_installation_employee_unique')) {
        return { ok: false, code: 'DUPLICATE_EMPLOYEE', message: 'Nhân sự đã được liên kết với một người dùng khác', retryable: false };
      }
    }
    throw error;
  }

  if (!user) {
    return { ok: false, code: 'DUPLICATE_LOGIN', message: 'Tên đăng nhập đã tồn tại', retryable: false };
  }

  if (normalized.roleIds && normalized.roleIds.length > 0) {
    await accessRepo.replaceUserRoles(client, {
      installationId,
      userId: user.id,
      roleIds: normalized.roleIds,
      createdBy,
    });
  }

  const createdUser = await accessRepo.getUserForInstallationWithRoles(client, { installationId, id: user.id });
  return { ok: true, user: normalizeUserRow(createdUser) };
}

export async function updateUserStatus(client, { id, installationId, payload, updatedBy }) {
  if (!isValidUuid(id)) return { ok: false, code: 'INVALID_ID', message: 'Mã người dùng không hợp lệ' };

  const validation = validateUserInput(payload, { requireEmployee: false });
  if (!validation.ok) return validation;

  const normalized = validation.normalized;
  if (normalized.loginName !== undefined || normalized.employeeId !== undefined || normalized.roleIds !== undefined) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Chỉ hỗ trợ cập nhật trạng thái người dùng' };
  }

  if (normalized.isActive === undefined) {
    return { ok: false, code: 'INVALID_INPUT', message: 'isActive là bắt buộc để cập nhật trạng thái' };
  }

  const existing = await accessRepo.getUserForInstallationWithRoles(client, { installationId, id: id.trim() });
  if (!existing) return { ok: false, code: 'NOT_FOUND', message: 'Người dùng không tồn tại' };

  const userForUpdate = await accessRepo.getUserByIdForInstallationForUpdate(client, { installationId, id: id.trim() });
  if (!userForUpdate) return { ok: false, code: 'NOT_FOUND', message: 'Người dùng không tồn tại' };

  const expected = validateExpectedUpdatedAt(payload?.expectedUpdatedAt);
  if (!expected.ok) return expected;
  if (normalizeDateTime(existing.updated_at) !== expected.value) {
    return { ok: false, code: 'CONFLICT', message: 'Người dùng đang có thay đổi, vui lòng tải lại dữ liệu', retryable: false };
  }

  if (!userStatusChanged(existing, normalized)) {
    return { ok: true, user: normalizeUserRow(existing), beforeData: normalizeUserRow(existing), changed: false };
  }

  if (normalized.isActive && normalized.isActive !== existing.is_active) {
    const relationValidation = await validateUserRelations(client, installationId, {
      employeeId: existing.employee_id,
      requireEmployeeActive: true,
    });
    if (!relationValidation.ok) return relationValidation;
  }

  const updated = await accessRepo.updateUserActiveStatus(client, {
    id: existing.id,
    installationId,
    isActive: normalized.isActive,
    updatedBy,
    expectedUpdatedAt: expected.value,
  });

  if (!updated) {
    return { ok: false, code: 'CONFLICT', message: 'Người dùng đang có thay đổi, vui lòng tải lại dữ liệu', retryable: false };
  }

  const user = await accessRepo.getUserForInstallationWithRoles(client, { installationId, id: existing.id });
  return {
    ok: true,
    user: normalizeUserRow(user),
    beforeData: normalizeUserRow(existing),
    changed: true,
  };
}

export async function replaceUserRoles(client, { id, installationId, payload, updatedBy }) {
  if (!isValidUuid(id)) return { ok: false, code: 'INVALID_ID', message: 'Mã người dùng không hợp lệ' };

  const validation = validateUserInput(payload, { requireEmployee: false });
  if (!validation.ok) return validation;

  const normalized = validation.normalized;
  if (!Array.isArray(payload.roleIds)) {
    return { ok: false, code: 'INVALID_INPUT', message: 'roleIds là bắt buộc' };
  }

  const existing = await accessRepo.getUserForInstallationWithRoles(client, { installationId, id: id.trim() });
  if (!existing) return { ok: false, code: 'NOT_FOUND', message: 'Người dùng không tồn tại' };

  const userForUpdate = await accessRepo.getUserByIdForInstallationForUpdate(client, { installationId, id: id.trim() });
  if (!userForUpdate) return { ok: false, code: 'NOT_FOUND', message: 'Người dùng không tồn tại' };

  const expected = validateExpectedUpdatedAt(payload?.expectedUpdatedAt);
  if (!expected.ok) return expected;
  if (normalizeDateTime(existing.updated_at) !== expected.value) {
    return { ok: false, code: 'CONFLICT', message: 'Người dùng đang có thay đổi, vui lòng tải lại dữ liệu', retryable: false };
  }

  const normalizedRoleIds = normalized.roleIds ?? [];
  const changed = roleIdsChanged(Array.isArray(existing.role_ids) ? existing.role_ids : [], normalizedRoleIds);
  if (!changed) {
    return { ok: true, user: normalizeUserRow(existing), beforeData: normalizeUserRow(existing), changed: false };
  }

  const relationValidation = await validateUserRelations(client, installationId, {
    roleIds: normalizedRoleIds,
  });
  if (!relationValidation.ok) return relationValidation;

  const updated = await accessRepo.updateUserRecord(client, {
    id: existing.id,
    installationId,
    updatedBy,
    expectedUpdatedAt: expected.value,
  });

  if (!updated) {
    return { ok: false, code: 'CONFLICT', message: 'Người dùng đang có thay đổi, vui lòng tải lại dữ liệu', retryable: false };
  }

  await accessRepo.replaceUserRoles(client, {
    installationId,
    userId: existing.id,
    roleIds: normalizedRoleIds,
    createdBy: updatedBy,
  });

  const user = await accessRepo.getUserForInstallationWithRoles(client, { installationId, id: existing.id });
  return {
    ok: true,
    user: normalizeUserRow(user),
    beforeData: normalizeUserRow(existing),
    changed: true,
  };
}

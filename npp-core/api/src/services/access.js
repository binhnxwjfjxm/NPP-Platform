import * as accessRepo from '../db/repositories/access.js';
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
  return accessRepo.syncPermissionCatalog(client).then(() => accessRepo.listPermissionCatalog(client));
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
    isActive: payload?.isActive !== false,
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

  if (Object.prototype.hasOwnProperty.call(payload ?? {}, 'code')) {
    const nextCode = normalizeCode(payload.code);
    if (nextCode && nextCode !== existing.code) {
      return { ok: false, code: 'CODE_IMMUTABLE', message: 'Mã vai trò không thể thay đổi sau khi tạo' };
    }
  }

  const nextName = payload?.name === undefined ? existing.name : normalizeText(payload.name);
  const nextDescription = payload?.description === undefined ? existing.description ?? '' : normalizeText(payload.description);
  const nextPermissionKeys = payload?.permissionKeys === undefined
    ? existingPermissionKeys
    : normalizePermissionKeys(payload.permissionKeys);
  const nextIsActive = typeof payload?.isActive === 'boolean' ? payload.isActive : existing.is_active;

  const validation = validateRoleInput({
    code: existing.code,
    name: nextName,
    description: nextDescription,
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

  const freshRole = await accessRepo.getRoleForInstallationWithPermissions(client, { installationId, id: role.id });
  return {
    ok: true,
    role: normalizeRoleCatalogRows([freshRole])[0],
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
  const existing = await accessRepo.getRoleByIdForInstallationForUpdate(client, { installationId, id });
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

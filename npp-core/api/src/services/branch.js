import * as branchRepo from '../db/repositories/branch.js';
import { activeDependentsConflict, staleVersionConflict } from './deactivate-conflict-contract.js';

const CODE_PATTERN = /^[A-Z0-9_-]{1,64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeCode(code) {
  if (typeof code !== 'string') return '';
  return code.trim().toUpperCase();
}

function normalizeText(text) {
  if (typeof text !== 'string') return '';
  return text.trim();
}

function validateEntityId(id) {
  return typeof id === 'string' && UUID_PATTERN.test(id.trim());
}

function validateEmail(email) {
  if (!email) return true;
  const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return pattern.test(email);
}

function validatePhone(phone) {
  if (!phone) return true;
  const pattern = /^[0-9\s\-+()]{5,20}$/;
  return pattern.test(phone);
}

function validateExpectedUpdatedAt(value) {
  if (value === undefined || value === null) {
    return { ok: false, code: 'MISSING_EXPECTED_UPDATED_AT', message: 'expectedUpdatedAt is required' };
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return { ok: false, code: 'INVALID_EXPECTED_UPDATED_AT', message: 'expectedUpdatedAt must be a valid date-time' };
    }
    return { ok: true, value: value.toISOString() };
  }

  if (typeof value !== 'string' || !value.trim()) {
    return { ok: false, code: 'INVALID_EXPECTED_UPDATED_AT', message: 'expectedUpdatedAt must be a non-empty string' };
  }

  const parsed = new Date(value.trim());
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false, code: 'INVALID_EXPECTED_UPDATED_AT', message: 'expectedUpdatedAt must be a valid date-time' };
  }

  return { ok: true, value: parsed.toISOString() };
}

export function validateBranchInput(payload) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, code: 'INVALID_INPUT', message: 'Branch data is required' };
  }

  const code = normalizeCode(payload.code);
  if (!CODE_PATTERN.test(code)) {
    return { ok: false, code: 'INVALID_CODE', message: 'Code must be 1-64 characters and contain only uppercase letters, digits, hyphens, or underscores' };
  }

  const name = normalizeText(payload.name);
  if (!name || name.length > 256) {
    return { ok: false, code: 'INVALID_NAME', message: 'Name is required and must be 1-256 characters' };
  }

  const address = normalizeText(payload.address);
  if (address && address.length > 512) {
    return { ok: false, code: 'INVALID_ADDRESS', message: 'Address must be 0-512 characters' };
  }

  const phone = normalizeText(payload.phone);
  if (phone && !validatePhone(phone)) {
    return { ok: false, code: 'INVALID_PHONE', message: 'Phone must be a valid format' };
  }

  const email = normalizeText(payload.email);
  if (email && !validateEmail(email)) {
    return { ok: false, code: 'INVALID_EMAIL', message: 'Email must be a valid format' };
  }

  return {
    ok: true,
    normalized: {
      code,
      name,
      address: address || null,
      phone: phone || null,
      email: email || null,
    },
  };
}

export async function createBranch(client, { installationId, payload, createdBy }) {
  const validation = validateBranchInput(payload);
  if (!validation.ok) return { ok: false, code: validation.code, message: validation.message };

  const existing = await branchRepo.getBranchByCode(client, { installationId, code: validation.normalized.code });
  if (existing) {
    return { ok: false, code: 'DUPLICATE_CODE', message: 'A branch with this code already exists', retryable: false };
  }

  const branch = await branchRepo.insertBranch(client, {
    installationId,
    code: validation.normalized.code,
    name: validation.normalized.name,
    address: validation.normalized.address,
    phone: validation.normalized.phone,
    email: validation.normalized.email,
    createdBy,
  });

  return { ok: true, branch };
}

export async function getBranch(client, { installationId, id }) {
  if (!validateEntityId(id)) {
    return { ok: false, code: 'NOT_FOUND', message: 'Branch not found' };
  }

  const branch = await branchRepo.getBranchByIdForInstallation(client, { id: id.trim(), installationId });
  if (!branch) {
    return { ok: false, code: 'NOT_FOUND', message: 'Branch not found' };
  }
  return { ok: true, branch };
}

export async function listBranches(client, { installationId, active, limit, offset }) {
  const branches = await branchRepo.listBranchesForInstallation(client, { installationId, active, limit, offset });
  return { ok: true, branches };
}

export async function updateBranch(client, { id, installationId, payload, updatedBy }) {
  if (!validateEntityId(id)) {
    return { ok: false, code: 'INVALID_ID', message: 'Branch ID must be a valid UUID' };
  }

  const normalizedId = id.trim();
  const existing = await branchRepo.getBranchByIdForInstallation(client, { id: normalizedId, installationId });
  if (!existing) {
    return { ok: false, code: 'NOT_FOUND', message: 'Branch not found' };
  }

  const validation = validateBranchInput({ code: existing.code, ...payload });
  if (!validation.ok) return { ok: false, code: validation.code, message: validation.message };

  const expectedUpdatedAtValidation = validateExpectedUpdatedAt(payload.expectedUpdatedAt);
  if (expectedUpdatedAtValidation && !expectedUpdatedAtValidation.ok) {
    return { ok: false, code: expectedUpdatedAtValidation.code, message: expectedUpdatedAtValidation.message };
  }

  const updated = await branchRepo.updateBranch(client, {
    id: normalizedId,
    installationId,
    name: validation.normalized.name,
    address: validation.normalized.address,
    phone: validation.normalized.phone,
    email: validation.normalized.email,
    updatedBy,
    expectedUpdatedAt: expectedUpdatedAtValidation?.value ?? null,
  });

  if (!updated) {
    return staleVersionConflict({ entityLabel: 'Chi nhánh', managementPath: '/organization/branches' });
  }

  return { ok: true, branch: updated, beforeData: existing };
}

export async function updateBranchStatus(client, { id, installationId, isActive, updatedBy, expectedUpdatedAt }) {
  if (!validateEntityId(id)) {
    return { ok: false, code: 'INVALID_ID', message: 'Branch ID must be a valid UUID' };
  }

  const normalizedId = id.trim();
  const existing = await branchRepo.getBranchByIdForInstallationForUpdate(client, { id: normalizedId, installationId });
  if (!existing) {
    return { ok: false, code: 'NOT_FOUND', message: 'Branch not found' };
  }

  const expectedUpdatedAtValidation = validateExpectedUpdatedAt(expectedUpdatedAt);
  if (expectedUpdatedAtValidation && !expectedUpdatedAtValidation.ok) {
    return { ok: false, code: expectedUpdatedAtValidation.code, message: expectedUpdatedAtValidation.message };
  }

  if (typeof isActive !== 'boolean') {
    return { ok: false, code: 'INVALID_ACTIVE_STATUS', message: 'isActive must be a boolean' };
  }

  if (existing.is_active === isActive) {
    return { ok: true, branch: existing, beforeData: existing };
  }

  if (!isActive) {
    const activeWarehouseCount = await branchRepo.countActiveWarehouses(client, { branchId: normalizedId, installationId });
    if (activeWarehouseCount > 0) {
      return activeDependentsConflict({
        message: 'Không thể ngưng hoạt động chi nhánh vì còn kho đang hoạt động. Hãy ngưng hoạt động hoặc chuyển các kho sang chi nhánh khác trước rồi thử lại.',
        reason: 'BRANCH_HAS_ACTIVE_WAREHOUSES',
        dependentType: 'warehouse',
        dependentLabel: 'Kho đang hoạt động',
        count: activeWarehouseCount,
        managementPath: '/organization/warehouses',
        action: 'deactivate_or_reassign_warehouses_first',
      });
    }
  }

  const updated = await branchRepo.updateBranchActiveStatus(client, {
    id: normalizedId,
    installationId,
    isActive,
    updatedBy,
    expectedUpdatedAt: expectedUpdatedAtValidation?.value ?? null,
  });

  if (!updated) {
    return staleVersionConflict({ entityLabel: 'Chi nhánh', managementPath: '/organization/branches' });
  }

  return { ok: true, branch: updated, beforeData: existing };
}

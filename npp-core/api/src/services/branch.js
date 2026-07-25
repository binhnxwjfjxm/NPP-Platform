import * as branchRepo from '../db/repositories/branch.js';
import * as warehouseRepo from '../db/repositories/warehouse.js';

const CODE_PATTERN = /^[A-Z0-9_-]{1,64}$/;

function normalizeCode(code) {
  if (typeof code !== 'string') return '';
  return code.trim().toUpperCase();
}

function normalizeText(text) {
  if (typeof text !== 'string') return '';
  return text.trim();
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
  const branch = await branchRepo.getBranchByIdForInstallation(client, { id, installationId });
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
  const existing = await branchRepo.getBranchByIdForInstallation(client, { id, installationId });
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
    id,
    installationId,
    name: validation.normalized.name,
    address: validation.normalized.address,
    phone: validation.normalized.phone,
    email: validation.normalized.email,
    updatedBy,
    expectedUpdatedAt: expectedUpdatedAtValidation?.value ?? null,
  });

  if (!updated) {
    return {
      ok: false,
      code: 'CONFLICT',
      message: 'Branch update conflict: expectedUpdatedAt does not match current record',
      retryable: false,
    };
  }

  return { ok: true, branch: updated, beforeData: existing };
}

export async function updateBranchStatus(client, { id, installationId, isActive, updatedBy, expectedUpdatedAt }) {
  const existing = await branchRepo.getBranchByIdForInstallation(client, { id, installationId });
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
    const hasActive = await warehouseRepo.hasActiveWarehouses(client, { branchId: id, installationId });
    if (hasActive) {
      return {
        ok: false,
        code: 'CANNOT_DEACTIVATE',
        message: 'Cannot deactivate a branch that has active warehouses',
        retryable: false,
      };
    }
  }

  const updated = await branchRepo.updateBranchActiveStatus(client, {
    id,
    installationId,
    isActive,
    updatedBy,
    expectedUpdatedAt: expectedUpdatedAtValidation?.value ?? null,
  });

  if (!updated) {
    return {
      ok: false,
      code: 'CONFLICT',
      message: 'Branch status update conflict: expectedUpdatedAt does not match current record',
      retryable: false,
    };
  }

  return { ok: true, branch: updated, beforeData: existing };
}

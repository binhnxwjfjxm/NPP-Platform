import * as branchRepo from '../db/repositories/branch.js';
import * as warehouseRepo from '../db/repositories/warehouse.js';

// Trim and uppercase code for consistency
function normalizeCode(code) {
  if (typeof code !== 'string') return '';
  return code.trim().toUpperCase();
}

function normalizeText(text) {
  if (typeof text !== 'string') return '';
  return text.trim();
}

function validateEmail(email) {
  if (!email) return true; // email is optional
  // Basic sanity check, not strict RFC validation
  const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return pattern.test(email);
}

function validatePhone(phone) {
  if (!phone) return true; // phone is optional
  // Allow common phone formats: digits, spaces, dashes, plus
  const pattern = /^[0-9\s\-+()]{5,20}$/;
  return pattern.test(phone);
}

/**
 * Validate and normalize branch creation payload
 * Returns { ok: false, code, message } on error or { ok: true, normalized } on success
 */
export function validateBranchInput(payload) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, code: 'INVALID_INPUT', message: 'Branch data is required' };
  }

  const code = normalizeCode(payload.code);
  if (!code || code.length < 1 || code.length > 64) {
    return { ok: false, code: 'INVALID_CODE', message: 'Code must be 1-64 characters' };
  }

  const name = normalizeText(payload.name);
  if (!name || name.length < 1 || name.length > 256) {
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

/**
 * Create a new branch with validation and conflict check
 */
export async function createBranch(client, { installationId, payload, createdBy }) {
  const validation = validateBranchInput(payload);
  if (!validation.ok) {
    return { ok: false, code: validation.code, message: validation.message };
  }

  // Check for duplicate code
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

/**
 * Get branch by ID
 */
export async function getBranch(client, { id }) {
  const branch = await branchRepo.getBranchById(client, { id });
  if (!branch) {
    return { ok: false, code: 'NOT_FOUND', message: 'Branch not found' };
  }
  return { ok: true, branch };
}

/**
 * List branches for installation
 */
export async function listBranches(client, { installationId, active, limit, offset }) {
  const branches = await branchRepo.listBranchesForInstallation(client, { installationId, active, limit, offset });
  return { ok: true, branches };
}

/**
 * Update branch details
 */
export async function updateBranch(client, { id, installationId, payload, updatedBy }) {
  // First check if branch exists
  const existing = await branchRepo.getBranchById(client, { id });
  if (!existing) {
    return { ok: false, code: 'NOT_FOUND', message: 'Branch not found' };
  }

  // Validate input - only name, address, phone, email can be updated
  const validation = validateBranchInput({ code: existing.code, ...payload });
  if (!validation.ok) {
    return { ok: false, code: validation.code, message: validation.message };
  }

  const updated = await branchRepo.updateBranch(client, {
    id,
    installationId,
    name: validation.normalized.name,
    address: validation.normalized.address,
    phone: validation.normalized.phone,
    email: validation.normalized.email,
    updatedBy,
  });

  return { ok: true, branch: updated };
}

/**
 * Activate/deactivate a branch
 * Cannot deactivate if there are active warehouses
 */
export async function updateBranchStatus(client, { id, installationId, isActive, updatedBy }) {
  const existing = await branchRepo.getBranchById(client, { id });
  if (!existing) {
    return { ok: false, code: 'NOT_FOUND', message: 'Branch not found' };
  }

  if (existing.is_active === isActive) {
    return { ok: true, branch: existing };
  }

  // If deactivating, check for active warehouses
  if (!isActive) {
    const hasActive = await warehouseRepo.hasActiveWarehouses(client, { branchId: id });
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
  });

  return { ok: true, branch: updated };
}

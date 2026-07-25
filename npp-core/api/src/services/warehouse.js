import * as warehouseRepo from '../db/repositories/warehouse.js';
import * as branchRepo from '../db/repositories/branch.js';
import * as locationRepo from '../db/repositories/location.js';

const WAREHOUSE_TYPES = Object.freeze(['main', 'distribution', 'vehicle', 'quarantine', 'returns', 'transit', 'other']);
const CODE_PATTERN = /^[A-Z0-9_-]{1,64}$/;

function normalizeCode(code) {
  if (typeof code !== 'string') return '';
  return code.trim().toUpperCase();
}

function normalizeText(text) {
  if (typeof text !== 'string') return '';
  return text.trim();
}

function validateExpectedUpdatedAt(value) {
  if (value === undefined || value === null) {
    return { ok: false, code: 'MISSING_EXPECTED_UPDATED_AT', message: 'expectedUpdatedAt is required' };
  }
  if (typeof value !== 'string' || !value.trim()) {
    return { ok: false, code: 'INVALID_EXPECTED_UPDATED_AT', message: 'expectedUpdatedAt must be a non-empty string' };
  }
  return { ok: true, value: value.trim() };
}

function isValidWarehouseType(type) {
  return typeof type === 'string' && WAREHOUSE_TYPES.includes(type);
}

export function validateWarehouseInput(payload, { allowBranchIdUpdate = false } = {}) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, code: 'INVALID_INPUT', message: 'Warehouse data is required' };
  }

  if (allowBranchIdUpdate) {
    if (!payload.branchId || typeof payload.branchId !== 'string' || !payload.branchId.trim()) {
      return { ok: false, code: 'INVALID_BRANCH_ID', message: 'Branch ID is required' };
    }
  }

  const code = normalizeCode(payload.code);
  if (!CODE_PATTERN.test(code)) {
    return { ok: false, code: 'INVALID_CODE', message: 'Code must be 1-64 characters and contain only uppercase letters, digits, hyphens, or underscores' };
  }

  const name = normalizeText(payload.name);
  if (!name || name.length > 256) {
    return { ok: false, code: 'INVALID_NAME', message: 'Name is required and must be 1-256 characters' };
  }

  if (!isValidWarehouseType(payload.warehouseType)) {
    return { ok: false, code: 'INVALID_TYPE', message: `Warehouse type must be one of: ${WAREHOUSE_TYPES.join(', ')}` };
  }

  return {
    ok: true,
    normalized: {
      code,
      name,
      warehouseType: payload.warehouseType,
      branchId: payload.branchId ? payload.branchId.trim() : undefined,
    },
  };
}

export async function createWarehouse(client, { installationId, payload, createdBy }) {
  const validation = validateWarehouseInput(payload, { allowBranchIdUpdate: true });
  if (!validation.ok) return { ok: false, code: validation.code, message: validation.message };

  const branch = await branchRepo.getBranchByIdForInstallation(client, { id: validation.normalized.branchId, installationId });
  if (!branch) {
    return { ok: false, code: 'BRANCH_NOT_FOUND', message: 'Branch not found or does not belong to this installation' };
  }

  if (!branch.is_active) {
    return { ok: false, code: 'BRANCH_INACTIVE', message: 'Cannot create warehouse under inactive branch' };
  }

  const existing = await warehouseRepo.getWarehouseByCode(client, { installationId, code: validation.normalized.code });
  if (existing) return { ok: false, code: 'DUPLICATE_CODE', message: 'A warehouse with this code already exists', retryable: false };

  const warehouse = await warehouseRepo.insertWarehouse(client, {
    installationId,
    branchId: validation.normalized.branchId,
    code: validation.normalized.code,
    name: validation.normalized.name,
    warehouseType: validation.normalized.warehouseType,
    createdBy,
  });

  return { ok: true, warehouse };
}

export async function getWarehouse(client, { installationId, id }) {
  const warehouse = await warehouseRepo.getWarehouseByIdForInstallation(client, { id, installationId });
  if (!warehouse) return { ok: false, code: 'NOT_FOUND', message: 'Warehouse not found' };
  return { ok: true, warehouse };
}

export async function listWarehouses(client, { installationId, branchId, active, limit, offset }) {
  if (branchId) {
    const branch = await branchRepo.getBranchByIdForInstallation(client, { id: branchId, installationId });
    if (!branch) return { ok: false, code: 'NOT_FOUND', message: 'Branch not found' };

    const warehouses = await warehouseRepo.listWarehousesForBranch(client, {
      branchId,
      installationId,
      active,
      limit,
      offset,
    });
    return { ok: true, warehouses };
  }

  const warehouses = await warehouseRepo.listWarehousesForInstallation(client, { installationId, active, limit, offset });
  return { ok: true, warehouses };
}

export async function updateWarehouse(client, { id, installationId, payload, updatedBy }) {
  const existing = await warehouseRepo.getWarehouseByIdForInstallation(client, { id, installationId });
  if (!existing) return { ok: false, code: 'NOT_FOUND', message: 'Warehouse not found' };

  const validation = validateWarehouseInput({ code: existing.code, branchId: existing.branch_id, ...payload });
  if (!validation.ok) return { ok: false, code: validation.code, message: validation.message };

  const expectedUpdatedAtValidation = validateExpectedUpdatedAt(payload.expectedUpdatedAt);
  if (expectedUpdatedAtValidation && !expectedUpdatedAtValidation.ok) {
    return { ok: false, code: expectedUpdatedAtValidation.code, message: expectedUpdatedAtValidation.message };
  }

  const updated = await warehouseRepo.updateWarehouse(client, {
    id,
    installationId,
    name: validation.normalized.name,
    warehouseType: validation.normalized.warehouseType,
    updatedBy,
    expectedUpdatedAt: expectedUpdatedAtValidation?.value ?? null,
  });

  if (!updated) {
    return { ok: false, code: 'CONFLICT', message: 'Warehouse update conflict: expectedUpdatedAt does not match current record', retryable: false };
  }

  return { ok: true, warehouse: updated, beforeData: existing };
}

export async function updateWarehouseStatus(client, { id, installationId, isActive, updatedBy, expectedUpdatedAt }) {
  const existing = await warehouseRepo.getWarehouseByIdForInstallation(client, { id, installationId });
  if (!existing) return { ok: false, code: 'NOT_FOUND', message: 'Warehouse not found' };

  const expectedUpdatedAtValidation = validateExpectedUpdatedAt(expectedUpdatedAt);
  if (expectedUpdatedAtValidation && !expectedUpdatedAtValidation.ok) {
    return { ok: false, code: expectedUpdatedAtValidation.code, message: expectedUpdatedAtValidation.message };
  }

  if (typeof isActive !== 'boolean') {
    return { ok: false, code: 'INVALID_ACTIVE_STATUS', message: 'isActive must be a boolean' };
  }

  if (existing.is_active === isActive) {
    return { ok: true, warehouse: existing, beforeData: existing };
  }

  if (!isActive) {
    const hasActive = await locationRepo.hasActiveLocations(client, { warehouseId: id, installationId });
    if (hasActive) {
      return { ok: false, code: 'CANNOT_DEACTIVATE', message: 'Cannot deactivate a warehouse that has active locations', retryable: false };
    }
  }

  const updated = await warehouseRepo.updateWarehouseActiveStatus(client, {
    id,
    installationId,
    isActive,
    updatedBy,
    expectedUpdatedAt: expectedUpdatedAtValidation?.value ?? null,
  });

  if (!updated) {
    return { ok: false, code: 'CONFLICT', message: 'Warehouse status update conflict: expectedUpdatedAt does not match current record', retryable: false };
  }

  return { ok: true, warehouse: updated, beforeData: existing };
}

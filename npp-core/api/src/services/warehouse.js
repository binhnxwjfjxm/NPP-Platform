import * as warehouseRepo from '../db/repositories/warehouse.js';
import * as branchRepo from '../db/repositories/branch.js';
import * as locationRepo from '../db/repositories/location.js';

// Warehouse types are strictly defined
const WAREHOUSE_TYPES = Object.freeze(['main', 'distribution', 'vehicle', 'quarantine', 'returns', 'transit', 'other']);

// Trim and uppercase code for consistency
function normalizeCode(code) {
  if (typeof code !== 'string') return '';
  return code.trim().toUpperCase();
}

function normalizeText(text) {
  if (typeof text !== 'string') return '';
  return text.trim();
}

function isValidWarehouseType(type) {
  return typeof type === 'string' && WAREHOUSE_TYPES.includes(type);
}

/**
 * Validate and normalize warehouse creation payload
 */
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
  if (!code || code.length < 1 || code.length > 64) {
    return { ok: false, code: 'INVALID_CODE', message: 'Code must be 1-64 characters' };
  }

  const name = normalizeText(payload.name);
  if (!name || name.length < 1 || name.length > 256) {
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

/**
 * Create a new warehouse with validation and conflict check
 */
export async function createWarehouse(client, { installationId, payload, createdBy }) {
  const validation = validateWarehouseInput(payload, { allowBranchIdUpdate: true });
  if (!validation.ok) {
    return { ok: false, code: validation.code, message: validation.message };
  }

  // Verify branch exists and belongs to installation
  const branch = await branchRepo.getBranchById(client, { id: validation.normalized.branchId });
  if (!branch || branch.installation_id !== installationId) {
    return { ok: false, code: 'BRANCH_NOT_FOUND', message: 'Branch not found or does not belong to this installation' };
  }

  // Verify branch is active
  if (!branch.is_active) {
    return { ok: false, code: 'BRANCH_INACTIVE', message: 'Cannot create warehouse under inactive branch' };
  }

  // Check for duplicate code
  const existing = await warehouseRepo.getWarehouseByCode(client, { installationId, code: validation.normalized.code });
  if (existing) {
    return { ok: false, code: 'DUPLICATE_CODE', message: 'A warehouse with this code already exists', retryable: false };
  }

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

/**
 * Get warehouse by ID
 */
export async function getWarehouse(client, { id }) {
  const warehouse = await warehouseRepo.getWarehouseById(client, { id });
  if (!warehouse) {
    return { ok: false, code: 'NOT_FOUND', message: 'Warehouse not found' };
  }
  return { ok: true, warehouse };
}

/**
 * List warehouses for installation
 */
export async function listWarehouses(client, { installationId, branchId, active, limit, offset }) {
  let warehouses;
  if (branchId) {
    warehouses = await warehouseRepo.listWarehousesForBranch(client, { branchId, active, limit, offset });
  } else {
    warehouses = await warehouseRepo.listWarehousesForInstallation(client, { installationId, active, limit, offset });
  }
  return { ok: true, warehouses };
}

/**
 * Update warehouse details
 */
export async function updateWarehouse(client, { id, installationId, payload, updatedBy }) {
  // First check if warehouse exists
  const existing = await warehouseRepo.getWarehouseById(client, { id });
  if (!existing || existing.installation_id !== installationId) {
    return { ok: false, code: 'NOT_FOUND', message: 'Warehouse not found' };
  }

  // Validate input - only name and warehouseType can be updated
  const validation = validateWarehouseInput({ code: existing.code, branchId: existing.branch_id, ...payload });
  if (!validation.ok) {
    return { ok: false, code: validation.code, message: validation.message };
  }

  const updated = await warehouseRepo.updateWarehouse(client, {
    id,
    installationId,
    name: validation.normalized.name,
    warehouseType: validation.normalized.warehouseType,
    updatedBy,
  });

  return { ok: true, warehouse: updated };
}

/**
 * Activate/deactivate a warehouse
 * Cannot deactivate if there are active locations
 */
export async function updateWarehouseStatus(client, { id, installationId, isActive, updatedBy }) {
  const existing = await warehouseRepo.getWarehouseById(client, { id });
  if (!existing || existing.installation_id !== installationId) {
    return { ok: false, code: 'NOT_FOUND', message: 'Warehouse not found' };
  }

  if (existing.is_active === isActive) {
    return { ok: true, warehouse: existing };
  }

  // If deactivating, check for active locations
  if (!isActive) {
    const hasActive = await locationRepo.hasActiveLocations(client, { warehouseId: id });
    if (hasActive) {
      return {
        ok: false,
        code: 'CANNOT_DEACTIVATE',
        message: 'Cannot deactivate a warehouse that has active locations',
        retryable: false,
      };
    }
  }

  const updated = await warehouseRepo.updateWarehouseActiveStatus(client, {
    id,
    installationId,
    isActive,
    updatedBy,
  });

  return { ok: true, warehouse: updated };
}

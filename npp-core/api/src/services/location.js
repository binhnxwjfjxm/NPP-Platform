import * as locationRepo from '../db/repositories/location.js';
import * as warehouseRepo from '../db/repositories/warehouse.js';

// Location types are strictly defined
const LOCATION_TYPES = Object.freeze(['storage', 'receiving', 'shipping', 'quarantine', 'returns', 'damaged', 'other']);

// Trim and uppercase code for consistency
function normalizeCode(code) {
  if (typeof code !== 'string') return '';
  return code.trim().toUpperCase();
}

function normalizeText(text) {
  if (typeof text !== 'string') return '';
  return text.trim();
}

function isValidLocationType(type) {
  return typeof type === 'string' && LOCATION_TYPES.includes(type);
}

/**
 * Validate and normalize warehouse location creation payload
 */
export function validateLocationInput(payload, { allowWarehouseIdUpdate = false } = {}) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, code: 'INVALID_INPUT', message: 'Location data is required' };
  }

  if (allowWarehouseIdUpdate) {
    if (!payload.warehouseId || typeof payload.warehouseId !== 'string' || !payload.warehouseId.trim()) {
      return { ok: false, code: 'INVALID_WAREHOUSE_ID', message: 'Warehouse ID is required' };
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

  if (!isValidLocationType(payload.locationType)) {
    return { ok: false, code: 'INVALID_TYPE', message: `Location type must be one of: ${LOCATION_TYPES.join(', ')}` };
  }

  return {
    ok: true,
    normalized: {
      code,
      name,
      locationType: payload.locationType,
      warehouseId: payload.warehouseId ? payload.warehouseId.trim() : undefined,
    },
  };
}

/**
 * Create a new warehouse location with validation and conflict check
 */
export async function createWarehouseLocation(client, { installationId, payload, createdBy }) {
  const validation = validateLocationInput(payload, { allowWarehouseIdUpdate: true });
  if (!validation.ok) {
    return { ok: false, code: validation.code, message: validation.message };
  }

  // Verify warehouse exists and belongs to installation
  const warehouse = await warehouseRepo.getWarehouseById(client, { id: validation.normalized.warehouseId });
  if (!warehouse || warehouse.installation_id !== installationId) {
    return { ok: false, code: 'WAREHOUSE_NOT_FOUND', message: 'Warehouse not found or does not belong to this installation' };
  }

  // Verify warehouse is active
  if (!warehouse.is_active) {
    return { ok: false, code: 'WAREHOUSE_INACTIVE', message: 'Cannot create location under inactive warehouse' };
  }

  // Check for duplicate code within this warehouse
  const existing = await locationRepo.getWarehouseLocationByCode(client, { warehouseId: validation.normalized.warehouseId, code: validation.normalized.code });
  if (existing) {
    return { ok: false, code: 'DUPLICATE_CODE', message: 'A location with this code already exists in this warehouse', retryable: false };
  }

  const location = await locationRepo.insertWarehouseLocation(client, {
    installationId,
    warehouseId: validation.normalized.warehouseId,
    code: validation.normalized.code,
    name: validation.normalized.name,
    locationType: validation.normalized.locationType,
    createdBy,
  });

  return { ok: true, location };
}

/**
 * Get warehouse location by ID
 */
export async function getWarehouseLocation(client, { id }) {
  const location = await locationRepo.getWarehouseLocationById(client, { id });
  if (!location) {
    return { ok: false, code: 'NOT_FOUND', message: 'Location not found' };
  }
  return { ok: true, location };
}

/**
 * List warehouse locations
 */
export async function listWarehouseLocations(client, { installationId, warehouseId, active, limit, offset }) {
  let locations;
  if (warehouseId) {
    locations = await locationRepo.listWarehouseLocationsForWarehouse(client, { warehouseId, active, limit, offset });
  } else {
    locations = await locationRepo.listWarehouseLocationsForInstallation(client, { installationId, active, limit, offset });
  }
  return { ok: true, locations };
}

/**
 * Update warehouse location details
 */
export async function updateWarehouseLocation(client, { id, installationId, payload, updatedBy }) {
  // First check if location exists
  const existing = await locationRepo.getWarehouseLocationById(client, { id });
  if (!existing || existing.installation_id !== installationId) {
    return { ok: false, code: 'NOT_FOUND', message: 'Location not found' };
  }

  // Validate input - only name and locationType can be updated
  const validation = validateLocationInput({ code: existing.code, warehouseId: existing.warehouse_id, ...payload });
  if (!validation.ok) {
    return { ok: false, code: validation.code, message: validation.message };
  }

  const updated = await locationRepo.updateWarehouseLocation(client, {
    id,
    installationId,
    name: validation.normalized.name,
    locationType: validation.normalized.locationType,
    updatedBy,
  });

  return { ok: true, location: updated };
}

/**
 * Activate/deactivate a warehouse location
 */
export async function updateWarehouseLocationStatus(client, { id, installationId, isActive, updatedBy }) {
  const existing = await locationRepo.getWarehouseLocationById(client, { id });
  if (!existing || existing.installation_id !== installationId) {
    return { ok: false, code: 'NOT_FOUND', message: 'Location not found' };
  }

  if (existing.is_active === isActive) {
    return { ok: true, location: existing };
  }

  const updated = await locationRepo.updateWarehouseLocationActiveStatus(client, {
    id,
    installationId,
    isActive,
    updatedBy,
  });

  return { ok: true, location: updated };
}

import * as locationRepo from '../db/repositories/location.js';
import * as warehouseRepo from '../db/repositories/warehouse.js';
import { domainConflict, staleVersionConflict } from './deactivate-conflict-contract.js';

const LOCATION_TYPES = Object.freeze(['storage', 'receiving', 'shipping', 'quarantine', 'returns', 'damaged', 'other']);
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

function isValidLocationType(type) {
  return typeof type === 'string' && LOCATION_TYPES.includes(type);
}

export function validateLocationInput(payload, { allowWarehouseIdUpdate = false } = {}) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, code: 'INVALID_INPUT', message: 'Location data is required' };
  }

  if (allowWarehouseIdUpdate) {
    if (!validateEntityId(payload.warehouseId)) {
      return { ok: false, code: 'INVALID_WAREHOUSE_ID', message: 'Warehouse ID must be a valid UUID' };
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

export async function createWarehouseLocation(client, { installationId, payload, createdBy }) {
  const validation = validateLocationInput(payload, { allowWarehouseIdUpdate: true });
  if (!validation.ok) return { ok: false, code: validation.code, message: validation.message };

  const warehouse = await warehouseRepo.getWarehouseByIdForInstallationForShare(client, {
    id: validation.normalized.warehouseId,
    installationId,
  });
  if (!warehouse) {
    return { ok: false, code: 'WAREHOUSE_NOT_FOUND', message: 'Warehouse not found or does not belong to this installation' };
  }

  if (!warehouse.is_active) {
    return { ok: false, code: 'WAREHOUSE_INACTIVE', message: 'Cannot create location under inactive warehouse' };
  }

  const existing = await locationRepo.getWarehouseLocationByCode(client, {
    warehouseId: validation.normalized.warehouseId,
    code: validation.normalized.code,
  });
  if (existing) return { ok: false, code: 'DUPLICATE_CODE', message: 'A location with this code already exists in this warehouse', retryable: false };

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

export async function getWarehouseLocation(client, { installationId, id }) {
  if (!validateEntityId(id)) {
    return { ok: false, code: 'NOT_FOUND', message: 'Location not found' };
  }

  const location = await locationRepo.getWarehouseLocationByIdForInstallation(client, { id: id.trim(), installationId });
  if (!location) return { ok: false, code: 'NOT_FOUND', message: 'Location not found' };
  return { ok: true, location };
}

export async function listWarehouseLocations(client, { installationId, warehouseId, active, limit, offset }) {
  if (warehouseId) {
    if (!validateEntityId(warehouseId)) {
      return { ok: false, code: 'INVALID_WAREHOUSE_ID', message: 'Warehouse ID must be a valid UUID' };
    }

    const normalizedWarehouseId = warehouseId.trim();
    const warehouse = await warehouseRepo.getWarehouseByIdForInstallation(client, { id: normalizedWarehouseId, installationId });
    if (!warehouse) return { ok: false, code: 'NOT_FOUND', message: 'Warehouse not found' };

    const locations = await locationRepo.listWarehouseLocationsForWarehouse(client, {
      warehouseId: normalizedWarehouseId,
      installationId,
      active,
      limit,
      offset,
    });
    return { ok: true, locations };
  }

  const locations = await locationRepo.listWarehouseLocationsForInstallation(client, { installationId, active, limit, offset });
  return { ok: true, locations };
}

export async function updateWarehouseLocation(client, { id, installationId, payload, updatedBy }) {
  if (!validateEntityId(id)) {
    return { ok: false, code: 'INVALID_ID', message: 'Location ID must be a valid UUID' };
  }

  const normalizedId = id.trim();
  const existing = await locationRepo.getWarehouseLocationByIdForInstallation(client, { id: normalizedId, installationId });
  if (!existing) return { ok: false, code: 'NOT_FOUND', message: 'Location not found' };

  const validation = validateLocationInput({ code: existing.code, warehouseId: existing.warehouse_id, ...payload });
  if (!validation.ok) return { ok: false, code: validation.code, message: validation.message };

  const expectedUpdatedAtValidation = validateExpectedUpdatedAt(payload.expectedUpdatedAt);
  if (expectedUpdatedAtValidation && !expectedUpdatedAtValidation.ok) {
    return { ok: false, code: expectedUpdatedAtValidation.code, message: expectedUpdatedAtValidation.message };
  }

  const updated = await locationRepo.updateWarehouseLocation(client, {
    id: normalizedId,
    installationId,
    name: validation.normalized.name,
    locationType: validation.normalized.locationType,
    updatedBy,
    expectedUpdatedAt: expectedUpdatedAtValidation?.value ?? null,
  });

  if (!updated) {
    return staleVersionConflict({ entityLabel: 'Vị trí kho', managementPath: '/organization/locations' });
  }

  return { ok: true, location: updated, beforeData: existing };
}

export async function updateWarehouseLocationStatus(client, { id, installationId, isActive, updatedBy, expectedUpdatedAt }) {
  if (!validateEntityId(id)) {
    return { ok: false, code: 'INVALID_ID', message: 'Location ID must be a valid UUID' };
  }

  const normalizedId = id.trim();
  const existing = await locationRepo.getWarehouseLocationByIdForInstallation(client, { id: normalizedId, installationId });
  if (!existing) return { ok: false, code: 'NOT_FOUND', message: 'Location not found' };

  const expectedUpdatedAtValidation = validateExpectedUpdatedAt(expectedUpdatedAt);
  if (expectedUpdatedAtValidation && !expectedUpdatedAtValidation.ok) {
    return { ok: false, code: expectedUpdatedAtValidation.code, message: expectedUpdatedAtValidation.message };
  }

  if (typeof isActive !== 'boolean') {
    return { ok: false, code: 'INVALID_ACTIVE_STATUS', message: 'isActive must be a boolean' };
  }

  if (existing.is_active === isActive) {
    return { ok: true, location: existing, beforeData: existing };
  }

  if (isActive) {
    const warehouse = await warehouseRepo.getWarehouseByIdForInstallationForShare(client, {
      id: existing.warehouse_id,
      installationId,
    });
    if (!warehouse?.is_active) {
      return domainConflict({ message: 'Không thể kích hoạt vị trí kho khi kho cha đang ngưng hoạt động. Hãy kích hoạt kho trước rồi thử lại.', reason: 'PARENT_WAREHOUSE_INACTIVE', managementPath: '/organization/warehouses' });
    }
  }

  const updated = await locationRepo.updateWarehouseLocationActiveStatus(client, {
    id: normalizedId,
    installationId,
    isActive,
    updatedBy,
    expectedUpdatedAt: expectedUpdatedAtValidation?.value ?? null,
  });

  if (!updated) {
    return staleVersionConflict({ entityLabel: 'Vị trí kho', managementPath: '/organization/locations' });
  }

  return { ok: true, location: updated, beforeData: existing };
}

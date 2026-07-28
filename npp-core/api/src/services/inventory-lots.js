import { randomUUID } from 'node:crypto';
import { PERMISSIONS } from '../access/permissions.js';
import * as repository from '../db/repositories/inventory-lots.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOT_CODE_PATTERN = /^[A-Z0-9_.-]{1,100}$/;
const LOT_TRACKING_MODES = new Set(['NONE', 'REQUIRED']);
const EXPIRY_TRACKING_MODES = new Set(['NONE', 'OPTIONAL', 'REQUIRED']);

function failure(code, message, retryable = false) {
  return Object.freeze({ ok: false, code, message, retryable });
}

function hasPermission(requestContext, permission) {
  return Array.isArray(requestContext?.permissions)
    && requestContext.permissions.includes(permission);
}

function text(value, maxLength = 0) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  if (!normalized || (maxLength > 0 && normalized.length > maxLength)) return null;
  return normalized;
}

function strictDate(value) {
  const normalized = text(value, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized ?? '');
  if (!match) return null;
  const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (parsed.getUTCFullYear() !== Number(match[1])
    || parsed.getUTCMonth() !== Number(match[2]) - 1
    || parsed.getUTCDate() !== Number(match[3])) return null;
  return normalized;
}

function canonicalDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    const year = String(value.getFullYear()).padStart(4, '0');
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  const normalized = strictDate(value);
  return normalized ?? null;
}

function normalizeLotCode(value) {
  const normalized = text(value, 100)?.toUpperCase() ?? null;
  if (!normalized || !LOT_CODE_PATTERN.test(normalized)) {
    return failure('INVALID_LOT_CODE', 'lotCode must be 1-100 safe uppercase characters');
  }
  return Object.freeze({ ok: true, value: normalized });
}

function normalizeTrackingPolicyInput(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return failure('INVALID_INPUT', 'Tracking policy payload is required');
  }

  const lotTrackingMode = String(payload.lotTrackingMode ?? '').trim().toUpperCase();
  const expiryTrackingMode = String(payload.expiryTrackingMode ?? '').trim().toUpperCase();
  const locationRequired = Boolean(payload.locationRequired);
  const expectedVersion = payload.expectedVersion === undefined || payload.expectedVersion === null || payload.expectedVersion === ''
    ? null
    : Number(payload.expectedVersion);

  if (!UUID_PATTERN.test(String(payload.baseVariantId ?? ''))) {
    return failure('INVALID_BASE_VARIANT_ID', 'baseVariantId is invalid UUID');
  }
  if (!LOT_TRACKING_MODES.has(lotTrackingMode)) {
    return failure('INVALID_TRACKING_MODE', 'lotTrackingMode must be NONE or REQUIRED');
  }
  if (!EXPIRY_TRACKING_MODES.has(expiryTrackingMode)) {
    return failure('INVALID_TRACKING_MODE', 'expiryTrackingMode must be NONE, OPTIONAL or REQUIRED');
  }
  if (expiryTrackingMode !== 'NONE' && lotTrackingMode !== 'REQUIRED') {
    return failure('TRACKING_POLICY_CONFLICT', 'expiryTrackingMode other than NONE requires lotTrackingMode = REQUIRED');
  }
  if (expectedVersion !== null && (!Number.isInteger(expectedVersion) || expectedVersion < 1)) {
    return failure('INVALID_EXPECTED_VERSION', 'expectedVersion must be a positive integer');
  }

  return Object.freeze({
    ok: true,
    value: Object.freeze({
      baseVariantId: payload.baseVariantId,
      lotTrackingMode,
      expiryTrackingMode,
      locationRequired,
      expectedVersion,
      metadata: typeof payload.metadata === 'object' && payload.metadata && !Array.isArray(payload.metadata) ? payload.metadata : {},
    }),
  });
}

function normalizeLotInput(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return failure('INVALID_INPUT', 'Lot payload is required');
  }
  if (!UUID_PATTERN.test(String(payload.baseVariantId ?? ''))) {
    return failure('INVALID_BASE_VARIANT_ID', 'baseVariantId is invalid UUID');
  }

  const lotCode = normalizeLotCode(payload.lotCode);
  if (!lotCode.ok) return lotCode;

  const lotId = payload.lotId === undefined || payload.lotId === null || payload.lotId === ''
    ? null
    : String(payload.lotId);
  if (lotId && !UUID_PATTERN.test(lotId)) {
    return failure('INVALID_LOT_ID', 'lotId is invalid UUID');
  }

  const expiryDate = payload.expiryDate === undefined || payload.expiryDate === null || payload.expiryDate === ''
    ? null
    : strictDate(payload.expiryDate);
  if (payload.expiryDate !== undefined && payload.expiryDate !== null && payload.expiryDate !== '' && !expiryDate) {
    return failure('INVALID_EXPIRY_DATE', 'expiryDate must be a valid YYYY-MM-DD date');
  }

  const manufacturedDate = payload.manufacturedDate === undefined || payload.manufacturedDate === null || payload.manufacturedDate === ''
    ? null
    : strictDate(payload.manufacturedDate);
  if (payload.manufacturedDate !== undefined && payload.manufacturedDate !== null && payload.manufacturedDate !== '' && !manufacturedDate) {
    return failure('INVALID_MANUFACTURED_DATE', 'manufacturedDate must be a valid YYYY-MM-DD date');
  }

  return Object.freeze({
    ok: true,
    value: Object.freeze({
      baseVariantId: payload.baseVariantId,
      lotId,
      lotCode: lotCode.value,
      normalizedLotCode: lotCode.value,
      manufacturedDate,
      expiryDate,
      supplierLotReference: text(payload.supplierLotReference, 160),
      metadata: typeof payload.metadata === 'object' && payload.metadata && !Array.isArray(payload.metadata) ? payload.metadata : {},
    }),
  });
}

function validatePolicyScope(policy, next) {
  if (!policy) return null;
  const loosensLotTracking = policy.lot_tracking_mode === 'REQUIRED' && next.lotTrackingMode === 'NONE';
  const loosensExpiryTracking = policy.expiry_tracking_mode === 'REQUIRED' && next.expiryTrackingMode === 'NONE';
  return { loosensLotTracking, loosensExpiryTracking };
}

export async function listInventoryTrackingPolicies(client, {
  requestContext,
  search = null,
  active = null,
  limit = 200,
  offset = 0,
}) {
  if (!hasPermission(requestContext, PERMISSIONS.coreInventoryTrackingPolicyRead)) {
    return failure('PERMISSION_DENIED', 'Permission core.inventory.tracking-policy.read is required');
  }
  const rows = await repository.listTrackingPolicies(client, {
    installationId: requestContext.installationId,
    search,
    active,
    limit,
    offset,
  });
  return Object.freeze({ ok: true, policies: Object.freeze(rows) });
}

export async function getInventoryTrackingPolicy(client, { requestContext, baseVariantId }) {
  if (!hasPermission(requestContext, PERMISSIONS.coreInventoryTrackingPolicyRead)) {
    return failure('PERMISSION_DENIED', 'Permission core.inventory.tracking-policy.read is required');
  }
  if (!UUID_PATTERN.test(String(baseVariantId ?? ''))) {
    return failure('INVALID_BASE_VARIANT_ID', 'baseVariantId is invalid UUID');
  }
  const policy = await repository.getTrackingPolicyByBaseVariant(client, {
    installationId: requestContext.installationId,
    baseVariantId,
  });
  return policy
    ? Object.freeze({ ok: true, policy })
    : failure('TRACKING_POLICY_NOT_FOUND', 'Tracking policy was not found');
}

export async function upsertInventoryTrackingPolicy(client, { requestContext, payload }) {
  if (!hasPermission(requestContext, PERMISSIONS.coreInventoryTrackingPolicyManage)) {
    return failure('PERMISSION_DENIED', 'Permission core.inventory.tracking-policy.manage is required');
  }
  const normalized = normalizeTrackingPolicyInput(payload);
  if (!normalized.ok) return normalized;

  const baseVariant = await repository.resolveInventoryBaseVariant(client, {
    installationId: requestContext.installationId,
    baseVariantId: normalized.value.baseVariantId,
  });
  if (!baseVariant) return failure('BASE_VARIANT_NOT_FOUND', 'Inventory base SKU was not found');
  if (!baseVariant.is_inventory_base || !baseVariant.base_variant_active) {
    return failure('BASE_VARIANT_NOT_AVAILABLE', 'Inventory base SKU is missing, inactive or invalid');
  }

  const current = await repository.getTrackingPolicyByBaseVariant(client, {
    installationId: requestContext.installationId,
    baseVariantId: normalized.value.baseVariantId,
  });
  if (!current) {
    const created = await repository.insertTrackingPolicy(client, {
      installationId: requestContext.installationId,
      baseVariantId: normalized.value.baseVariantId,
      lotTrackingMode: normalized.value.lotTrackingMode,
      expiryTrackingMode: normalized.value.expiryTrackingMode,
      locationRequired: normalized.value.locationRequired,
      version: 1,
      createdAt: requestContext.receivedAt ?? new Date().toISOString(),
      createdBy: requestContext.actorId,
      updatedAt: requestContext.receivedAt ?? new Date().toISOString(),
      updatedBy: requestContext.actorId,
    });
    return Object.freeze({ ok: true, policy: created, replayed: false });
  }

  const version = Number(current.version ?? 0);
  if (!Number.isInteger(version) || version < 1) {
    return failure('TRACKING_POLICY_CONFLICT', 'Tracking policy version is invalid');
  }
  if (normalized.value.expectedVersion === null) {
    return failure('TRACKING_POLICY_CONFLICT', 'expectedVersion is required for policy updates');
  }
  if (normalized.value.expectedVersion !== version) {
    return failure('TRACKING_POLICY_CONFLICT', 'Tracking policy was modified by another request');
  }

  const changeScope = validatePolicyScope(current, normalized.value);
  if (changeScope?.loosensLotTracking || changeScope?.loosensExpiryTracking) {
    const usage = await repository.countLotUsage(client, {
      installationId: requestContext.installationId,
      baseVariantId: normalized.value.baseVariantId,
    });
    if (changeScope.loosensLotTracking && (Number(usage.lot_rows) > 0 || Number(usage.movement_rows) > 0 || Number(usage.reservation_rows) > 0)) {
      return failure('TRACKING_POLICY_CONFLICT', 'Lot tracking cannot be relaxed after lot-scoped data exists');
    }
    if (changeScope.loosensExpiryTracking && Number(usage.expiring_lot_rows) > 0) {
      return failure('TRACKING_POLICY_CONFLICT', 'Expiry tracking cannot be removed after canonical expiry exists');
    }
  }

  const updated = await repository.updateTrackingPolicy(client, {
    installationId: requestContext.installationId,
    baseVariantId: normalized.value.baseVariantId,
    lotTrackingMode: normalized.value.lotTrackingMode,
    expiryTrackingMode: normalized.value.expiryTrackingMode,
    locationRequired: normalized.value.locationRequired,
    expectedVersion: version,
    nextVersion: version + 1,
    updatedAt: requestContext.receivedAt ?? new Date().toISOString(),
    updatedBy: requestContext.actorId,
  });
  if (!updated) return failure('TRACKING_POLICY_CONFLICT', 'Tracking policy was modified by another request');
  return Object.freeze({ ok: true, policy: updated, replayed: false });
}

export async function listInventoryLots(client, { requestContext, search = null, baseVariantId = null, limit = 200, offset = 0 }) {
  if (!hasPermission(requestContext, PERMISSIONS.coreInventoryLotRead)) {
    return failure('PERMISSION_DENIED', 'Permission core.inventory.lot.read is required');
  }
  if (baseVariantId !== null && baseVariantId !== undefined && baseVariantId !== '' && !UUID_PATTERN.test(String(baseVariantId))) {
    return failure('INVALID_BASE_VARIANT_ID', 'baseVariantId is invalid UUID');
  }
  const rows = await repository.listInventoryLots(client, {
    installationId: requestContext.installationId,
    search,
    baseVariantId: baseVariantId || null,
    limit,
    offset,
  });
  return Object.freeze({ ok: true, lots: Object.freeze(rows) });
}

export async function getInventoryLot(client, { requestContext, id }) {
  if (!hasPermission(requestContext, PERMISSIONS.coreInventoryLotRead)) {
    return failure('PERMISSION_DENIED', 'Permission core.inventory.lot.read is required');
  }
  if (!UUID_PATTERN.test(String(id ?? ''))) {
    return failure('INVALID_LOT_ID', 'lotId is invalid UUID');
  }
  const lot = await repository.getInventoryLotById(client, {
    installationId: requestContext.installationId,
    id,
  });
  return lot ? Object.freeze({ ok: true, lot }) : failure('LOT_NOT_FOUND', 'Lot was not found');
}

export async function resolveOrCreateInventoryLot(client, {
  requestContext,
  baseVariantId,
  lotId = null,
  lotCode = null,
  manufacturedDate = null,
  expiryDate = null,
  supplierLotReference = null,
  metadata = {},
  createdBy = null,
}) {
  const policy = await repository.getTrackingPolicyByBaseVariant(client, {
    installationId: requestContext.installationId,
    baseVariantId,
  });
  if (!policy) return failure('TRACKING_POLICY_NOT_FOUND', 'Tracking policy was not found');
  if (!policy.is_inventory_base || !policy.base_variant_active) {
    return failure('BASE_VARIANT_NOT_AVAILABLE', 'Inventory base SKU is missing, inactive or invalid');
  }

  const lotCodeProvided = lotCode !== null && lotCode !== undefined && String(lotCode).trim() !== '';
  const lotIdProvided = lotId !== null && lotId !== undefined && String(lotId).trim() !== '';
  const normalizedLotCode = lotCodeProvided ? normalizeLotCode(lotCode) : null;
  if (lotCodeProvided && !normalizedLotCode?.ok) return normalizedLotCode;

  const normalizedManufacturedDate = manufacturedDate === null || manufacturedDate === undefined || manufacturedDate === ''
    ? null
    : strictDate(manufacturedDate);
  if (manufacturedDate && !normalizedManufacturedDate) return failure('INVALID_MANUFACTURED_DATE', 'manufacturedDate must be a valid YYYY-MM-DD date');

  const normalizedExpiryDate = expiryDate === null || expiryDate === undefined || expiryDate === ''
    ? null
    : strictDate(expiryDate);
  if (expiryDate && !normalizedExpiryDate) return failure('INVALID_EXPIRY_DATE', 'expiryDate must be a valid YYYY-MM-DD date');

  if (policy.lot_tracking_mode === 'NONE') {
    if (lotCodeProvided || lotIdProvided || normalizedExpiryDate || normalizedManufacturedDate || supplierLotReference) {
      return failure('LOT_NOT_ALLOWED', 'Lot data is not allowed by the active tracking policy');
    }
    return Object.freeze({
      ok: true,
      lot: null,
      policy,
      replayed: false,
      normalizedLotCode: null,
    });
  }

  if (!lotCodeProvided && !lotIdProvided) {
    return failure('LOT_REQUIRED', 'lotCode or lotId is required by the active tracking policy');
  }
  if (policy.expiry_tracking_mode === 'REQUIRED' && !normalizedExpiryDate && !lotIdProvided) {
    return failure('EXPIRY_REQUIRED', 'expiryDate is required by the active tracking policy');
  }
  const canonicalExistingLot = lotIdProvided
    ? await repository.getInventoryLotById(client, { installationId: requestContext.installationId, id: lotId })
    : null;
  if (policy.expiry_tracking_mode === 'NONE' && (normalizedExpiryDate || canonicalDate(canonicalExistingLot?.expiry_date) !== null)) {
    return failure('EXPIRY_NOT_ALLOWED', 'expiryDate is not allowed by the active tracking policy');
  }

  const existingById = canonicalExistingLot;
  if (lotIdProvided && !existingById) return failure('LOT_NOT_FOUND', 'Lot was not found');
  if (existingById && existingById.base_variant_id !== baseVariantId) {
    return failure('LOT_SKU_MISMATCH', 'Lot belongs to another SKU');
  }
  if (existingById) {
    if (lotCodeProvided && existingById.normalized_lot_code !== normalizedLotCode.value) {
      return failure('LOT_SKU_MISMATCH', 'Lot code does not match the existing lot');
    }
    const existingExpiryDate = canonicalDate(existingById.expiry_date);
    if (normalizedExpiryDate !== null && existingExpiryDate !== normalizedExpiryDate) {
      return failure('LOT_EXPIRY_MISMATCH', 'Lot expiry does not match the canonical expiry');
    }
    if (normalizedExpiryDate === null && existingExpiryDate !== null && lotCodeProvided) {
      return Object.freeze({
        ok: true,
        lot: existingById,
        policy,
        replayed: true,
        normalizedLotCode: existingById.normalized_lot_code,
      });
    }
    return Object.freeze({
      ok: true,
      lot: existingById,
      policy,
      replayed: true,
      normalizedLotCode: existingById.normalized_lot_code,
    });
  }

  const existingByIdentity = await repository.getInventoryLotByIdentity(client, {
    installationId: requestContext.installationId,
    baseVariantId,
    normalizedLotCode: normalizedLotCode.value,
  });
  if (existingByIdentity) {
    const existingExpiryDate = canonicalDate(existingByIdentity.expiry_date);
    if (normalizedExpiryDate !== null && existingExpiryDate !== normalizedExpiryDate) {
      return failure('LOT_EXPIRY_MISMATCH', 'Lot expiry does not match the canonical expiry');
    }
    if (normalizedExpiryDate === null && existingExpiryDate !== null) {
      return Object.freeze({
        ok: true,
        lot: existingByIdentity,
        policy,
        replayed: true,
        normalizedLotCode: existingByIdentity.normalized_lot_code,
      });
    }
    return Object.freeze({
      ok: true,
      lot: existingByIdentity,
      policy,
      replayed: true,
      normalizedLotCode: existingByIdentity.normalized_lot_code,
    });
  }

  const created = await repository.insertInventoryLot(client, {
    id: randomUUID(),
    installationId: requestContext.installationId,
    baseVariantId,
    lotCode: lotCodeProvided ? String(lotCode).trim() : normalizedLotCode.value,
    normalizedLotCode: normalizedLotCode.value,
    manufacturedDate: normalizedManufacturedDate,
    expiryDate: normalizedExpiryDate,
    supplierLotReference: supplierLotReference ?? null,
    metadata,
    createdAt: requestContext.receivedAt ?? new Date().toISOString(),
    createdBy: createdBy ?? requestContext.actorId,
  });
  return Object.freeze({
    ok: true,
    lot: created,
    policy,
    replayed: false,
    normalizedLotCode: normalizedLotCode.value,
  });
}

export const inventoryLotInternals = Object.freeze({
  normalizeLotCode,
  normalizeTrackingPolicyInput,
  normalizeLotInput,
  strictDate,
});

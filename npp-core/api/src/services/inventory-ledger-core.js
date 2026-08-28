import { createHash, randomUUID } from 'node:crypto';
import { IDEMPOTENCY_KEY_PATTERN } from '@npp/contracts';
import {
  buildAuditRecord,
  buildOutboxEvent,
  insertAuditRecord,
  insertOutboxEvent,
  withAuditOutboxTransaction,
} from '../audit-outbox.js';
import * as lotRepository from '../db/repositories/inventory-lots.js';
import * as repository from '../db/repositories/inventory-ledger.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DECIMAL_PATTERN = /^(?:0|[1-9]\d{0,13})(?:\.\d{1,6})?$/;
const CODE_PATTERN = /^[A-Z0-9_.-]{1,64}$/;
const SCALE_6 = 1_000_000n;
const INVENTORY_MOVEMENT_MAX_LINES = 1000;
const ENABLED_POSTING_TYPES = new Map([
  ['OPENING_BALANCE', 'IN'],
  ['MANUAL_INBOUND', 'IN'],
  ['PURCHASE_RECEIPT', 'IN'],
  ['SUPPLIER_RETURN', 'OUT'],
  ['TRANSFER_ISSUE', 'OUT'],
]);

function failure(code, message, retryable = false) {
  return Object.freeze({ ok: false, code, message, retryable });
}

function text(value, maxLength = 0) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  if (!normalized || (maxLength > 0 && normalized.length > maxLength)) return null;
  return normalized;
}

function objectValue(value, maxBytes = 16000) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    return JSON.stringify(value).length <= maxBytes ? value : null;
  } catch {
    return null;
  }
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

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function payloadHash(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function parsePositiveDecimal(value, field) {
  const normalized = typeof value === 'string' ? text(value, 32) : null;
  if (!normalized || !DECIMAL_PATTERN.test(normalized)) {
    return failure('INVALID_QUANTITY', `${field} must be a positive decimal string with at most 6 fractional digits`);
  }
  const [whole, fractional = ''] = normalized.split('.');
  const scaled = BigInt(whole) * SCALE_6 + BigInt((fractional + '000000').slice(0, 6));
  if (scaled <= 0n) return failure('INVALID_QUANTITY', `${field} must be greater than zero`);
  const formatted = `${whole}.${(fractional + '000000').slice(0, 6)}`;
  return Object.freeze({ ok: true, scaled, value: formatted });
}

function formatScale12(value) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const divisor = 1_000_000_000_000n;
  const whole = absolute / divisor;
  const fractional = String(absolute % divisor).padStart(12, '0');
  return `${negative ? '-' : ''}${whole}.${fractional}`;
}

function multiplyToBase(sourceQuantity, conversionToBase, direction) {
  const source = parsePositiveDecimal(sourceQuantity, 'sourceQuantity');
  if (!source.ok) return source;
  const conversion = parsePositiveDecimal(conversionToBase, 'conversionToBase');
  if (!conversion.ok) return conversion;
  const sign = direction === 'IN' ? 1n : direction === 'OUT' ? -1n : 0n;
  if (sign === 0n) return failure('INVALID_DIRECTION', 'direction must be IN or OUT');
  return Object.freeze({
    ok: true,
    sourceQuantity: source.value,
    conversionToBase: conversion.value,
    sourceScaled: source.scaled,
    baseQuantityDelta: formatScale12(source.scaled * conversion.scaled * sign),
  });
}

function warehouseScope(requestContext) {
  const ids = requestContext?.scopes?.warehouseIds;
  return Array.isArray(ids) ? new Set(ids.filter((id) => typeof id === 'string' && id.trim())) : new Set();
}

function validateIdentity(value, code, message) {
  return typeof value === 'string' && UUID_PATTERN.test(value) ? null : failure(code, message);
}

function normalizeLotCode(value) {
  const candidate = text(value, 100)?.toUpperCase() ?? null;
  return candidate && /^[A-Z0-9_.-]{1,100}$/.test(candidate)
    ? { ok: true, value: candidate }
    : failure('INVALID_LOT_CODE', 'lotCode must be 1-100 safe uppercase characters');
}

function normalizePostingPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return failure('INVALID_INPUT', 'Movement payload is required');
  const movementType = String(payload.movementType ?? '').trim().toUpperCase();
  const requiredDirection = ENABLED_POSTING_TYPES.get(movementType);
  if (!requiredDirection) return failure('MOVEMENT_TYPE_NOT_ENABLED', 'Movement type is not enabled in the inventory posting foundation');
  const sourceDomain = String(payload.sourceDomain ?? 'INVENTORY').trim().toUpperCase();
  if (!CODE_PATTERN.test(sourceDomain)) return failure('INVALID_SOURCE_DOMAIN', 'sourceDomain is invalid');
  const documentDate = strictDate(payload.documentDate);
  if (!documentDate) return failure('INVALID_DOCUMENT_DATE', 'documentDate must be a valid YYYY-MM-DD date');
  if (!Array.isArray(payload.lines) || payload.lines.length < 1 || payload.lines.length > INVENTORY_MOVEMENT_MAX_LINES) {
    return failure('INVALID_LINES', `Movement must contain between 1 and ${INVENTORY_MOVEMENT_MAX_LINES} lines`);
  }
  const metadata = objectValue(payload.metadata);
  if (metadata === null) return failure('INVALID_METADATA', 'metadata must be a JSON object no larger than 16 KB');
  const sourceDocumentType = text(payload.sourceDocumentType, 64)?.toUpperCase() ?? null;
  if (sourceDocumentType && !CODE_PATTERN.test(sourceDocumentType)) return failure('INVALID_SOURCE_DOCUMENT_TYPE', 'sourceDocumentType is invalid');
  const reasonCode = text(payload.reasonCode, 64)?.toUpperCase() ?? null;
  if (reasonCode && !CODE_PATTERN.test(reasonCode)) return failure('INVALID_REASON_CODE', 'reasonCode is invalid');
  const lines = [];
  for (let index = 0; index < payload.lines.length; index += 1) {
    const line = payload.lines[index];
    if (!line || typeof line !== 'object' || Array.isArray(line)) return failure('INVALID_LINE', `Line ${index + 1} is invalid`);
    const warehouseError = validateIdentity(line.warehouseId, 'INVALID_WAREHOUSE_ID', `Line ${index + 1} warehouseId is invalid`);
    if (warehouseError) return warehouseError;
    if (line.locationId !== undefined && line.locationId !== null && line.locationId !== '') {
      const locationError = validateIdentity(line.locationId, 'INVALID_LOCATION_ID', `Line ${index + 1} locationId is invalid`);
      if (locationError) return locationError;
    }
    const variantError = validateIdentity(line.sourceVariantId, 'INVALID_SOURCE_VARIANT_ID', `Line ${index + 1} sourceVariantId is invalid`);
    if (variantError) return variantError;
    const direction = String(line.direction ?? requiredDirection).trim().toUpperCase();
    if (direction !== requiredDirection) return failure('INVALID_DIRECTION', `${movementType} lines must use ${requiredDirection}`);
    const quantity = parsePositiveDecimal(line.sourceQuantity, `lines[${index}].sourceQuantity`);
    if (!quantity.ok) return quantity;
    const lineMetadata = objectValue(line.metadata);
    if (lineMetadata === null) return failure('INVALID_LINE_METADATA', `Line ${index + 1} metadata is invalid`);
    const sourceSku = text(line.sourceSku, 96)?.toUpperCase() ?? null;
    const sourceUnitCode = text(line.sourceUnitCode, 32)?.toUpperCase() ?? null;
    const baseSku = text(line.baseSku, 96)?.toUpperCase() ?? null;
    const sourceUnitId = text(line.sourceUnitId, 64);
    const baseVariantId = text(line.baseVariantId, 64);
    const trustedConversion = line.conversionToBase !== undefined && line.conversionToBase !== null && line.conversionToBase !== ''
      ? parsePositiveDecimal(line.conversionToBase, `lines[${index}].conversionToBase`)
      : null;
    if (trustedConversion && !trustedConversion.ok) return trustedConversion;
    const trustedSnapshot = sourceSku || sourceUnitId || sourceUnitCode || baseVariantId || baseSku || trustedConversion
      ? {
        sourceSku,
        sourceUnitId,
        sourceUnitCode,
        conversionToBase: trustedConversion?.value ?? null,
        baseVariantId,
        baseSku,
      }
      : null;
    const lotId = text(line.lotId, 64);
    if (lotId && !UUID_PATTERN.test(lotId)) return failure('INVALID_LOT_ID', `Line ${index + 1} lotId is invalid`);
    const lotCode = text(line.lotCode, 100);
    if (lotCode && !/^[A-Z0-9_.-]{1,100}$/i.test(lotCode)) return failure('INVALID_LOT_CODE', `Line ${index + 1} lotCode is invalid`);
    const normalizedLotCode = lotCode ? normalizeLotCode(lotCode) : null;
    if (lotCode && !normalizedLotCode.ok) return normalizedLotCode;
    lines.push(Object.freeze({
      lineNumber: index + 1,
      warehouseId: line.warehouseId,
      locationId: text(line.locationId, 64),
      sourceVariantId: line.sourceVariantId,
      direction,
      sourceQuantity: quantity.value,
      sourceLineReference: text(line.sourceLineReference, 160),
      sourceSnapshot: trustedSnapshot,
      lotId: lotId ?? null,
      lotCode: normalizedLotCode?.value ?? null,
      manufacturedDate: strictDate(line.manufacturedDate),
      expiryDate: strictDate(line.expiryDate),
      supplierLotReference: text(line.supplierLotReference, 160),
      metadata: lineMetadata,
    }));
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      movementType,
      sourceDomain,
      sourceDocumentType,
      sourceDocumentId: text(payload.sourceDocumentId, 160),
      sourceDocumentNumber: text(payload.sourceDocumentNumber, 160),
      documentDate,
      documentNumber: text(payload.documentNumber, 160),
      reasonCode,
      reasonNote: text(payload.reasonNote, 2000),
      metadata,
      lines: Object.freeze(lines),
    }),
  });
}

async function replayOrMismatch(client, { installationId, idempotencyKey, hash }) {
  const existing = await repository.getMovementByIdempotencyKey(client, { installationId, idempotencyKey });
  if (!existing) return null;
  if (existing.payload_hash !== hash) return failure('IDEMPOTENCY_PAYLOAD_MISMATCH', 'Idempotency key was already used with a different payload');
  const lines = await repository.listMovementLines(client, { installationId, movementId: existing.id });
  return Object.freeze({ ok: true, movement: existing, lines: Object.freeze(lines), replayed: true });
}

function validateIdempotencyKey(value) {
  return typeof value === 'string' && IDEMPOTENCY_KEY_PATTERN.test(value)
    ? null
    : failure('INVALID_IDEMPOTENCY_KEY', 'idempotencyKey must contain 1-128 safe characters');
}

async function resolveLine(client, requestContext, line) {
  const allowedWarehouses = warehouseScope(requestContext);
  if (allowedWarehouses.size === 0 || !allowedWarehouses.has(line.warehouseId)) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Warehouse is outside the server-owned request scope');
  }
  const warehouse = await repository.resolveWarehouseLocation(client, {
    installationId: requestContext.installationId,
    warehouseId: line.warehouseId,
    locationId: line.locationId,
  });
  if (!warehouse || !warehouse.warehouse_active) return failure('WAREHOUSE_NOT_AVAILABLE', 'Warehouse is missing or inactive');
  if (line.locationId && (!warehouse.location_id || !warehouse.location_active)) {
    return failure('LOCATION_NOT_AVAILABLE', 'Location is missing, inactive or belongs to another warehouse');
  }
  const trustedSnapshot = line.sourceSnapshot ?? null;
  let variant = null;
  let policy = null;
  if (!trustedSnapshot) {
    variant = await repository.resolvePostingVariant(client, {
      installationId: requestContext.installationId,
      sourceVariantId: line.sourceVariantId,
    });
    if (!variant || !variant.source_variant_active || !variant.base_variant_active || !variant.source_unit_active) {
      return failure('SKU_UNIT_NOT_AVAILABLE', 'SKU, base SKU or unit is missing or inactive');
    }
    if (variant.conversion_to_base === null || variant.conversion_to_base === undefined) {
      return failure('CONVERSION_NOT_CONFIGURED', 'SKU conversion to inventory base is not configured');
    }
    policy = await lotRepository.getTrackingPolicyByBaseVariant(client, {
      installationId: requestContext.installationId,
      baseVariantId: variant.base_variant_id,
    });
    if (!policy) return failure('TRACKING_POLICY_NOT_FOUND', 'Tracking policy was not found');
    if (!policy.is_inventory_base || !policy.base_variant_active) {
      return failure('BASE_VARIANT_NOT_AVAILABLE', 'Inventory base SKU is missing, inactive or invalid');
    }
    if (policy.location_required && !line.locationId) {
      return failure('LOCATION_REQUIRED', 'Location is required by the active tracking policy');
    }
    const hasLotInput = Boolean(line.lotId || line.lotCode || line.manufacturedDate || line.expiryDate || line.supplierLotReference);
    if (policy.lot_tracking_mode === 'NONE' && hasLotInput) {
      return failure('LOT_NOT_ALLOWED', 'Lot data is not allowed by the active tracking policy');
    }
  } else {
    if (!UUID_PATTERN.test(String(line.sourceVariantId ?? ''))) {
      return failure('INVALID_SOURCE_VARIANT_ID', 'sourceVariantId is invalid');
    }
    if (!UUID_PATTERN.test(String(trustedSnapshot.sourceUnitId ?? ''))) {
      return failure('INVALID_SOURCE_UNIT_ID', 'sourceUnitId is invalid');
    }
    if (!UUID_PATTERN.test(String(trustedSnapshot.baseVariantId ?? ''))) {
      return failure('INVALID_BASE_VARIANT_ID', 'baseVariantId is invalid');
    }
    if (!trustedSnapshot.sourceSku || !trustedSnapshot.sourceUnitCode || !trustedSnapshot.baseSku || !trustedSnapshot.conversionToBase) {
      return failure('INVALID_TRUSTED_SNAPSHOT', 'Trusted source snapshot is incomplete');
    }
    variant = {
      source_sku: trustedSnapshot.sourceSku,
      source_unit_id: trustedSnapshot.sourceUnitId,
      source_unit_code: trustedSnapshot.sourceUnitCode,
      conversion_to_base: trustedSnapshot.conversionToBase,
      base_variant_id: trustedSnapshot.baseVariantId,
      base_sku: trustedSnapshot.baseSku,
      allows_fractional: true,
    };
    policy = await lotRepository.getTrackingPolicyByBaseVariant(client, {
      installationId: requestContext.installationId,
      baseVariantId: trustedSnapshot.baseVariantId,
    });
    if (!policy) return failure('TRACKING_POLICY_NOT_FOUND', 'Tracking policy was not found');
    if (!policy.is_inventory_base || !policy.base_variant_active) {
      return failure('BASE_VARIANT_NOT_AVAILABLE', 'Inventory base SKU is missing, inactive or invalid');
    }
    if (policy.location_required && !line.locationId) {
      return failure('LOCATION_REQUIRED', 'Location is required by the active tracking policy');
    }
    const hasLotInput = Boolean(line.lotId || line.lotCode || line.manufacturedDate || line.expiryDate || line.supplierLotReference);
    if (policy.lot_tracking_mode === 'NONE' && hasLotInput) {
      return failure('LOT_NOT_ALLOWED', 'Lot data is not allowed by the active tracking policy');
    }
  }
  let lotRecord = null;
  const normalizedLotCode = line.lotCode ? normalizeLotCode(line.lotCode) : null;
  if (line.lotCode && !normalizedLotCode.ok) return normalizedLotCode;
  const normalizedExpiryDate = strictDate(line.expiryDate);
  if (line.expiryDate && !normalizedExpiryDate) return failure('INVALID_EXPIRY_DATE', 'expiryDate must be a valid YYYY-MM-DD date');
  const normalizedManufacturedDate = strictDate(line.manufacturedDate);
  if (line.manufacturedDate && !normalizedManufacturedDate) return failure('INVALID_MANUFACTURED_DATE', 'manufacturedDate must be a valid YYYY-MM-DD date');

  if (policy?.lot_tracking_mode === 'REQUIRED' && !line.lotId && !normalizedLotCode) {
    return failure('LOT_REQUIRED', 'lotCode or lotId is required by the active tracking policy');
  }

  if (line.lotId) {
    lotRecord = await lotRepository.getInventoryLotById(client, {
      installationId: requestContext.installationId,
      id: line.lotId,
    });
    if (!lotRecord) return failure('LOT_NOT_FOUND', 'Lot was not found');
    if (lotRecord.base_variant_id !== variant.base_variant_id) {
      return failure('LOT_SKU_MISMATCH', 'Lot belongs to another SKU');
    }
    if (normalizedLotCode && lotRecord.normalized_lot_code !== normalizedLotCode.value) {
      return failure('LOT_SKU_MISMATCH', 'Lot code does not match the canonical lot');
    }
  } else if (normalizedLotCode) {
    lotRecord = await lotRepository.getInventoryLotByIdentity(client, {
      installationId: requestContext.installationId,
      baseVariantId: variant.base_variant_id,
      normalizedLotCode: normalizedLotCode.value,
    });
    if (!lotRecord) {
      const inserted = await lotRepository.insertInventoryLot(client, {
        id: randomUUID(),
        installationId: requestContext.installationId,
        baseVariantId: variant.base_variant_id,
        lotCode: line.lotCode,
        normalizedLotCode: normalizedLotCode.value,
        manufacturedDate: normalizedManufacturedDate,
        expiryDate: normalizedExpiryDate,
        supplierLotReference: text(line.supplierLotReference, 160),
        metadata: objectValue(line.metadata) ?? {},
        createdAt: requestContext.receivedAt ?? new Date().toISOString(),
        createdBy: requestContext.actorId,
      });
      lotRecord = inserted
        ?? await lotRepository.getInventoryLotByIdentity(client, {
          installationId: requestContext.installationId,
          baseVariantId: variant.base_variant_id,
          normalizedLotCode: normalizedLotCode.value,
        });
    }
  }

  const effectiveExpiryDate = lotRecord?.expiry_date ?? normalizedExpiryDate;
  if (policy?.expiry_tracking_mode === 'REQUIRED' && !effectiveExpiryDate) {
    return failure('EXPIRY_REQUIRED', 'expiryDate is required by the active tracking policy');
  }
  if (policy?.expiry_tracking_mode === 'NONE' && effectiveExpiryDate) {
    return failure('EXPIRY_NOT_ALLOWED', 'expiryDate is not allowed by the active tracking policy');
  }
  if (line.lotId && line.lotCode && lotRecord && normalizedLotCode && lotRecord.normalized_lot_code !== normalizedLotCode.value) {
    return failure('LOT_SKU_MISMATCH', 'Lot code does not match the canonical lot');
  }
  if (line.lotId && line.expiryDate && lotRecord && lotRecord.expiry_date !== normalizedExpiryDate) {
    return failure('LOT_EXPIRY_MISMATCH', 'Lot expiry does not match the canonical expiry');
  }
  if (!line.lotId && normalizedLotCode && lotRecord && normalizedExpiryDate && lotRecord.expiry_date !== normalizedExpiryDate) {
    return failure('LOT_EXPIRY_MISMATCH', 'Lot expiry does not match the canonical expiry');
  }

  const conversionToBase = trustedSnapshot?.conversionToBase ?? String(variant.conversion_to_base);
  const sourceSku = trustedSnapshot?.sourceSku ?? variant.source_sku;
  const sourceUnitId = trustedSnapshot?.sourceUnitId ?? variant.source_unit_id;
  const sourceUnitCode = trustedSnapshot?.sourceUnitCode ?? variant.source_unit_code;
  const baseVariantId = trustedSnapshot?.baseVariantId ?? variant.base_variant_id;
  const baseSku = trustedSnapshot?.baseSku ?? variant.base_sku;
  const converted = multiplyToBase(line.sourceQuantity, String(conversionToBase), line.direction);
  if (!converted.ok) return converted;
  if (!trustedSnapshot && !variant.allows_fractional && converted.sourceScaled % SCALE_6 !== 0n) {
    return failure('FRACTIONAL_QUANTITY_NOT_ALLOWED', 'Source unit does not allow fractional quantity');
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      ...line,
      sourceSku,
      sourceUnitId,
      sourceUnitCode,
      conversionToBase: converted.conversionToBase,
      baseVariantId,
      baseSku,
      baseQuantityDelta: converted.baseQuantityDelta,
      lotId: lotRecord?.id ?? line.lotId ?? null,
      lotCode: lotRecord?.normalized_lot_code ?? normalizedLotCode?.value ?? null,
      manufacturedDate: lotRecord?.manufactured_date ?? normalizedManufacturedDate ?? null,
      expiryDate: lotRecord?.expiry_date ?? normalizedExpiryDate ?? null,
      supplierLotReference: lotRecord?.supplier_lot_reference ?? text(line.supplierLotReference, 160),
    }),
  });
}

export async function postInventoryMovement(client, { requestContext, idempotencyKey, payload }) {
  const idempotencyError = validateIdempotencyKey(idempotencyKey);
  if (idempotencyError) return idempotencyError;
  const normalized = normalizePostingPayload(payload);
  if (!normalized.ok) return normalized;
  const hash = payloadHash(normalized.value);
  await repository.lockIdempotencyKey(client, {
    installationId: requestContext.installationId,
    idempotencyKey,
  });
  const replay = await replayOrMismatch(client, {
    installationId: requestContext.installationId,
    idempotencyKey,
    hash,
  });
  if (replay) return replay;
  const resolvedLines = [];
  for (const line of normalized.value.lines) {
    const resolved = await resolveLine(client, requestContext, line);
    if (!resolved.ok) return resolved;
    resolvedLines.push(resolved.value);
  }
  const movement = await repository.insertMovement(client, {
    id: randomUUID(),
    installationId: requestContext.installationId,
    movementType: normalized.value.movementType,
    sourceDomain: normalized.value.sourceDomain,
    sourceDocumentType: normalized.value.sourceDocumentType,
    sourceDocumentId: normalized.value.sourceDocumentId,
    sourceDocumentNumber: normalized.value.sourceDocumentNumber,
    documentDate: normalized.value.documentDate,
    postedAt: requestContext.receivedAt ?? new Date().toISOString(),
    postedBy: requestContext.actorId,
    requestId: requestContext.requestId,
    sourceApp: requestContext.sourceApp,
    idempotencyKey,
    payloadHash: hash,
    reversalOfMovementId: null,
    documentNumber: normalized.value.documentNumber,
    reasonCode: normalized.value.reasonCode,
    reasonNote: normalized.value.reasonNote,
    metadata: normalized.value.metadata,
  });
  const lines = [];
  for (const line of resolvedLines) {
    lines.push(await repository.insertMovementLine(client, {
      id: randomUUID(),
      installationId: requestContext.installationId,
      movementId: movement.id,
      ...line,
    }));
  }
  return Object.freeze({ ok: true, movement, lines: Object.freeze(lines), replayed: false });
}

function normalizeReversalPayload(payload) {
  const documentDate = strictDate(payload?.documentDate);
  if (!documentDate) return failure('INVALID_DOCUMENT_DATE', 'documentDate must be a valid YYYY-MM-DD date');
  const reasonCode = text(payload?.reasonCode, 64)?.toUpperCase() ?? null;
  const reasonNote = text(payload?.reasonNote, 2000);
  if (!reasonCode || !reasonNote) return failure('REVERSAL_REASON_REQUIRED', 'Reversal requires reasonCode and reasonNote');
  if (!CODE_PATTERN.test(reasonCode)) return failure('INVALID_REASON_CODE', 'reasonCode is invalid');
  return Object.freeze({ ok: true, value: Object.freeze({ documentDate, reasonCode, reasonNote }) });
}

export async function reverseInventoryMovement(client, {
  requestContext,
  idempotencyKey,
  movementId,
  payload,
}) {
  const idempotencyError = validateIdempotencyKey(idempotencyKey);
  if (idempotencyError) return idempotencyError;
  const movementError = validateIdentity(movementId, 'INVALID_MOVEMENT_ID', 'movementId is invalid');
  if (movementError) return movementError;
  const normalized = normalizeReversalPayload(payload);
  if (!normalized.ok) return normalized;
  const hash = payloadHash({ movementId, ...normalized.value });
  await repository.lockIdempotencyKey(client, {
    installationId: requestContext.installationId,
    idempotencyKey,
  });
  const replay = await replayOrMismatch(client, {
    installationId: requestContext.installationId,
    idempotencyKey,
    hash,
  });
  if (replay) return replay;
  const original = await repository.getMovementById(client, {
    installationId: requestContext.installationId,
    id: movementId,
    forUpdate: true,
  });
  if (!original) return failure('MOVEMENT_NOT_FOUND', 'Inventory movement was not found');
  if (original.movement_type === 'REVERSAL' || original.reversal_of_movement_id) {
    return failure('REVERSAL_NOT_ALLOWED', 'A reversal movement cannot be reversed by this foundation contract');
  }
  if (await repository.getReversalForMovement(client, {
    installationId: requestContext.installationId,
    movementId,
  })) return failure('MOVEMENT_ALREADY_REVERSED', 'Inventory movement was already reversed');
  const originalLines = await repository.listMovementLines(client, {
    installationId: requestContext.installationId,
    movementId,
  });
  if (originalLines.length === 0) return failure('MOVEMENT_LINES_NOT_FOUND', 'Inventory movement has no lines');
  const allowedWarehouses = warehouseScope(requestContext);
  if (allowedWarehouses.size === 0 || originalLines.some((line) => !allowedWarehouses.has(line.warehouse_id))) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Movement contains a warehouse outside the server-owned request scope');
  }
  const movement = await repository.insertMovement(client, {
    id: randomUUID(),
    installationId: requestContext.installationId,
    movementType: 'REVERSAL',
    sourceDomain: 'INVENTORY',
    sourceDocumentType: 'INVENTORY_REVERSAL',
    sourceDocumentId: original.id,
    sourceDocumentNumber: original.document_number,
    documentDate: normalized.value.documentDate,
    postedAt: requestContext.receivedAt ?? new Date().toISOString(),
    postedBy: requestContext.actorId,
    requestId: requestContext.requestId,
    sourceApp: requestContext.sourceApp,
    idempotencyKey,
    payloadHash: hash,
    reversalOfMovementId: original.id,
    documentNumber: null,
    reasonCode: normalized.value.reasonCode,
    reasonNote: normalized.value.reasonNote,
    metadata: { originalMovementId: original.id },
  });
  const lines = [];
  for (const originalLine of originalLines) {
    lines.push(await repository.insertMovementLine(client, {
      id: randomUUID(),
      installationId: requestContext.installationId,
      movementId: movement.id,
      lineNumber: originalLine.line_number,
      warehouseId: originalLine.warehouse_id,
      locationId: originalLine.location_id,
      sourceVariantId: originalLine.source_variant_id,
      sourceSku: originalLine.source_sku,
      sourceUnitId: originalLine.source_unit_id,
      sourceUnitCode: originalLine.source_unit_code,
      sourceQuantity: String(originalLine.source_quantity),
      conversionToBase: String(originalLine.conversion_to_base),
      baseVariantId: originalLine.base_variant_id,
      baseSku: originalLine.base_sku,
      direction: originalLine.direction === 'IN' ? 'OUT' : 'IN',
      baseQuantityDelta: String(originalLine.base_quantity_delta).startsWith('-')
        ? String(originalLine.base_quantity_delta).slice(1)
        : `-${originalLine.base_quantity_delta}`,
      lotId: originalLine.lot_id,
      lotCode: originalLine.lot_code,
      expiryDate: originalLine.expiry_date,
      sourceLineReference: originalLine.source_line_reference,
      metadata: { ...(originalLine.metadata ?? {}), reversedFromLineId: originalLine.id },
    }));
  }
  return Object.freeze({ ok: true, movement, lines: Object.freeze(lines), replayed: false });
}

async function executeWithLedgerAudit({ adapter, requestContext, operation, action, eventType }) {
  const transaction = await withAuditOutboxTransaction({
    adapter,
    mutate: async (client) => {
      const result = await operation(client);
      if (!result.ok) return { failed: result, skipAudit: true };
      if (result.replayed) return result;
      const audit = buildAuditRecord({
        requestContext,
        action,
        resourceType: 'inventory_movement',
        resourceId: result.movement.id,
        afterData: { movement: result.movement, lines: result.lines },
        metadata: { movementType: result.movement.movement_type },
      });
      const event = buildOutboxEvent({
        requestContext,
        aggregateType: 'inventory_movement',
        aggregateId: result.movement.id,
        eventType,
        eventVersion: 1,
        payload: { movement: result.movement, lines: result.lines },
        metadata: {},
      });
      await insertAuditRecord(client, audit);
      await insertOutboxEvent(client, event);
      return { ...result, auditId: audit.auditId, eventId: event.eventId };
    },
  });
  return transaction?.failed ?? transaction;
}

export function executeInventoryPost({ adapter, requestContext, idempotencyKey, payload }) {
  return executeWithLedgerAudit({
    adapter,
    requestContext,
    operation: (client) => postInventoryMovement(client, { requestContext, idempotencyKey, payload }),
    action: 'inventory.post',
    eventType: 'core.inventory.movement.posted',
  });
}

export function executeInventoryReversal({ adapter, requestContext, idempotencyKey, movementId, payload }) {
  return executeWithLedgerAudit({
    adapter,
    requestContext,
    operation: (client) => reverseInventoryMovement(client, {
      requestContext,
      idempotencyKey,
      movementId,
      payload,
    }),
    action: 'inventory.reverse',
    eventType: 'core.inventory.movement.reversed',
  });
}

export const inventoryLedgerInternals = Object.freeze({
  canonicalize,
  payloadHash,
  parsePositiveDecimal,
  multiplyToBase,
  normalizePostingPayload,
  normalizeReversalPayload,
});

import { createHash, randomUUID } from 'node:crypto';
import {
  buildAuditRecord,
  buildOutboxEvent,
  insertAuditRecord,
  insertOutboxEvent,
  withAuditOutboxTransaction,
} from '../audit-outbox.js';
import { PERMISSIONS } from '../access/permissions.js';
import * as balanceRepository from '../db/repositories/inventory-balance.js';
import * as ledgerRepository from '../db/repositories/inventory-ledger.js';
import * as repository from '../db/repositories/inventory-reservation.js';
import { inventoryLedgerInternals } from './inventory-ledger.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const SOURCE_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/;
const CODE_PATTERN = /^[A-Z0-9_.-]{1,64}$/;
const BASE_QUANTITY_PATTERN = /^(?:0|[1-9]\d{0,17})(?:\.\d{1,12})?$/;
const SCALE_6 = 1_000_000n;
const SCALE_12 = 1_000_000_000_000n;

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

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function payloadHash(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function parseScale12(value) {
  const normalized = String(value ?? '').trim();
  const negative = normalized.startsWith('-');
  const unsigned = negative ? normalized.slice(1) : normalized;
  if (!BASE_QUANTITY_PATTERN.test(unsigned)) return null;
  const [whole, fractional = ''] = unsigned.split('.');
  const scaled = BigInt(whole) * SCALE_12 + BigInt((fractional + '000000000000').slice(0, 12));
  return negative ? -scaled : scaled;
}

function formatScale12(value) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / SCALE_12;
  const fractional = String(absolute % SCALE_12).padStart(12, '0');
  return `${negative ? '-' : ''}${whole}.${fractional}`;
}

function strictTimestamp(value) {
  const normalized = text(value, 64);
  if (!normalized) return null;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function hasPermission(requestContext, permission) {
  return Array.isArray(requestContext?.permissions) && requestContext.permissions.includes(permission);
}

function warehouseScope(requestContext) {
  const ids = requestContext?.scopes?.warehouseIds;
  return Array.isArray(ids) ? new Set(ids.filter((id) => typeof id === 'string' && id.trim())) : new Set();
}

function validateRequestContext(requestContext, warehouseId) {
  if (!hasPermission(requestContext, PERMISSIONS.coreInventoryReserve)) {
    return failure('FORBIDDEN', 'Inventory reserve permission is required');
  }
  if (!requestContext?.installationId || !requestContext?.actorId || !requestContext?.requestId) {
    return failure('INVALID_REQUEST_CONTEXT', 'Server-owned request context is required');
  }
  const allowed = warehouseScope(requestContext);
  if (allowed.size === 0 || !allowed.has(warehouseId)) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Warehouse is outside the server-owned request scope');
  }
  return Object.freeze({ ok: true });
}

function validateIdempotencyKey(value) {
  return typeof value === 'string' && IDEMPOTENCY_PATTERN.test(value)
    ? null
    : failure('INVALID_IDEMPOTENCY_KEY', 'idempotencyKey must contain 1-128 safe characters');
}

function normalizeCreatePayload(payload, requestContext) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return failure('INVALID_INPUT', 'Reservation payload is required');
  }
  if (payload.overrideNegative === true) {
    return failure('NEGATIVE_STOCK_OVERRIDE_NOT_ENABLED', 'Negative-stock override is not enabled');
  }
  if (payload.lotId !== undefined && payload.lotId !== null && payload.lotId !== '') {
    return failure('LOT_SCOPE_NOT_AVAILABLE', 'Lot allocation is introduced in Phase 4.4');
  }
  const sourceKey = text(payload.sourceKey, 160);
  if (!sourceKey || !SOURCE_KEY_PATTERN.test(sourceKey)) {
    return failure('INVALID_SOURCE_KEY', 'sourceKey must contain 1-160 safe characters');
  }
  const sourceDomain = String(payload.sourceDomain ?? 'INVENTORY').trim().toUpperCase();
  if (!CODE_PATTERN.test(sourceDomain)) return failure('INVALID_SOURCE_DOMAIN', 'sourceDomain is invalid');
  const sourceDocumentType = text(payload.sourceDocumentType, 64)?.toUpperCase() ?? null;
  if (sourceDocumentType && !CODE_PATTERN.test(sourceDocumentType)) {
    return failure('INVALID_SOURCE_DOCUMENT_TYPE', 'sourceDocumentType is invalid');
  }
  if (!UUID_PATTERN.test(String(payload.warehouseId ?? ''))) {
    return failure('INVALID_WAREHOUSE_ID', 'warehouseId is invalid');
  }
  const locationId = text(payload.locationId, 64);
  if (locationId && !UUID_PATTERN.test(locationId)) return failure('INVALID_LOCATION_ID', 'locationId is invalid');
  if (!UUID_PATTERN.test(String(payload.sourceVariantId ?? ''))) {
    return failure('INVALID_SOURCE_VARIANT_ID', 'sourceVariantId is invalid');
  }
  const sourceQuantity = inventoryLedgerInternals.parsePositiveDecimal(payload.sourceQuantity, 'sourceQuantity');
  if (!sourceQuantity.ok) return sourceQuantity;
  const metadata = objectValue(payload.metadata);
  if (metadata === null) return failure('INVALID_METADATA', 'metadata must be a JSON object no larger than 16 KB');
  const expiresAt = payload.expiresAt === undefined || payload.expiresAt === null || payload.expiresAt === ''
    ? null
    : strictTimestamp(payload.expiresAt);
  if (payload.expiresAt && !expiresAt) return failure('INVALID_EXPIRES_AT', 'expiresAt must be a valid timestamp');
  const occurredAt = strictTimestamp(requestContext?.receivedAt) ?? new Date().toISOString();
  if (expiresAt && new Date(expiresAt).getTime() <= new Date(occurredAt).getTime()) {
    return failure('INVALID_EXPIRES_AT', 'expiresAt must be later than the command timestamp');
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      sourceKey,
      sourceDomain,
      sourceDocumentType,
      sourceDocumentId: text(payload.sourceDocumentId, 160),
      sourceLineReference: text(payload.sourceLineReference, 160),
      warehouseId: payload.warehouseId,
      locationId,
      sourceVariantId: payload.sourceVariantId,
      sourceQuantity: sourceQuantity.value,
      lotId: null,
      expiresAt,
      metadata,
    }),
  });
}

function normalizeTransitionPayload(payload, defaultReasonCode) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return failure('INVALID_INPUT', 'Reservation transition payload is required');
  }
  if (payload.overrideNegative === true) {
    return failure('NEGATIVE_STOCK_OVERRIDE_NOT_ENABLED', 'Negative-stock override is not enabled');
  }
  const scaled = parseScale12(payload.baseQuantity);
  if (scaled === null || scaled <= 0n) {
    return failure('INVALID_QUANTITY', 'baseQuantity must be a positive decimal string with at most 12 fractional digits');
  }
  const reasonCode = (text(payload.reasonCode, 64) ?? defaultReasonCode).toUpperCase();
  if (!CODE_PATTERN.test(reasonCode)) return failure('INVALID_REASON_CODE', 'reasonCode is invalid');
  const reasonNote = text(payload.reasonNote, 2000) ?? reasonCode;
  const metadata = objectValue(payload.metadata);
  if (metadata === null) return failure('INVALID_METADATA', 'metadata must be a JSON object no larger than 16 KB');
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      baseQuantity: formatScale12(scaled),
      reasonCode,
      reasonNote,
      metadata,
    }),
  });
}

async function replayEvent(client, { installationId, idempotencyKey, hash }) {
  const existing = await repository.getReservationEventByIdempotencyKey(client, {
    installationId,
    idempotencyKey,
  });
  if (!existing) return null;
  if (existing.payload_hash !== hash) {
    return failure('IDEMPOTENCY_PAYLOAD_MISMATCH', 'Idempotency key was already used with a different payload');
  }
  return Object.freeze({
    ok: true,
    ...(existing.result_snapshot ?? {}),
    reservationEventId: existing.id,
    replayed: true,
  });
}

async function resolveCreateScope(client, requestContext, normalized) {
  const contextValidation = validateRequestContext(requestContext, normalized.warehouseId);
  if (!contextValidation.ok) return contextValidation;
  const warehouse = await ledgerRepository.resolveWarehouseLocation(client, {
    installationId: requestContext.installationId,
    warehouseId: normalized.warehouseId,
    locationId: normalized.locationId,
  });
  if (!warehouse || !warehouse.warehouse_active) return failure('WAREHOUSE_NOT_AVAILABLE', 'Warehouse is missing or inactive');
  if (normalized.locationId && (!warehouse.location_id || !warehouse.location_active)) {
    return failure('LOCATION_NOT_AVAILABLE', 'Location is missing, inactive or belongs to another warehouse');
  }
  const variant = await ledgerRepository.resolvePostingVariant(client, {
    installationId: requestContext.installationId,
    sourceVariantId: normalized.sourceVariantId,
  });
  if (!variant || !variant.source_variant_active || !variant.base_variant_active || !variant.source_unit_active) {
    return failure('SKU_UNIT_NOT_AVAILABLE', 'SKU, base SKU or unit is missing or inactive');
  }
  if (variant.conversion_to_base === null || variant.conversion_to_base === undefined) {
    return failure('CONVERSION_NOT_CONFIGURED', 'SKU conversion to inventory base is not configured');
  }
  const converted = inventoryLedgerInternals.multiplyToBase(
    normalized.sourceQuantity,
    String(variant.conversion_to_base),
    'IN',
  );
  if (!converted.ok) return converted;
  if (!variant.allows_fractional && converted.sourceScaled % SCALE_6 !== 0n) {
    return failure('FRACTIONAL_QUANTITY_NOT_ALLOWED', 'Source unit does not allow fractional quantity');
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      ...normalized,
      sourceSku: variant.source_sku,
      sourceUnitId: variant.source_unit_id,
      sourceUnitCode: variant.source_unit_code,
      conversionToBase: converted.conversionToBase,
      baseVariantId: variant.base_variant_id,
      baseSku: variant.base_sku,
      baseQuantity: converted.baseQuantityDelta,
    }),
  });
}

async function reserveInventory(client, { requestContext, idempotencyKey, payload }) {
  const idempotencyError = validateIdempotencyKey(idempotencyKey);
  if (idempotencyError) return idempotencyError;
  const normalized = normalizeCreatePayload(payload, requestContext);
  if (!normalized.ok) return normalized;
  const contextValidation = validateRequestContext(requestContext, normalized.value.warehouseId);
  if (!contextValidation.ok) return contextValidation;
  const hash = payloadHash(normalized.value);
  await repository.lockReservationCommand(client, {
    installationId: requestContext.installationId,
    key: idempotencyKey,
  });
  const replay = await replayEvent(client, {
    installationId: requestContext.installationId,
    idempotencyKey,
    hash,
  });
  if (replay) return replay;
  await repository.lockReservationSource(client, {
    installationId: requestContext.installationId,
    sourceKey: normalized.value.sourceKey,
  });
  const sourceExisting = await repository.getReservationBySourceKey(client, {
    installationId: requestContext.installationId,
    sourceKey: normalized.value.sourceKey,
  });
  if (sourceExisting) {
    if (sourceExisting.create_payload_hash !== hash) {
      return failure('SOURCE_KEY_PAYLOAD_MISMATCH', 'sourceKey was already used with a different payload');
    }
    return Object.freeze({ ok: true, reservation: sourceExisting, replayed: true });
  }
  const resolved = await resolveCreateScope(client, requestContext, normalized.value);
  if (!resolved.ok) return resolved;
  const balance = await repository.lockBalanceScope(client, {
    installationId: requestContext.installationId,
    warehouseId: resolved.value.warehouseId,
    locationId: resolved.value.locationId,
    baseVariantId: resolved.value.baseVariantId,
    lotId: null,
  });
  if (!balance) return failure('BALANCE_NOT_FOUND', 'Inventory balance was not found');
  if (parseScale12(balance.available_quantity) < parseScale12(resolved.value.baseQuantity)) {
    return failure('INSUFFICIENT_AVAILABLE_STOCK', 'Available quantity is lower than the requested reservation');
  }
  const updatedBalance = await repository.changeReservedQuantity(client, {
    installationId: requestContext.installationId,
    warehouseId: resolved.value.warehouseId,
    locationId: resolved.value.locationId,
    baseVariantId: resolved.value.baseVariantId,
    lotId: null,
    delta: resolved.value.baseQuantity,
  });
  if (!updatedBalance) return failure('INSUFFICIENT_AVAILABLE_STOCK', 'Reservation would exceed available stock');
  const occurredAt = strictTimestamp(requestContext.receivedAt) ?? new Date().toISOString();
  const reservation = await repository.insertReservation(client, {
    id: randomUUID(),
    installationId: requestContext.installationId,
    ...resolved.value,
    createPayloadHash: hash,
    occurredAt,
    actorId: requestContext.actorId,
  });
  const snapshot = Object.freeze({ reservation, balance: updatedBalance });
  const reservationEvent = await repository.insertReservationEvent(client, {
    id: randomUUID(),
    installationId: requestContext.installationId,
    reservationId: reservation.id,
    eventType: 'RESERVED',
    fromState: null,
    toState: 'ACTIVE',
    baseQuantity: reservation.base_quantity,
    idempotencyKey,
    payloadHash: hash,
    reasonCode: 'RESERVED',
    reasonNote: 'Inventory reserved.',
    resultSnapshot: snapshot,
    metadata: reservation.metadata,
    occurredAt,
    occurredBy: requestContext.actorId,
    requestId: requestContext.requestId,
    sourceApp: requestContext.sourceApp,
  });
  return Object.freeze({ ok: true, ...snapshot, reservationEventId: reservationEvent.id, replayed: false });
}

async function transitionInventoryReservation(client, {
  requestContext,
  idempotencyKey,
  reservationId,
  payload,
  action,
}) {
  const idempotencyError = validateIdempotencyKey(idempotencyKey);
  if (idempotencyError) return idempotencyError;
  if (!UUID_PATTERN.test(String(reservationId ?? ''))) return failure('INVALID_RESERVATION_ID', 'reservationId is invalid');
  const defaultReasonCode = action === 'EXPIRE' ? 'EXPIRED' : action === 'RELEASE' ? 'RELEASED' : 'CONSUMED';
  const normalized = normalizeTransitionPayload(payload, defaultReasonCode);
  if (!normalized.ok) return normalized;
  const hash = payloadHash({ action, reservationId, ...normalized.value });
  await repository.lockReservationCommand(client, {
    installationId: requestContext.installationId,
    key: idempotencyKey,
  });
  const replay = await replayEvent(client, {
    installationId: requestContext.installationId,
    idempotencyKey,
    hash,
  });
  if (replay) return replay;
  const reservation = await repository.getReservationById(client, {
    installationId: requestContext.installationId,
    id: reservationId,
    forUpdate: true,
  });
  if (!reservation) return failure('RESERVATION_NOT_FOUND', 'Inventory reservation was not found');
  const contextValidation = validateRequestContext(requestContext, reservation.warehouse_id);
  if (!contextValidation.ok) return contextValidation;
  if (reservation.state !== 'ACTIVE') {
    return failure('RESERVATION_NOT_ACTIVE', 'Only an active reservation can transition');
  }
  if (parseScale12(normalized.value.baseQuantity) !== parseScale12(reservation.held_quantity)) {
    return failure('RESERVATION_QUANTITY_MISMATCH', 'Phase 4.3 supports whole-quantity transitions only');
  }
  const occurredAt = strictTimestamp(requestContext.receivedAt) ?? new Date().toISOString();
  if (action === 'EXPIRE') {
    if (!reservation.expires_at) return failure('RESERVATION_HAS_NO_EXPIRY', 'Reservation has no expiration timestamp');
    if (new Date(reservation.expires_at).getTime() > new Date(occurredAt).getTime()) {
      return failure('RESERVATION_NOT_EXPIRED', 'Reservation expiration timestamp has not been reached');
    }
  }
  const balance = await repository.lockBalanceScope(client, {
    installationId: requestContext.installationId,
    warehouseId: reservation.warehouse_id,
    locationId: reservation.location_id,
    baseVariantId: reservation.base_variant_id,
    lotId: reservation.lot_id,
  });
  if (!balance) return failure('BALANCE_NOT_FOUND', 'Inventory balance was not found');
  const updatedBalance = await repository.changeReservedQuantity(client, {
    installationId: requestContext.installationId,
    warehouseId: reservation.warehouse_id,
    locationId: reservation.location_id,
    baseVariantId: reservation.base_variant_id,
    lotId: reservation.lot_id,
    delta: formatScale12(-parseScale12(reservation.held_quantity)),
  });
  if (!updatedBalance) return failure('RESERVATION_BALANCE_MISMATCH', 'Reserved projection is lower than the reservation hold');

  let movement = null;
  let movementLine = null;
  if (action === 'CONSUME') {
    movement = await ledgerRepository.insertMovement(client, {
      id: randomUUID(),
      installationId: requestContext.installationId,
      movementType: 'RESERVATION_CONSUMPTION',
      sourceDomain: reservation.source_domain,
      sourceDocumentType: reservation.source_document_type ?? 'INVENTORY_RESERVATION',
      sourceDocumentId: reservation.id,
      sourceDocumentNumber: reservation.source_key,
      documentDate: occurredAt.slice(0, 10),
      postedAt: occurredAt,
      postedBy: requestContext.actorId,
      requestId: requestContext.requestId,
      sourceApp: requestContext.sourceApp,
      idempotencyKey: `reservation-consume:${reservation.id}`,
      payloadHash: hash,
      reversalOfMovementId: null,
      documentNumber: null,
      reasonCode: normalized.value.reasonCode,
      reasonNote: normalized.value.reasonNote,
      metadata: { reservationId: reservation.id, ...normalized.value.metadata },
    });
    movementLine = await ledgerRepository.insertMovementLine(client, {
      id: randomUUID(),
      installationId: requestContext.installationId,
      movementId: movement.id,
      lineNumber: 1,
      warehouseId: reservation.warehouse_id,
      locationId: reservation.location_id,
      sourceVariantId: reservation.source_variant_id,
      sourceSku: reservation.source_sku,
      sourceUnitId: reservation.source_unit_id,
      sourceUnitCode: reservation.source_unit_code,
      sourceQuantity: String(reservation.source_quantity),
      conversionToBase: String(reservation.conversion_to_base),
      baseVariantId: reservation.base_variant_id,
      baseSku: reservation.base_sku,
      direction: 'OUT',
      baseQuantityDelta: formatScale12(-parseScale12(reservation.base_quantity)),
      sourceLineReference: reservation.source_line_reference,
      metadata: { reservationId: reservation.id },
    });
  }

  const toState = action === 'RELEASE' ? 'RELEASED' : action === 'CONSUME' ? 'CONSUMED' : 'EXPIRED';
  const updatedReservation = await repository.transitionReservation(client, {
    installationId: requestContext.installationId,
    reservationId: reservation.id,
    toState,
    occurredAt,
    actorId: requestContext.actorId,
  });
  if (!updatedReservation) return failure('RESERVATION_CONCURRENT_TRANSITION', 'Reservation was changed by another transaction', true);
  const snapshot = Object.freeze({
    reservation: updatedReservation,
    balance: action === 'CONSUME'
      ? await repository.lockBalanceScope(client, {
        installationId: requestContext.installationId,
        warehouseId: reservation.warehouse_id,
        locationId: reservation.location_id,
        baseVariantId: reservation.base_variant_id,
        lotId: reservation.lot_id,
      })
      : updatedBalance,
    movement,
    movementLine,
  });
  const reservationEvent = await repository.insertReservationEvent(client, {
    id: randomUUID(),
    installationId: requestContext.installationId,
    reservationId: reservation.id,
    eventType: toState === 'RELEASED' ? 'RELEASED' : toState === 'CONSUMED' ? 'CONSUMED' : 'EXPIRED',
    fromState: 'ACTIVE',
    toState,
    baseQuantity: reservation.base_quantity,
    idempotencyKey,
    payloadHash: hash,
    reasonCode: normalized.value.reasonCode,
    reasonNote: normalized.value.reasonNote,
    resultSnapshot: snapshot,
    metadata: normalized.value.metadata,
    occurredAt,
    occurredBy: requestContext.actorId,
    requestId: requestContext.requestId,
    sourceApp: requestContext.sourceApp,
  });
  return Object.freeze({ ok: true, ...snapshot, reservationEventId: reservationEvent.id, replayed: false });
}

async function executeReservationCommand({
  adapter,
  requestContext,
  operation,
  action,
  eventType,
}) {
  const transaction = await withAuditOutboxTransaction({
    adapter,
    mutate: async (client) => {
      const result = await operation(client);
      if (!result.ok) return { failed: result, skipAudit: true };
      if (result.replayed) return result;
      const audit = buildAuditRecord({
        requestContext,
        action,
        resourceType: 'inventory_reservation',
        resourceId: result.reservation.id,
        beforeData: null,
        afterData: {
          reservation: result.reservation,
          balance: result.balance,
          movement: result.movement ?? null,
        },
        metadata: { reservationEventId: result.reservationEventId },
      });
      const outbox = buildOutboxEvent({
        requestContext,
        aggregateType: 'inventory_reservation',
        aggregateId: result.reservation.id,
        eventType,
        eventVersion: 1,
        payload: {
          reservation: result.reservation,
          balance: result.balance,
          movement: result.movement ?? null,
        },
        metadata: { reservationEventId: result.reservationEventId },
      });
      await insertAuditRecord(client, audit);
      await insertOutboxEvent(client, outbox);
      return Object.freeze({ ...result, auditId: audit.auditId, eventId: outbox.eventId });
    },
  });
  return transaction?.failed ?? transaction;
}

export function executeInventoryReserve({ adapter, requestContext, idempotencyKey, payload }) {
  return executeReservationCommand({
    adapter,
    requestContext,
    operation: (client) => reserveInventory(client, { requestContext, idempotencyKey, payload }),
    action: 'inventory.reservation.reserve',
    eventType: 'core.inventory.reservation.created',
  });
}

export function executeInventoryReservationRelease({ adapter, requestContext, idempotencyKey, reservationId, payload }) {
  return executeReservationCommand({
    adapter,
    requestContext,
    operation: (client) => transitionInventoryReservation(client, {
      requestContext,
      idempotencyKey,
      reservationId,
      payload,
      action: 'RELEASE',
    }),
    action: 'inventory.reservation.release',
    eventType: 'core.inventory.reservation.released',
  });
}

export function executeInventoryReservationConsume({ adapter, requestContext, idempotencyKey, reservationId, payload }) {
  return executeReservationCommand({
    adapter,
    requestContext,
    operation: (client) => transitionInventoryReservation(client, {
      requestContext,
      idempotencyKey,
      reservationId,
      payload,
      action: 'CONSUME',
    }),
    action: 'inventory.reservation.consume',
    eventType: 'core.inventory.reservation.consumed',
  });
}

export function executeInventoryReservationExpire({ adapter, requestContext, idempotencyKey, reservationId, payload }) {
  return executeReservationCommand({
    adapter,
    requestContext,
    operation: (client) => transitionInventoryReservation(client, {
      requestContext,
      idempotencyKey,
      reservationId,
      payload,
      action: 'EXPIRE',
    }),
    action: 'inventory.reservation.expire',
    eventType: 'core.inventory.reservation.expired',
  });
}

export async function reconcileInventoryReservationHolds(client, { requestContext }) {
  if (!hasPermission(requestContext, PERMISSIONS.coreInventoryRead)) {
    return failure('FORBIDDEN', 'Inventory read permission is required');
  }
  const allowed = warehouseScope(requestContext);
  if (allowed.size === 0) return failure('WAREHOUSE_SCOPE_DENIED', 'At least one warehouse scope is required');
  const warehouseIds = await balanceRepository.listInventoryWarehouseIds(client, {
    installationId: requestContext.installationId,
  });
  if (warehouseIds.some((warehouseId) => !allowed.has(warehouseId))) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Full reservation reconciliation requires every inventory warehouse');
  }
  const rows = await repository.reconcileReservationHolds(client, {
    installationId: requestContext.installationId,
  });
  const differences = rows.filter((row) => parseScale12(row.difference) !== 0n);
  return Object.freeze({
    ok: true,
    rows: Object.freeze(rows),
    differences: Object.freeze(differences),
    reconciled: differences.length === 0,
  });
}

export const inventoryReservationInternals = Object.freeze({
  canonicalize,
  payloadHash,
  parseScale12,
  formatScale12,
  normalizeCreatePayload,
  normalizeTransitionPayload,
});

// Phase 4.3 inventory reservations service.
// Handles reservation lifecycle, negative-stock enforcement, idempotency, and compliance.
// State machine: ACTIVE -> RELEASED | CONSUMED | EXPIRED | CANCELLED (terminal)
// All writes require reservation_service context and permission checks fail-closed.

import { createHash, randomUUID } from 'node:crypto';
import {
  buildAuditRecord,
  buildOutboxEvent,
  insertAuditRecord,
  insertOutboxEvent,
  withAuditOutboxTransaction,
} from '../audit-outbox.js';
import { PERMISSIONS } from '../access/permissions.js';
import * as repository from '../db/repositories/inventory-reservations.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const DECIMAL_PATTERN = /^(?:0|[1-9]\d{0,13})(?:\.\d{1,12})?$/;
const CODE_PATTERN = /^[A-Z0-9_.-]{1,64}$/;
const SCALE_12 = 1_000_000_000_000n;

const VALID_TRANSITIONS = Object.freeze({
  CREATE_ACTIVE: { from: null, to: 'ACTIVE' },
  RELEASE_TO_RELEASED: { from: 'ACTIVE', to: 'RELEASED' },
  CONSUME_TO_CONSUMED: { from: 'ACTIVE', to: 'CONSUMED' },
  EXPIRE_TO_EXPIRED: { from: 'ACTIVE', to: 'EXPIRED' },
  CANCEL_TO_CANCELLED: { from: 'ACTIVE', to: 'CANCELLED' },
});

const TERMINAL_STATES = new Set(['RELEASED', 'CONSUMED', 'EXPIRED', 'CANCELLED']);

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

function parseDecimal(value, field, allowZero = false) {
  const normalized = typeof value === 'string' ? text(value, 32) : null;
  if (!normalized || !DECIMAL_PATTERN.test(normalized)) {
    return failure('INVALID_QUANTITY', `${field} must be a decimal string with at most 12 fractional digits`);
  }
  const [whole, fractional = ''] = normalized.split('.');
  const scaled = BigInt(whole) * SCALE_12 + BigInt((fractional + '000000000000').slice(0, 12));
  if (!allowZero && scaled <= 0n) {
    return failure('INVALID_QUANTITY', `${field} must be greater than zero`);
  }
  if (scaled < 0n) {
    return failure('INVALID_QUANTITY', `${field} must be non-negative`);
  }
  return Object.freeze({ ok: true, scaled, value: normalized });
}

function formatScale12(value) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / SCALE_12;
  const fractional = String(absolute % SCALE_12).padStart(12, '0');
  return `${negative ? '-' : ''}${whole}.${fractional}`;
}

function hasPermission(requestContext, permission) {
  const grantedPermissions = requestContext?.grantedPermissions ?? [];
  return grantedPermissions.includes(permission);
}

function warehouseScope(requestContext) {
  const ids = requestContext?.scopes?.warehouseIds;
  return Array.isArray(ids) ? new Set(ids.filter((id) => typeof id === 'string' && id.trim())) : new Set();
}

function validateIdentity(value, code, message) {
  return typeof value === 'string' && UUID_PATTERN.test(value) ? null : failure(code, message);
}

function validateIdempotencyKey(value) {
  return typeof value === 'string' && IDEMPOTENCY_PATTERN.test(value)
    ? null
    : failure('INVALID_IDEMPOTENCY_KEY', 'idempotencyKey must contain 1-128 safe characters');
}

async function replayOrMismatch(client, { installationId, idempotencyKey, hash }) {
  const existing = await repository.getReservationByIdempotencyKey(client, { installationId, idempotencyKey });
  if (!existing) return null;
  if (existing.payload_hash !== hash) return failure('IDEMPOTENCY_PAYLOAD_MISMATCH', 'Idempotency key was already used with a different payload');
  const events = await repository.listReservationEvents(client, { installationId, reservationId: existing.id });
  return Object.freeze({ ok: true, reservation: existing, events: Object.freeze(events), replayed: true });
}

function normalizeReservePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return failure('INVALID_INPUT', 'Reservation payload is required');

  const warehouseError = validateIdentity(payload.warehouseId, 'INVALID_WAREHOUSE_ID', 'warehouseId is invalid UUID');
  if (warehouseError) return warehouseError;

  if (payload.locationId !== undefined && payload.locationId !== null && payload.locationId !== '') {
    const locationError = validateIdentity(payload.locationId, 'INVALID_LOCATION_ID', 'locationId is invalid UUID');
    if (locationError) return locationError;
  }

  const variantError = validateIdentity(payload.baseVariantId, 'INVALID_BASE_VARIANT_ID', 'baseVariantId is invalid UUID');
  if (variantError) return variantError;

  if (payload.lotId !== undefined && payload.lotId !== null && payload.lotId !== '') {
    const lotError = validateIdentity(payload.lotId, 'INVALID_LOT_ID', 'lotId is invalid UUID');
    if (lotError) return lotError;
  }

  const quantity = parseDecimal(payload.quantity, 'quantity', false);
  if (!quantity.ok) return quantity;

  // P4.3: No partial reservations allowed
  if (quantity.scaled % SCALE_12 !== 0n) {
    return failure('PARTIAL_RESERVATION_NOT_SUPPORTED', 'P4.3 does not support partial quantity; reservation must be whole number in base unit');
  }

  const sourceDomain = String(payload.sourceDomain ?? 'UNKNOWN').trim().toUpperCase();
  if (!CODE_PATTERN.test(sourceDomain)) return failure('INVALID_SOURCE_DOMAIN', 'sourceDomain is invalid');

  const sourceDocumentType = text(payload.sourceDocumentType, 64)?.toUpperCase() ?? null;
  if (sourceDocumentType && !CODE_PATTERN.test(sourceDocumentType)) return failure('INVALID_SOURCE_DOCUMENT_TYPE', 'sourceDocumentType is invalid');

  const sourceDocumentId = text(payload.sourceDocumentId, 160) ?? null;

  const metadata = objectValue(payload.metadata);
  if (metadata === null) return failure('INVALID_METADATA', 'metadata must be a JSON object no larger than 16 KB');

  return Object.freeze({
    ok: true,
    value: Object.freeze({
      warehouseId: payload.warehouseId,
      locationId: text(payload.locationId, 64),
      baseVariantId: payload.baseVariantId,
      lotId: text(payload.lotId, 64),
      quantity: quantity.value,
      quantityScaled: quantity.scaled,
      sourceDomain,
      sourceDocumentType,
      sourceDocumentId,
      metadata,
    }),
  });
}

async function createReservation(client, { requestContext, idempotencyKey, payload }) {
  const idempotencyError = validateIdempotencyKey(idempotencyKey);
  if (idempotencyError) return idempotencyError;

  if (!hasPermission(requestContext, PERMISSIONS.coreInventoryReserve)) {
    return failure('PERMISSION_DENIED', 'Permission core.inventory.reserve is required');
  }

  const normalized = normalizeReservePayload(payload);
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

  // Warehouse scope check
  const allowedWarehouses = warehouseScope(requestContext);
  if (allowedWarehouses.size === 0 || !allowedWarehouses.has(normalized.value.warehouseId)) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Warehouse is outside the server-owned request scope');
  }

  // Resolve and validate warehouse/location
  const warehouse = await repository.resolveWarehouseLocation(client, {
    installationId: requestContext.installationId,
    warehouseId: normalized.value.warehouseId,
    locationId: normalized.value.locationId,
  });
  if (!warehouse || !warehouse.warehouse_active) return failure('WAREHOUSE_NOT_AVAILABLE', 'Warehouse is missing or inactive');
  if (normalized.value.locationId && (!warehouse.location_id || !warehouse.location_active)) {
    return failure('LOCATION_NOT_AVAILABLE', 'Location is missing, inactive or belongs to another warehouse');
  }

  // Resolve and validate variant
  const variant = await repository.resolveVariant(client, {
    installationId: requestContext.installationId,
    baseVariantId: normalized.value.baseVariantId,
  });
  if (!variant || !variant.is_active) return failure('VARIANT_NOT_AVAILABLE', 'Base variant is missing or inactive');

  // Check negative-stock constraint: deny by default
  const balance = await repository.resolveReservationBalance(client, {
    installationId: requestContext.installationId,
    warehouseId: normalized.value.warehouseId,
    locationId: normalized.value.locationId,
    baseVariantId: normalized.value.baseVariantId,
    lotId: normalized.value.lotId,
  });

  const onHand = balance ? BigInt(String(balance.on_hand_quantity).split('.').join('')) : 0n;
  const reserved = balance ? BigInt(String(balance.reserved_quantity).split('.').join('')) : 0n;
  const available = onHand - reserved;
  const requested = normalized.value.quantityScaled;

  if (requested > available) {
    return failure('INSUFFICIENT_AVAILABLE_QUANTITY', 'Requested quantity exceeds available balance; negative stock is denied by default');
  }

  // Create reservation in ACTIVE state
  const reservationId = randomUUID();
  const now = requestContext.receivedAt ?? new Date().toISOString();
  const reservation = await repository.insertReservation(client, {
    id: reservationId,
    installationId: requestContext.installationId,
    warehouseId: normalized.value.warehouseId,
    locationId: normalized.value.locationId,
    baseVariantId: normalized.value.baseVariantId,
    lotId: normalized.value.lotId,
    quantity: normalized.value.quantity,
    state: 'ACTIVE',
    sourceDomain: normalized.value.sourceDomain,
    sourceDocumentType: normalized.value.sourceDocumentType,
    sourceDocumentId: normalized.value.sourceDocumentId,
    activatedAt: now,
    transitionedAt: now,
    idempotencyKey,
    payloadHash: hash,
    metadata: normalized.value.metadata,
  });

  // Record CREATE_ACTIVE event
  const event = await repository.insertReservationEvent(client, {
    id: randomUUID(),
    installationId: requestContext.installationId,
    reservationId,
    transition: 'CREATE_ACTIVE',
    actorId: requestContext.actorId,
    requestId: requestContext.requestId,
    sourceApp: requestContext.sourceApp,
    payloadHash: hash,
    occurredAt: now,
    metadata: { action: 'reserve', sourceDomain: normalized.value.sourceDomain },
  });

  return Object.freeze({ ok: true, reservation, events: Object.freeze([event]), replayed: false });
}

function normalizeTransitionPayload(transition, payload) {
  const valid = VALID_TRANSITIONS[transition];
  if (!valid) return failure('INVALID_TRANSITION', `Transition ${transition} is not recognized`);

  return Object.freeze({
    ok: true,
    value: Object.freeze({
      transition,
      reason: text(payload?.reason, 500) ?? null,
      metadata: objectValue(payload?.metadata) ?? {},
    }),
  });
}

async function transitionReservation(client, { requestContext, reservationId, transition, payload }) {
  if (!requestContext || !requestContext.requestId) {
    return failure('INVALID_REQUEST_CONTEXT', 'Request context is required');
  }

  if (!hasPermission(requestContext, PERMISSIONS.coreInventoryReserve)) {
    return failure('PERMISSION_DENIED', 'Permission core.inventory.reserve is required');
  }

  const reservationError = validateIdentity(reservationId, 'INVALID_RESERVATION_ID', 'reservationId is invalid UUID');
  if (reservationError) return reservationError;

  const normalized = normalizeTransitionPayload(transition, payload);
  if (!normalized.ok) return normalized;

  const reservation = await repository.getReservationById(client, {
    installationId: requestContext.installationId,
    id: reservationId,
    forUpdate: true,
  });
  if (!reservation) return failure('RESERVATION_NOT_FOUND', 'Reservation was not found');

  const transitionDef = VALID_TRANSITIONS[normalized.value.transition];
  if (!transitionDef) return failure('INVALID_TRANSITION', 'Transition is not recognized');
  if (transitionDef.from !== reservation.state) {
    return failure('INVALID_STATE_TRANSITION', `Cannot transition from ${reservation.state} with ${normalized.value.transition}`);
  }

  if (TERMINAL_STATES.has(reservation.state)) {
    return failure('TERMINAL_STATE_NO_TRANSITION', `Reservation in terminal state ${reservation.state} cannot transition`);
  }

  // Warehouse scope check
  const allowedWarehouses = warehouseScope(requestContext);
  if (allowedWarehouses.size === 0 || !allowedWarehouses.has(reservation.warehouse_id)) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Reservation warehouse is outside the server-owned request scope');
  }

  // Update reservation state
  const now = requestContext.receivedAt ?? new Date().toISOString();
  const updated = await repository.updateReservationState(client, {
    installationId: requestContext.installationId,
    id: reservationId,
    state: transitionDef.to,
    transitionedAt: now,
  });

  // Record transition event
  const hash = payloadHash({ reservationId, transition, ...normalized.value });
  const event = await repository.insertReservationEvent(client, {
    id: randomUUID(),
    installationId: requestContext.installationId,
    reservationId,
    transition: normalized.value.transition,
    actorId: requestContext.actorId,
    requestId: requestContext.requestId,
    sourceApp: requestContext.sourceApp,
    payloadHash: hash,
    occurredAt: now,
    metadata: { ...normalized.value.metadata, reason: normalized.value.reason },
  });

  const events = await repository.listReservationEvents(client, {
    installationId: requestContext.installationId,
    reservationId,
  });

  return Object.freeze({ ok: true, reservation: updated, events: Object.freeze(events), replayed: false });
}

async function executeWithReservationAudit({ adapter, requestContext, operation, action, eventType }) {
  const transaction = await withAuditOutboxTransaction({
    adapter,
    mutate: async (client) => {
      // Set reservation write context for triggers
      await client.query("SELECT set_config('npp.inventory_reservation_write_context', 'reservation_service', true)");

      const result = await operation(client);
      if (!result.ok) return { failed: result, skipAudit: true };
      if (result.replayed) return result;

      const audit = buildAuditRecord({
        requestContext,
        action,
        resourceType: 'inventory_reservation',
        resourceId: result.reservation.id,
        afterData: { reservation: result.reservation, events: result.events },
        metadata: { state: result.reservation.state },
      });

      const event = buildOutboxEvent({
        requestContext,
        aggregateType: 'inventory_reservation',
        aggregateId: result.reservation.id,
        eventType,
        eventVersion: 1,
        payload: { reservation: result.reservation, events: result.events },
        metadata: {},
      });

      await insertAuditRecord(client, audit);
      await insertOutboxEvent(client, event);
      return { ...result, auditId: audit.auditId, eventId: event.eventId };
    },
  });
  return transaction?.failed ?? transaction;
}

export function executeReserveInventory({ adapter, requestContext, idempotencyKey, payload }) {
  return executeWithReservationAudit({
    adapter,
    requestContext,
    operation: (client) => createReservation(client, { requestContext, idempotencyKey, payload }),
    action: 'inventory.reserve',
    eventType: 'core.inventory.reservation.created',
  });
}

export function executeReleaseReservation({ adapter, requestContext, reservationId, payload }) {
  return executeWithReservationAudit({
    adapter,
    requestContext,
    operation: (client) => transitionReservation(client, {
      requestContext,
      reservationId,
      transition: 'RELEASE_TO_RELEASED',
      payload,
    }),
    action: 'inventory.release',
    eventType: 'core.inventory.reservation.released',
  });
}

export function executeConsumeReservation({ adapter, requestContext, reservationId, payload }) {
  return executeWithReservationAudit({
    adapter,
    requestContext,
    operation: (client) => transitionReservation(client, {
      requestContext,
      reservationId,
      transition: 'CONSUME_TO_CONSUMED',
      payload,
    }),
    action: 'inventory.consume',
    eventType: 'core.inventory.reservation.consumed',
  });
}

export function executeExpireReservation({ adapter, requestContext, reservationId, payload }) {
  return executeWithReservationAudit({
    adapter,
    requestContext,
    operation: (client) => transitionReservation(client, {
      requestContext,
      reservationId,
      transition: 'EXPIRE_TO_EXPIRED',
      payload,
    }),
    action: 'inventory.expire',
    eventType: 'core.inventory.reservation.expired',
  });
}

export function executeCancelReservation({ adapter, requestContext, reservationId, payload }) {
  return executeWithReservationAudit({
    adapter,
    requestContext,
    operation: (client) => transitionReservation(client, {
      requestContext,
      reservationId,
      transition: 'CANCEL_TO_CANCELLED',
      payload,
    }),
    action: 'inventory.cancel',
    eventType: 'core.inventory.reservation.cancelled',
  });
}

export const inventoryReservationInternals = Object.freeze({
  canonicalize,
  payloadHash,
  parseDecimal,
  formatScale12,
  normalizeReservePayload,
  normalizeTransitionPayload,
  VALID_TRANSITIONS,
  TERMINAL_STATES,
});

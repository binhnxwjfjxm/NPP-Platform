// Phase 4.3 inventory reservations service.
// State machine: ACTIVE -> RELEASED | CONSUMED | EXPIRED | CANCELLED (terminal).

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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const DECIMAL_PATTERN = /^(?:0|[1-9]\d{0,13})(?:\.\d{1,12})?$/;
const CODE_PATTERN = /^[A-Z0-9_.-]{1,64}$/;
const SCALE_12 = 1_000_000_000_000n;

const VALID_TRANSITIONS = Object.freeze({
  CREATE_ACTIVE: Object.freeze({ from: null, to: 'ACTIVE' }),
  RELEASE_TO_RELEASED: Object.freeze({ from: 'ACTIVE', to: 'RELEASED' }),
  CONSUME_TO_CONSUMED: Object.freeze({ from: 'ACTIVE', to: 'CONSUMED' }),
  EXPIRE_TO_EXPIRED: Object.freeze({ from: 'ACTIVE', to: 'EXPIRED' }),
  CANCEL_TO_CANCELLED: Object.freeze({ from: 'ACTIVE', to: 'CANCELLED' }),
});

const TERMINAL_STATES = new Set(['RELEASED', 'CONSUMED', 'EXPIRED', 'CANCELLED']);
const PARTIAL_TRANSITION_FIELDS = Object.freeze([
  'quantity',
  'releaseQuantity',
  'consumeQuantity',
  'partialQuantity',
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

function canonicalize(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
  );
}

function payloadHash(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function formatScale12(value) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / SCALE_12;
  const fractional = String(absolute % SCALE_12).padStart(12, '0');
  return `${negative ? '-' : ''}${whole}.${fractional}`;
}

function parseDecimal(value, field, allowZero = false) {
  const normalized = typeof value === 'string' ? text(value, 32) : null;
  if (!normalized || !DECIMAL_PATTERN.test(normalized)) {
    return failure(
      'INVALID_QUANTITY',
      `${field} must be a decimal string with at most 12 fractional digits`,
    );
  }

  const [whole, fractional = ''] = normalized.split('.');
  const scaled = BigInt(whole) * SCALE_12
    + BigInt((fractional + '000000000000').slice(0, 12));

  if (!allowZero && scaled <= 0n) {
    return failure('INVALID_QUANTITY', `${field} must be greater than zero`);
  }
  if (scaled < 0n) {
    return failure('INVALID_QUANTITY', `${field} must be non-negative`);
  }

  return Object.freeze({ ok: true, scaled, value: formatScale12(scaled) });
}

function parseStoredScale12(value) {
  const normalized = String(value ?? '').trim();
  const match = /^(-?)(\d+)(?:\.(\d{1,12}))?$/.exec(normalized);
  if (!match) throw new Error('invalid_stored_inventory_quantity');
  const fractional = (match[3] ?? '').padEnd(12, '0');
  const scaled = BigInt(match[2]) * SCALE_12 + BigInt(fractional || '0');
  return match[1] === '-' ? -scaled : scaled;
}

function validateRequestContext(requestContext) {
  if (!requestContext
    || typeof requestContext.installationId !== 'string'
    || !requestContext.installationId.trim()
    || typeof requestContext.actorId !== 'string'
    || !requestContext.actorId.trim()
    || typeof requestContext.requestId !== 'string'
    || !requestContext.requestId.trim()
    || typeof requestContext.sourceApp !== 'string'
    || !requestContext.sourceApp.trim()) {
    return failure(
      'INVALID_REQUEST_CONTEXT',
      'A complete server-owned request context is required',
    );
  }
  return null;
}

function hasPermission(requestContext, permission) {
  const grantedPermissions = requestContext?.grantedPermissions ?? [];
  return Array.isArray(grantedPermissions) && grantedPermissions.includes(permission);
}

function warehouseScope(requestContext) {
  const ids = requestContext?.scopes?.warehouseIds;
  return Array.isArray(ids)
    ? new Set(ids.filter((id) => typeof id === 'string' && id.trim()))
    : new Set();
}

function validateIdentity(value, code, message) {
  return typeof value === 'string' && UUID_PATTERN.test(value)
    ? null
    : failure(code, message);
}

function validateIdempotencyKey(value) {
  return typeof value === 'string' && IDEMPOTENCY_PATTERN.test(value)
    ? null
    : failure(
      'INVALID_IDEMPOTENCY_KEY',
      'idempotencyKey must contain 1-128 safe characters',
    );
}

async function replayOrMismatch(client, { installationId, idempotencyKey, hash }) {
  const existing = await repository.getReservationByIdempotencyKey(client, {
    installationId,
    idempotencyKey,
  });
  if (!existing) return null;
  if (existing.payload_hash !== hash) {
    return failure(
      'IDEMPOTENCY_PAYLOAD_MISMATCH',
      'Idempotency key was already used with a different payload',
    );
  }
  const events = await repository.listReservationEvents(client, {
    installationId,
    reservationId: existing.id,
  });
  return Object.freeze({
    ok: true,
    reservation: existing,
    events: Object.freeze(events),
    replayed: true,
  });
}

function normalizeReservePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return failure('INVALID_INPUT', 'Reservation payload is required');
  }

  const warehouseError = validateIdentity(
    payload.warehouseId,
    'INVALID_WAREHOUSE_ID',
    'warehouseId is invalid UUID',
  );
  if (warehouseError) return warehouseError;

  if (payload.locationId !== undefined && payload.locationId !== null && payload.locationId !== '') {
    const locationError = validateIdentity(
      payload.locationId,
      'INVALID_LOCATION_ID',
      'locationId is invalid UUID',
    );
    if (locationError) return locationError;
  }

  const variantError = validateIdentity(
    payload.baseVariantId,
    'INVALID_BASE_VARIANT_ID',
    'baseVariantId is invalid UUID',
  );
  if (variantError) return variantError;

  if (payload.lotId !== undefined && payload.lotId !== null && payload.lotId !== '') {
    const lotError = validateIdentity(payload.lotId, 'INVALID_LOT_ID', 'lotId is invalid UUID');
    if (lotError) return lotError;
  }

  const quantity = parseDecimal(payload.quantity, 'quantity');
  if (!quantity.ok) return quantity;

  const sourceDomain = String(payload.sourceDomain ?? 'UNKNOWN').trim().toUpperCase();
  if (!CODE_PATTERN.test(sourceDomain)) {
    return failure('INVALID_SOURCE_DOMAIN', 'sourceDomain is invalid');
  }

  const sourceDocumentType = text(payload.sourceDocumentType, 64)?.toUpperCase() ?? null;
  if (sourceDocumentType && !CODE_PATTERN.test(sourceDocumentType)) {
    return failure('INVALID_SOURCE_DOCUMENT_TYPE', 'sourceDocumentType is invalid');
  }

  const metadata = objectValue(payload.metadata);
  if (metadata === null) {
    return failure('INVALID_METADATA', 'metadata must be a JSON object no larger than 16 KB');
  }

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
      sourceDocumentId: text(payload.sourceDocumentId, 160),
      metadata,
    }),
  });
}

async function createReservation(client, { requestContext, idempotencyKey, payload }) {
  const contextError = validateRequestContext(requestContext);
  if (contextError) return contextError;

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

  const allowedWarehouses = warehouseScope(requestContext);
  if (allowedWarehouses.size === 0 || !allowedWarehouses.has(normalized.value.warehouseId)) {
    return failure(
      'WAREHOUSE_SCOPE_DENIED',
      'Warehouse is outside the server-owned request scope',
    );
  }

  const warehouse = await repository.resolveWarehouseLocation(client, {
    installationId: requestContext.installationId,
    warehouseId: normalized.value.warehouseId,
    locationId: normalized.value.locationId,
  });
  if (!warehouse || !warehouse.warehouse_active) {
    return failure('WAREHOUSE_NOT_AVAILABLE', 'Warehouse is missing or inactive');
  }
  if (normalized.value.locationId && (!warehouse.location_id || !warehouse.location_active)) {
    return failure(
      'LOCATION_NOT_AVAILABLE',
      'Location is missing, inactive or belongs to another warehouse',
    );
  }

  const variant = await repository.resolveVariant(client, {
    installationId: requestContext.installationId,
    baseVariantId: normalized.value.baseVariantId,
  });
  if (!variant || !variant.is_active || !variant.unit_active) {
    return failure('VARIANT_NOT_AVAILABLE', 'Base variant or its unit is missing or inactive');
  }
  if (!variant.is_inventory_base) {
    return failure(
      'BASE_VARIANT_REQUIRED',
      'Reservations must target the active inventory-base variant',
    );
  }
  if (!variant.allows_fractional && normalized.value.quantityScaled % SCALE_12 !== 0n) {
    return failure(
      'FRACTIONAL_QUANTITY_NOT_ALLOWED',
      'The inventory-base unit does not allow fractional quantity',
    );
  }

  await repository.lockReservationScope(client, {
    installationId: requestContext.installationId,
    warehouseId: normalized.value.warehouseId,
    locationId: normalized.value.locationId,
    baseVariantId: normalized.value.baseVariantId,
    lotId: normalized.value.lotId,
  });

  const balance = await repository.resolveReservationBalance(client, {
    installationId: requestContext.installationId,
    warehouseId: normalized.value.warehouseId,
    locationId: normalized.value.locationId,
    baseVariantId: normalized.value.baseVariantId,
    lotId: normalized.value.lotId,
  });

  const onHand = balance ? parseStoredScale12(balance.on_hand_quantity) : 0n;
  const reserved = balance ? parseStoredScale12(balance.reserved_quantity) : 0n;
  const available = onHand - reserved;
  if (normalized.value.quantityScaled > available) {
    return failure(
      'INSUFFICIENT_AVAILABLE_QUANTITY',
      'Requested quantity exceeds available balance; negative stock is denied by default',
    );
  }

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

  return Object.freeze({
    ok: true,
    reservation,
    events: Object.freeze([event]),
    replayed: false,
  });
}

function normalizeTransitionPayload(transition, payload) {
  if (!VALID_TRANSITIONS[transition]) {
    return failure('INVALID_TRANSITION', `Transition ${transition} is not recognized`);
  }

  if (payload && PARTIAL_TRANSITION_FIELDS.some(
    (field) => Object.prototype.hasOwnProperty.call(payload, field),
  )) {
    return failure(
      'PARTIAL_RESERVATION_NOT_SUPPORTED',
      'P4.3 transitions apply to the complete reservation quantity',
    );
  }

  const metadata = objectValue(payload?.metadata);
  if (metadata === null) {
    return failure('INVALID_METADATA', 'metadata must be a JSON object no larger than 16 KB');
  }

  return Object.freeze({
    ok: true,
    value: Object.freeze({
      transition,
      reason: text(payload?.reason, 500),
      metadata,
    }),
  });
}

async function transitionReservation(client, {
  requestContext,
  reservationId,
  transition,
  payload,
}) {
  const contextError = validateRequestContext(requestContext);
  if (contextError) return contextError;

  if (!hasPermission(requestContext, PERMISSIONS.coreInventoryReserve)) {
    return failure('PERMISSION_DENIED', 'Permission core.inventory.reserve is required');
  }

  const reservationError = validateIdentity(
    reservationId,
    'INVALID_RESERVATION_ID',
    'reservationId is invalid UUID',
  );
  if (reservationError) return reservationError;

  const normalized = normalizeTransitionPayload(transition, payload);
  if (!normalized.ok) return normalized;

  const reservation = await repository.getReservationById(client, {
    installationId: requestContext.installationId,
    id: reservationId,
    forUpdate: true,
  });
  if (!reservation) return failure('RESERVATION_NOT_FOUND', 'Reservation was not found');

  if (TERMINAL_STATES.has(reservation.state)) {
    return failure(
      'TERMINAL_STATE_NO_TRANSITION',
      `Reservation in terminal state ${reservation.state} cannot transition`,
    );
  }

  const transitionDef = VALID_TRANSITIONS[normalized.value.transition];
  if (transitionDef.from !== reservation.state) {
    return failure(
      'INVALID_STATE_TRANSITION',
      `Cannot transition from ${reservation.state} with ${normalized.value.transition}`,
    );
  }

  const allowedWarehouses = warehouseScope(requestContext);
  if (allowedWarehouses.size === 0 || !allowedWarehouses.has(reservation.warehouse_id)) {
    return failure(
      'WAREHOUSE_SCOPE_DENIED',
      'Reservation warehouse is outside the server-owned request scope',
    );
  }

  const now = requestContext.receivedAt ?? new Date().toISOString();
  const updated = await repository.updateReservationState(client, {
    installationId: requestContext.installationId,
    id: reservationId,
    state: transitionDef.to,
    transitionedAt: now,
  });

  const hash = payloadHash({
    reservationId,
    transition: normalized.value.transition,
    reason: normalized.value.reason,
    metadata: normalized.value.metadata,
  });
  await repository.insertReservationEvent(client, {
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

  return Object.freeze({
    ok: true,
    reservation: updated,
    events: Object.freeze(events),
    replayed: false,
  });
}

async function executeWithReservationAudit({
  adapter,
  requestContext,
  operation,
  action,
  eventType,
}) {
  const transaction = await withAuditOutboxTransaction({
    adapter,
    mutate: async (client) => {
      await client.query(
        "SELECT set_config('npp.inventory_reservation_write_context', 'reservation_service', true)",
      );

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
    operation: (client) => createReservation(client, {
      requestContext,
      idempotencyKey,
      payload,
    }),
    action: 'inventory.reserve',
    eventType: 'core.inventory.reservation.created',
  });
}

function executeTransition({
  adapter,
  requestContext,
  reservationId,
  payload,
  transition,
  action,
  eventType,
}) {
  return executeWithReservationAudit({
    adapter,
    requestContext,
    operation: (client) => transitionReservation(client, {
      requestContext,
      reservationId,
      transition,
      payload,
    }),
    action,
    eventType,
  });
}

export function executeReleaseReservation(args) {
  return executeTransition({
    ...args,
    transition: 'RELEASE_TO_RELEASED',
    action: 'inventory.release',
    eventType: 'core.inventory.reservation.released',
  });
}

export function executeConsumeReservation(args) {
  return executeTransition({
    ...args,
    transition: 'CONSUME_TO_CONSUMED',
    action: 'inventory.consume',
    eventType: 'core.inventory.reservation.consumed',
  });
}

export function executeExpireReservation(args) {
  return executeTransition({
    ...args,
    transition: 'EXPIRE_TO_EXPIRED',
    action: 'inventory.expire',
    eventType: 'core.inventory.reservation.expired',
  });
}

export function executeCancelReservation(args) {
  return executeTransition({
    ...args,
    transition: 'CANCEL_TO_CANCELLED',
    action: 'inventory.cancel',
    eventType: 'core.inventory.reservation.cancelled',
  });
}

export const inventoryReservationInternals = Object.freeze({
  canonicalize,
  payloadHash,
  parseDecimal,
  parseStoredScale12,
  formatScale12,
  normalizeReservePayload,
  normalizeTransitionPayload,
  VALID_TRANSITIONS,
  TERMINAL_STATES,
});

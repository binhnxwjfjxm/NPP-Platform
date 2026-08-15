import { createHash } from 'node:crypto';
import {
  buildAuditRecord,
  buildOutboxEvent,
  insertAuditRecord,
  insertOutboxEvent,
  withAuditOutboxTransaction,
} from '../audit-outbox.js';
import * as repository from '../db/repositories/logistics-trip-recovery.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function failure(code, message, retryable = false, details = {}) {
  return Object.freeze({ ok: false, code, message, retryable, details });
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function payloadHash(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function hasPermission(requestContext, permission) {
  return new Set([
    ...(requestContext?.permissions ?? []),
    ...(requestContext?.grantedPermissions ?? []),
  ]).has(permission);
}

function warehouseAllowed(requestContext, warehouseId) {
  return Array.isArray(requestContext?.scopes?.warehouseIds)
    && requestContext.scopes.warehouseIds.includes(warehouseId);
}

function validateReason(payload) {
  const reason = String(payload?.reason ?? '').trim();
  if (!reason || reason.length > 1000) return failure('REVERSAL_REASON_REQUIRED', 'Reversal reason is required');
  return Object.freeze({ ok: true, reason });
}

function mapTrip(row) {
  return Object.freeze({
    id: row.id,
    number: row.trip_number,
    warehouseId: row.warehouse_id,
    status: row.status,
    revision: String(row.revision),
    dispatchId: row.dispatch_id ?? null,
    dispatchedAt: row.dispatched_at ?? null,
    recoveredAt: row.recovered_at ?? null,
    recoveredBy: row.recovered_by ?? null,
    recoveryReason: row.recovery_reason ?? null,
  });
}

export async function executeRecoverDeliveryTrip({
  adapter,
  requestContext,
  tripId,
  idempotencyKey,
  payload,
}) {
  if (!hasPermission(requestContext, 'core.delivery-trip.dispatch')) {
    return failure('PERMISSION_DENIED', 'Permission core.delivery-trip.dispatch is required');
  }
  if (!UUID_PATTERN.test(tripId ?? '')) return failure('INVALID_IDENTITY', 'tripId is invalid');
  const reasonResult = validateReason(payload);
  if (!reasonResult.ok) return reasonResult;
  const hash = payloadHash({ tripId, operation: 'recover-dispatch', reason: reasonResult.reason });

  const transaction = await withAuditOutboxTransaction({
    adapter,
    mutate: async (client) => {
      await repository.setTripRecoveryWriteContext(client);
      await repository.lockRecoveryKey(client, { installationId: requestContext.installationId, tripId, idempotencyKey });
      const replay = await repository.getTripEventByKey(client, { installationId: requestContext.installationId, idempotencyKey });
      if (replay) {
        if (replay.payload_hash !== hash || replay.trip_id !== tripId || replay.event_type !== 'DISPATCH_RECOVERED') {
          return { failed: failure('IDEMPOTENCY_PAYLOAD_MISMATCH', 'Idempotency key was used with another trip recovery payload') };
        }
        const current = await repository.getTripForUpdate(client, { installationId: requestContext.installationId, tripId });
        if (!current) return { failed: failure('DELIVERY_TRIP_NOT_FOUND', 'Delivery trip was not found') };
        return Object.freeze({ ok: true, replayed: true, trip: mapTrip(current) });
      }
      const trip = await repository.getTripForUpdate(client, { installationId: requestContext.installationId, tripId });
      if (!trip) return { failed: failure('DELIVERY_TRIP_NOT_FOUND', 'Delivery trip was not found') };
      if (!warehouseAllowed(requestContext, trip.warehouse_id)) return { failed: failure('WAREHOUSE_SCOPE_DENIED', 'Trip is outside the authorized warehouse scope') };
      if (trip.status !== 'dispatched') return { failed: failure('TRIP_RECOVERY_NOT_ALLOWED', 'Only a dispatched trip can enter recovery') };
      if (await repository.hasDeliveryAttempts(client, { installationId: requestContext.installationId, tripId })) {
        return { failed: failure('TRIP_RECOVERY_BLOCKED_BY_DELIVERY_ATTEMPT', 'Trip recovery is blocked after any delivery attempt has been recorded') };
      }
      const occurredAt = requestContext.receivedAt ?? new Date().toISOString();
      const updated = await repository.markTripRecovered(client, {
        installationId: requestContext.installationId,
        tripId,
        reason: reasonResult.reason,
        idempotencyKey,
        payloadHash: hash,
        actorId: requestContext.actorId,
        occurredAt,
      });
      if (!updated) return { failed: failure('TRIP_RECOVERY_CONFLICT', 'Trip changed concurrently', true) };
      await repository.insertRecoveryEvent(client, {
        installationId: requestContext.installationId,
        tripId,
        eventType: 'DISPATCH_RECOVERED',
        idempotencyKey,
        payloadHash: hash,
        actorId: requestContext.actorId,
        requestId: requestContext.requestId,
        sourceApp: requestContext.sourceApp,
        reason: reasonResult.reason,
        metadata: { dispatchId: trip.dispatch_id },
        occurredAt,
      });
      const after = mapTrip(updated);
      const audit = buildAuditRecord({
        requestContext,
        action: 'logistics.trip.dispatch.recover',
        resourceType: 'delivery_trip',
        resourceId: tripId,
        beforeData: mapTrip(trip),
        afterData: after,
        metadata: { reason: reasonResult.reason },
      });
      const outbox = buildOutboxEvent({
        requestContext,
        aggregateType: 'logistics.delivery_trip',
        aggregateId: tripId,
        eventType: 'core.logistics.trip.dispatch_recovered',
        eventVersion: Number(updated.revision),
        payload: after,
        metadata: { reason: reasonResult.reason },
      });
      await insertAuditRecord(client, audit);
      await insertOutboxEvent(client, outbox);
      return Object.freeze({ ok: true, replayed: false, trip: after, auditId: audit.auditId, eventId: outbox.eventId });
    },
  });
  return transaction?.failed ?? transaction;
}

export async function executeRecoveryUnassignDeliveryOrder({
  adapter,
  requestContext,
  tripId,
  assignmentId,
  idempotencyKey,
  payload,
}) {
  if (!hasPermission(requestContext, 'core.delivery-trip.dispatch')) {
    return failure('PERMISSION_DENIED', 'Permission core.delivery-trip.dispatch is required');
  }
  if (!UUID_PATTERN.test(tripId ?? '') || !UUID_PATTERN.test(assignmentId ?? '')) {
    return failure('INVALID_IDENTITY', 'tripId or assignmentId is invalid');
  }
  const reasonResult = validateReason(payload);
  if (!reasonResult.ok) return reasonResult;
  const hash = payloadHash({ tripId, assignmentId, operation: 'recovery-unassign', reason: reasonResult.reason });

  const transaction = await withAuditOutboxTransaction({
    adapter,
    mutate: async (client) => {
      await repository.setTripRecoveryWriteContext(client);
      await repository.lockRecoveryKey(client, { installationId: requestContext.installationId, tripId, idempotencyKey });
      const replay = await repository.getTripEventByKey(client, { installationId: requestContext.installationId, idempotencyKey });
      if (replay) {
        if (replay.payload_hash !== hash || replay.trip_id !== tripId || replay.event_type !== 'RECOVERY_UNASSIGNED') {
          return { failed: failure('IDEMPOTENCY_PAYLOAD_MISMATCH', 'Idempotency key was used with another recovery-unassign payload') };
        }
        return Object.freeze({ ok: true, replayed: true, tripId, assignmentId });
      }
      const assignment = await repository.getAssignmentForRecovery(client, {
        installationId: requestContext.installationId,
        tripId,
        assignmentId,
      });
      if (!assignment) return { failed: failure('TRIP_ASSIGNMENT_NOT_FOUND', 'Trip assignment was not found') };
      if (!warehouseAllowed(requestContext, assignment.warehouse_id)) return { failed: failure('WAREHOUSE_SCOPE_DENIED', 'Trip is outside the authorized warehouse scope') };
      if (assignment.trip_status !== 'recovered') return { failed: failure('TRIP_RECOVERY_NOT_ACTIVE', 'Trip must be recovered before recovery-unassign') };
      if (assignment.unassigned_at) return { failed: failure('TRIP_ASSIGNMENT_ALREADY_UNASSIGNED', 'Trip assignment is already unassigned') };
      if (assignment.inventory_issue_status !== 'REVERSED') {
        return { failed: failure('RECOVERY_UNASSIGN_BLOCKED_BY_INVENTORY_ISSUE', 'Reverse the Delivery Order inventory issue before unassigning it from the recovered trip') };
      }
      const occurredAt = requestContext.receivedAt ?? new Date().toISOString();
      const updated = await repository.recoveryUnassign(client, {
        installationId: requestContext.installationId,
        tripId,
        assignmentId,
        reason: reasonResult.reason,
        actorId: requestContext.actorId,
        occurredAt,
      });
      if (!updated) return { failed: failure('RECOVERY_UNASSIGN_CONFLICT', 'Trip assignment changed concurrently', true) };
      await repository.insertRecoveryEvent(client, {
        installationId: requestContext.installationId,
        tripId,
        eventType: 'RECOVERY_UNASSIGNED',
        idempotencyKey,
        payloadHash: hash,
        actorId: requestContext.actorId,
        requestId: requestContext.requestId,
        sourceApp: requestContext.sourceApp,
        reason: reasonResult.reason,
        metadata: { assignmentId, deliveryOrderId: assignment.delivery_order_id, inventoryIssueId: assignment.inventory_issue_id },
        occurredAt,
      });
      const audit = buildAuditRecord({
        requestContext,
        action: 'logistics.trip.recovery.unassign',
        resourceType: 'trip_order_assignment',
        resourceId: assignmentId,
        beforeData: { tripId, assignmentId, unassignedAt: null },
        afterData: { tripId, assignmentId, unassignedAt: updated.unassigned_at, reason: reasonResult.reason },
        metadata: { deliveryOrderId: assignment.delivery_order_id },
      });
      const outbox = buildOutboxEvent({
        requestContext,
        aggregateType: 'logistics.delivery_trip',
        aggregateId: tripId,
        eventType: 'core.logistics.trip.recovery_unassigned',
        eventVersion: 1,
        payload: { tripId, assignmentId, deliveryOrderId: assignment.delivery_order_id },
        metadata: { reason: reasonResult.reason },
      });
      await insertAuditRecord(client, audit);
      await insertOutboxEvent(client, outbox);
      return Object.freeze({ ok: true, replayed: false, tripId, assignmentId, auditId: audit.auditId, eventId: outbox.eventId });
    },
  });
  return transaction?.failed ?? transaction;
}

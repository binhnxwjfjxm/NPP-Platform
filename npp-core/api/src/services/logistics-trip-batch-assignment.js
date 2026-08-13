import { createHash, randomUUID } from 'node:crypto';
import {
  buildAuditRecord,
  buildOutboxEvent,
  insertAuditRecord,
  insertOutboxEvent,
  withAuditOutboxTransaction,
} from '../audit-outbox.js';
import * as repository from '../db/repositories/logistics-trip-planning.js';
import { getDeliveryTrip } from './logistics-trip-planning.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BATCH_SIZE = 100;

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

function warehouseAllowed(requestContext, warehouseId) {
  return Array.isArray(requestContext?.scopes?.warehouseIds)
    && requestContext.scopes.warehouseIds.includes(warehouseId);
}

function normalizePayload(payload) {
  const rawIds = Array.isArray(payload?.deliveryOrderIds)
    ? payload.deliveryOrderIds
    : payload?.deliveryOrderId
      ? [payload.deliveryOrderId]
      : [];
  if (rawIds.length < 1 || rawIds.length > MAX_BATCH_SIZE) {
    return failure('INVALID_DELIVERY_ORDER_BATCH', `Batch must contain between 1 and ${MAX_BATCH_SIZE} Delivery Orders`);
  }
  if (rawIds.some((id) => typeof id !== 'string' || !UUID_PATTERN.test(id))) {
    return failure('INVALID_DELIVERY_ORDER_BATCH', 'Every Delivery Order id must be a valid UUID');
  }
  const uniqueIds = [...new Set(rawIds)];
  if (uniqueIds.length !== rawIds.length) {
    return failure('INVALID_DELIVERY_ORDER_BATCH', 'Delivery Order batch contains duplicates');
  }
  const plannedArrivalAt = payload?.plannedArrivalAt ? new Date(payload.plannedArrivalAt) : null;
  if (plannedArrivalAt && Number.isNaN(plannedArrivalAt.getTime())) {
    return failure('INVALID_DELIVERY_ORDER_BATCH', 'Planned arrival time is invalid');
  }
  return Object.freeze({
    ok: true,
    deliveryOrderIds: Object.freeze(uniqueIds.sort()),
    plannedArrivalAt: plannedArrivalAt?.toISOString() ?? null,
  });
}

async function setWriteContext(client) {
  await client.query("SELECT set_config('npp.logistics_write_context', 'trip_planning_service', true)");
}

async function loadReplay(client, { requestContext, tripId, idempotencyKey, hash }) {
  const replay = await repository.findOperationReplay(client, {
    installationId: requestContext.installationId,
    idempotencyKey,
    forUpdate: true,
  });
  if (!replay) return null;
  if (replay.operation_type !== 'ASSIGN_BATCH' || replay.payload_hash !== hash || replay.trip_id !== tripId) {
    return failure('IDEMPOTENCY_PAYLOAD_MISMATCH', 'Idempotency key was used with another operation');
  }
  const detail = await getDeliveryTrip(client, { requestContext, tripId });
  if (!detail.ok) return detail;
  return Object.freeze({ ok: true, trip: detail.trip, replayed: true });
}

async function writeAuditOutbox(client, { requestContext, trip, beforeTrip, metadata }) {
  const action = 'core.delivery_trip.delivery_order_assigned';
  await insertAuditRecord(client, buildAuditRecord({
    requestContext,
    action,
    resourceType: 'delivery_trip',
    resourceId: trip.id,
    beforeData: beforeTrip,
    afterData: trip,
    metadata: { warehouseId: trip.warehouseId, status: trip.status, ...metadata },
  }));
  const outbox = buildOutboxEvent({
    requestContext,
    aggregateType: 'logistics.delivery_trip',
    aggregateId: trip.id,
    eventType: action,
    eventVersion: Number(trip.revision),
    payload: {
      tripId: trip.id,
      tripNumber: trip.number,
      warehouseId: trip.warehouseId,
      status: trip.status,
      vehicleId: trip.vehicleId,
      primaryDriverId: trip.primaryDriverId,
      stopCount: trip.stops?.length ?? trip.stopCount ?? 0,
    },
    metadata,
  });
  await insertOutboxEvent(client, outbox);
  return outbox.eventId;
}

export async function assignDeliveryOrders({ adapter, requestContext, tripId, payload, idempotencyKey }) {
  if (!UUID_PATTERN.test(String(tripId ?? ''))) return failure('INVALID_TRIP_ID', 'Trip id is invalid');
  const normalized = normalizePayload(payload);
  if (!normalized.ok) return normalized;
  const canonicalPayload = {
    deliveryOrderIds: normalized.deliveryOrderIds,
    plannedArrivalAt: normalized.plannedArrivalAt,
  };
  const hash = payloadHash({ tripId, operationType: 'ASSIGN_BATCH', payload: canonicalPayload });

  try {
    const transaction = await withAuditOutboxTransaction({
      adapter,
      mutate: async (client) => {
        let replay = await loadReplay(client, { requestContext, tripId, idempotencyKey, hash });
        if (replay) return replay.ok ? replay : { failed: true, result: replay };

        const tripRow = await repository.getTrip(client, {
          installationId: requestContext.installationId,
          tripId,
          forUpdate: true,
        });
        if (!tripRow) return { failed: true, result: failure('DELIVERY_TRIP_NOT_FOUND', 'Delivery trip was not found') };
        if (!warehouseAllowed(requestContext, tripRow.warehouse_id)) {
          return { failed: true, result: failure('WAREHOUSE_SCOPE_DENIED', 'Delivery trip is outside the authorized warehouse scope') };
        }
        if (tripRow.status === 'locked') {
          return { failed: true, result: failure('DELIVERY_TRIP_LOCKED', 'Locked trip cannot be changed') };
        }
        if (tripRow.status !== 'draft') {
          return { failed: true, result: failure('DELIVERY_TRIP_NOT_EDITABLE', 'Planned trip is read-only; reopen it before making changes') };
        }

        replay = await loadReplay(client, { requestContext, tripId, idempotencyKey, hash });
        if (replay) return replay.ok ? replay : { failed: true, result: replay };

        const before = await getDeliveryTrip(client, { requestContext, tripId });
        if (!before.ok) return { failed: true, result: before };

        // Lock every Delivery Order in canonical UUID order before any write. This makes
        // overlapping batches deterministic and ensures a validation failure leaves no
        // stop or assignment behind.
        const deliveryOrders = [];
        for (const deliveryOrderId of normalized.deliveryOrderIds) {
          const deliveryOrder = await repository.getDeliveryOrderForAssignment(client, {
            installationId: requestContext.installationId,
            deliveryOrderId,
          });
          if (!deliveryOrder) {
            return { failed: true, result: failure('DELIVERY_ORDER_NOT_FOUND', 'Delivery Order was not found', false, { deliveryOrderId }) };
          }
          if (deliveryOrder.status !== 'ready_to_dispatch' || deliveryOrder.handover_mode !== 'DELIVERY') {
            return { failed: true, result: failure('DELIVERY_ORDER_NOT_ELIGIBLE', 'Delivery Order is not ready for trip planning', false, { deliveryOrderId }) };
          }
          if (deliveryOrder.warehouse_id !== tripRow.warehouse_id) {
            return { failed: true, result: failure('DELIVERY_ORDER_WAREHOUSE_MISMATCH', 'Delivery Order belongs to another warehouse', false, { deliveryOrderId }) };
          }
          deliveryOrders.push(deliveryOrder);
        }

        for (const deliveryOrderId of normalized.deliveryOrderIds) {
          const active = await repository.findActiveAssignment(client, {
            installationId: requestContext.installationId,
            deliveryOrderId,
            forUpdate: true,
          });
          if (active) {
            return { failed: true, result: failure('DELIVERY_ORDER_ALREADY_ASSIGNED', 'Delivery Order already has an active trip assignment', false, { deliveryOrderId }) };
          }
        }

        await setWriteContext(client);
        const assignments = [];
        for (const deliveryOrder of deliveryOrders) {
          let stop = await repository.findStop(client, {
            installationId: requestContext.installationId,
            tripId,
            customerId: deliveryOrder.customer_id,
            customerAddressId: deliveryOrder.customer_address_id,
          });
          if (!stop) {
            const stopSequence = await repository.nextStopSequence(client, {
              installationId: requestContext.installationId,
              tripId,
            });
            stop = await repository.insertStop(client, {
              id: randomUUID(),
              installationId: requestContext.installationId,
              tripId,
              stopSequence,
              customerId: deliveryOrder.customer_id,
              customerAddressId: deliveryOrder.customer_address_id,
              addressSnapshot: deliveryOrder.destination_snapshot,
              plannedArrivalAt: normalized.plannedArrivalAt,
              actorId: requestContext.actorId,
            });
          }
          await repository.insertAssignment(client, {
            id: randomUUID(),
            installationId: requestContext.installationId,
            tripId,
            tripStopId: stop.id,
            deliveryOrderId: deliveryOrder.id,
            actorId: requestContext.actorId,
          });
          assignments.push(Object.freeze({ deliveryOrderId: deliveryOrder.id, stopId: stop.id }));
        }

        const metadata = Object.freeze({
          deliveryOrderIds: normalized.deliveryOrderIds,
          assignmentCount: assignments.length,
          assignments: Object.freeze(assignments),
          ...(assignments.length === 1 ? assignments[0] : {}),
        });
        await repository.insertTripEvent(client, {
          id: randomUUID(),
          installationId: requestContext.installationId,
          tripId,
          eventType: 'ASSIGNED',
          idempotencyKey,
          payloadHash: hash,
          actorId: requestContext.actorId,
          requestId: requestContext.requestId,
          sourceApp: requestContext.sourceApp,
          reason: null,
          metadata,
        });

        const detail = await getDeliveryTrip(client, { requestContext, tripId });
        if (!detail.ok) return { failed: true, result: detail };
        const eventId = await writeAuditOutbox(client, {
          requestContext,
          trip: detail.trip,
          beforeTrip: before.trip,
          metadata,
        });
        await repository.insertOperationReplay(client, {
          id: randomUUID(),
          installationId: requestContext.installationId,
          operationType: 'ASSIGN_BATCH',
          idempotencyKey,
          payloadHash: hash,
          tripId,
          responseSnapshot: {
            tripId,
            revision: detail.trip.revision,
            eventType: 'ASSIGNED',
            assignmentCount: assignments.length,
          },
          actorId: requestContext.actorId,
        });
        return { ok: true, trip: detail.trip, replayed: false, assignmentCount: assignments.length, eventId };
      },
    });

    if (transaction.failed) return transaction.result;
    return Object.freeze({
      ok: true,
      trip: transaction.trip,
      replayed: Boolean(transaction.replayed),
      assignmentCount: transaction.assignmentCount ?? normalized.deliveryOrderIds.length,
    });
  } catch (error) {
    if (error?.constraint === 'trip_order_assignments_active_delivery_order_unique') {
      return failure('DELIVERY_ORDER_ALREADY_ASSIGNED', 'Delivery Order already has an active trip assignment');
    }
    return failure('DELIVERY_TRIP_TRANSACTION_FAILED', 'Delivery trip transaction failed', true);
  }
}

export const logisticsTripBatchAssignmentInternals = Object.freeze({ normalizePayload, payloadHash });

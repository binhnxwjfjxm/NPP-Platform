import { createHash } from 'node:crypto';
import {
  buildAuditRecord,
  buildOutboxEvent,
  insertAuditRecord,
  insertOutboxEvent,
  withAuditOutboxTransaction,
} from '../audit-outbox.js';
import * as repository from '../db/repositories/sales-delivery-order-reversal.js';
import { refreshSalesOrderDeliveryStatus } from '../db/repositories/sales-delivery-orders.js';

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

function mapDeliveryOrder(row) {
  return Object.freeze({
    id: row.id,
    number: row.delivery_order_number ?? null,
    salesOrderId: row.sales_order_id,
    warehouseId: row.warehouse_id,
    handoverMode: row.handover_mode,
    status: row.status,
    revision: String(row.revision),
    cancelledAt: row.cancelled_at ?? null,
    cancelledBy: row.cancelled_by ?? null,
    cancellationReason: row.cancellation_reason ?? null,
  });
}

export async function executeReleaseDeliveryOrderForReversal({
  adapter,
  requestContext,
  deliveryOrderId,
  idempotencyKey,
  payload,
}) {
  if (!hasPermission(requestContext, 'core.delivery-order.cancel')) {
    return failure('PERMISSION_DENIED', 'Permission core.delivery-order.cancel is required');
  }
  if (!UUID_PATTERN.test(deliveryOrderId ?? '')) {
    return failure('INVALID_IDENTITY', 'deliveryOrderId is invalid');
  }
  const reason = String(payload?.reason ?? '').trim();
  if (!reason || reason.length > 1000) {
    return failure('REVERSAL_REASON_REQUIRED', 'Reversal reason is required');
  }
  const operationPayload = Object.freeze({ deliveryOrderId, operation: 'release-for-reversal', reason });
  const hash = payloadHash(operationPayload);

  const transaction = await withAuditOutboxTransaction({
    adapter,
    mutate: async (client) => {
      await repository.setDeliveryReversalWriteContext(client);
      await repository.lockOperationKey(client, {
        installationId: requestContext.installationId,
        idempotencyKey,
      });
      const replay = await repository.getDeliveryOrderEventByKey(client, {
        installationId: requestContext.installationId,
        idempotencyKey,
      });
      if (replay) {
        if (replay.payload_hash !== hash || replay.delivery_order_id !== deliveryOrderId || replay.event_type !== 'RELEASED_FOR_REVERSAL') {
          return { failed: failure('IDEMPOTENCY_PAYLOAD_MISMATCH', 'Idempotency key was used with another Delivery Order reversal payload') };
        }
        const header = await repository.getDeliveryOrderForUpdate(client, {
          installationId: requestContext.installationId,
          deliveryOrderId,
        });
        if (!header) return { failed: failure('DELIVERY_ORDER_NOT_FOUND', 'Delivery Order was not found') };
        return Object.freeze({ ok: true, replayed: true, deliveryOrder: mapDeliveryOrder(header) });
      }

      const header = await repository.getDeliveryOrderForUpdate(client, {
        installationId: requestContext.installationId,
        deliveryOrderId,
      });
      if (!header) return { failed: failure('DELIVERY_ORDER_NOT_FOUND', 'Delivery Order was not found') };
      if (!warehouseAllowed(requestContext, header.warehouse_id)) {
        return { failed: failure('WAREHOUSE_SCOPE_DENIED', 'Delivery Order is outside the authorized warehouse scope') };
      }
      if (header.sales_order_status !== 'confirmed') {
        return { failed: failure('SALES_ORDER_NOT_CONFIRMED', 'Source Sales Order is not confirmed') };
      }
      if (header.status !== 'ready_to_dispatch') {
        return { failed: failure('DELIVERY_ORDER_NOT_READY_FOR_REVERSAL', 'Delivery Order must be ready_to_dispatch before release for reversal') };
      }
      const blockers = await repository.getReleaseBlockers(client, {
        installationId: requestContext.installationId,
        deliveryOrderId,
      });
      if (blockers.has_active_inventory_issue) {
        return { failed: failure(
          'DELIVERY_ORDER_REVERSAL_BLOCKED_BY_INVENTORY_ISSUE',
          'Reverse the active inventory issue before releasing the Delivery Order',
        ) };
      }
      if (blockers.has_active_trip_assignment) {
        return { failed: failure(
          'DELIVERY_ORDER_REVERSAL_BLOCKED_BY_TRIP',
          'Unassign the Delivery Order from its recovered trip before release',
        ) };
      }

      const occurredAt = requestContext.receivedAt ?? new Date().toISOString();
      const updated = await repository.releaseDeliveryOrderForReversal(client, {
        installationId: requestContext.installationId,
        deliveryOrderId,
        reason,
        actorId: requestContext.actorId,
        occurredAt,
      });
      if (!updated) return { failed: failure('DELIVERY_ORDER_REVERSAL_CONFLICT', 'Delivery Order changed concurrently', true) };
      await repository.insertDeliveryOrderEvent(client, {
        installationId: requestContext.installationId,
        deliveryOrderId,
        idempotencyKey,
        payloadHash: hash,
        actorId: requestContext.actorId,
        requestId: requestContext.requestId,
        sourceApp: requestContext.sourceApp,
        reason,
        metadata: { salesOrderId: header.sales_order_id },
        occurredAt,
      });
      await refreshSalesOrderDeliveryStatus(client, {
        installationId: requestContext.installationId,
        salesOrderId: header.sales_order_id,
        actorId: requestContext.actorId,
      });
      const after = mapDeliveryOrder(updated);
      const audit = buildAuditRecord({
        requestContext,
        action: 'sales.delivery_order.release_for_reversal',
        resourceType: 'delivery_order',
        resourceId: deliveryOrderId,
        beforeData: mapDeliveryOrder(header),
        afterData: after,
        metadata: { salesOrderId: header.sales_order_id, reason },
      });
      const outbox = buildOutboxEvent({
        requestContext,
        aggregateType: 'sales.delivery_order',
        aggregateId: deliveryOrderId,
        eventType: 'core.sales.delivery_order.released_for_reversal',
        eventVersion: Number(updated.revision),
        payload: after,
        metadata: { salesOrderId: header.sales_order_id, reason },
      });
      await insertAuditRecord(client, audit);
      await insertOutboxEvent(client, outbox);
      return Object.freeze({ ok: true, replayed: false, deliveryOrder: after, auditId: audit.auditId, eventId: outbox.eventId });
    },
  });
  return transaction?.failed ?? transaction;
}

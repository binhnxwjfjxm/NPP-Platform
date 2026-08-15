import { createHash, randomUUID } from 'node:crypto';
import {
  buildAuditRecord,
  buildOutboxEvent,
  insertAuditRecord,
  insertOutboxEvent,
  withAuditOutboxTransaction,
} from '../audit-outbox.js';
import * as repository from '../db/repositories/sales-fulfillment-reversal.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const QUANTITY_PATTERN = /^(0|[1-9]\d{0,17})(?:\.(\d{1,12}))?$/;
const SCALE = 1_000_000_000_000n;

function failure(code, message, retryable = false, details = {}) {
  return Object.freeze({ ok: false, code, message, retryable, details });
}

function canonicalize(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function payloadHash(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function parseQuantity(value) {
  const normalized = String(value ?? '').trim();
  const match = QUANTITY_PATTERN.exec(normalized);
  if (!match) return null;
  return BigInt(match[1]) * SCALE + BigInt((match[2] ?? '').padEnd(12, '0'));
}

function formatQuantity(value) {
  const whole = value / SCALE;
  const fraction = String(value % SCALE).padStart(12, '0');
  return `${whole}.${fraction}`;
}

function grantedPermissions(requestContext) {
  return new Set([
    ...(Array.isArray(requestContext?.permissions) ? requestContext.permissions : []),
    ...(Array.isArray(requestContext?.grantedPermissions) ? requestContext.grantedPermissions : []),
  ]);
}

function hasPermission(requestContext, permission) {
  return grantedPermissions(requestContext).has(permission);
}

function warehouseAllowed(requestContext, warehouseId) {
  return Array.isArray(requestContext?.scopes?.warehouseIds)
    && requestContext.scopes.warehouseIds.includes(warehouseId);
}

function validateUuid(value, field) {
  return typeof value === 'string' && UUID_PATTERN.test(value)
    ? null
    : failure('INVALID_IDENTITY', `${field} is invalid`, false, { field });
}

function validateReason(payload) {
  const reason = String(payload?.reason ?? '').trim();
  if (!reason || reason.length > 1000) {
    return failure('REVERSAL_REASON_REQUIRED', 'Reversal reason is required');
  }
  return Object.freeze({ ok: true, reason });
}

function mapAllocation(row) {
  return Object.freeze({
    id: row.id,
    fulfillmentDemandId: row.fulfillment_demand_id,
    salesOrderId: row.sales_order_id,
    salesOrderLineId: row.sales_order_line_id,
    warehouseId: row.warehouse_id,
    locationId: row.location_id,
    locationCode: row.location_code ?? null,
    baseVariantId: row.base_variant_id,
    lotId: row.lot_id,
    lotCode: row.lot_code ?? null,
    allocatedBaseQuantity: String(row.allocated_base_quantity),
    pickedBaseQuantity: String(row.picked_base_quantity),
    packedBaseQuantity: String(row.packed_base_quantity),
    claimedBaseQuantity: String(row.claimed_base_quantity ?? '0'),
    state: row.state,
  });
}

function blockedDetails(kind, allocation) {
  const picked = parseQuantity(allocation.picked_base_quantity) ?? 0n;
  const packed = parseQuantity(allocation.packed_base_quantity) ?? 0n;
  const claimed = parseQuantity(allocation.claimed_base_quantity) ?? 0n;
  if (kind === 'PICK' && packed > 0n) {
    return failure(
      'PICK_REVERSAL_BLOCKED_BY_PACK',
      'Packed quantity must be reversed before pick quantity',
      false,
      { allocationId: allocation.id, packedBaseQuantity: formatQuantity(packed) },
    );
  }
  if (kind === 'PACK' && claimed > 0n) {
    return failure(
      'PACK_REVERSAL_BLOCKED_BY_DELIVERY_ORDER',
      'Delivery Order claim must be released before packed quantity can be fully reversed',
      false,
      { allocationId: allocation.id, claimedBaseQuantity: formatQuantity(claimed) },
    );
  }
  if ((kind === 'PICK' && picked <= 0n) || (kind === 'PACK' && packed <= 0n)) {
    return failure('NOTHING_TO_REVERSE', 'No effective fulfillment quantity remains to reverse');
  }
  return null;
}

async function reverseAllocation({
  adapter,
  requestContext,
  allocationId,
  idempotencyKey,
  payload,
  kind,
}) {
  const permission = kind === 'PICK' ? 'core.fulfillment.pick' : 'core.fulfillment.pack';
  if (!hasPermission(requestContext, permission)) {
    return failure('PERMISSION_DENIED', `Permission ${permission} is required`);
  }
  const identityError = validateUuid(allocationId, 'allocationId');
  if (identityError) return identityError;
  const reasonResult = validateReason(payload);
  if (!reasonResult.ok) return reasonResult;
  const quantity = parseQuantity(payload?.quantity);
  if (quantity === null || quantity <= 0n) {
    return failure('INVALID_REVERSAL_QUANTITY', 'Reversal quantity must be a positive decimal string');
  }
  const eventType = kind === 'PICK' ? 'PICK_REVERSED' : 'PACK_REVERSED';
  const operationPayload = Object.freeze({
    allocationId,
    eventType,
    quantity: formatQuantity(quantity),
    reason: reasonResult.reason,
  });
  const hash = payloadHash(operationPayload);

  const transaction = await withAuditOutboxTransaction({
    adapter,
    mutate: async (client) => {
      await repository.setFulfillmentReversalWriteContexts(client);
      await repository.lockOperationKey(client, {
        installationId: requestContext.installationId,
        operation: eventType.toLowerCase(),
        idempotencyKey,
      });
      const replay = await repository.getAllocationEventByIdempotencyKey(client, {
        installationId: requestContext.installationId,
        idempotencyKey,
      });
      if (replay) {
        if (replay.payload_hash !== hash || replay.allocation_id !== allocationId || replay.event_type !== eventType) {
          return { failed: failure('IDEMPOTENCY_PAYLOAD_MISMATCH', 'Idempotency key was used with another reversal payload') };
        }
        const replayAllocation = await repository.getAllocationForUpdate(client, {
          installationId: requestContext.installationId,
          allocationId,
        });
        if (!replayAllocation) return { failed: failure('FULFILLMENT_ALLOCATION_NOT_FOUND', 'Active fulfillment allocation was not found') };
        if (!warehouseAllowed(requestContext, replayAllocation.warehouse_id)) {
          return { failed: failure('WAREHOUSE_SCOPE_DENIED', 'Allocation is outside the authorized warehouse scope') };
        }
        return Object.freeze({ ok: true, replayed: true, allocation: mapAllocation(replayAllocation) });
      }

      const allocation = await repository.getAllocationForUpdate(client, {
        installationId: requestContext.installationId,
        allocationId,
      });
      if (!allocation) return { failed: failure('FULFILLMENT_ALLOCATION_NOT_FOUND', 'Active fulfillment allocation was not found') };
      if (!warehouseAllowed(requestContext, allocation.warehouse_id)) {
        return { failed: failure('WAREHOUSE_SCOPE_DENIED', 'Allocation is outside the authorized warehouse scope') };
      }

      const current = kind === 'PICK'
        ? parseQuantity(allocation.picked_base_quantity)
        : parseQuantity(allocation.packed_base_quantity);
      const packed = parseQuantity(allocation.packed_base_quantity) ?? 0n;
      const claimed = parseQuantity(allocation.claimed_base_quantity) ?? 0n;
      if (current === null || quantity > current) {
        return { failed: failure('REVERSAL_EXCEEDS_EFFECTIVE_QUANTITY', 'Reversal exceeds the current effective quantity') };
      }
      if (kind === 'PICK' && current - quantity < packed) {
        return { failed: failure('PICK_REVERSAL_BLOCKED_BY_PACK', 'Packed quantity must be reversed before pick quantity') };
      }
      if (kind === 'PACK' && current - quantity < claimed) {
        return { failed: failure('PACK_REVERSAL_BLOCKED_BY_DELIVERY_ORDER', 'Delivery Order claim must be released before packed quantity') };
      }

      const updated = await repository.decrementAllocationProgress(client, {
        installationId: requestContext.installationId,
        allocationId,
        kind,
        quantity: formatQuantity(quantity),
        actorId: requestContext.actorId,
      });
      if (!updated) return { failed: failure('FULFILLMENT_REVERSAL_CONFLICT', 'Fulfillment quantity changed concurrently', true) };
      const occurredAt = requestContext.receivedAt ?? new Date().toISOString();
      await repository.insertAllocationEvent(client, {
        installationId: requestContext.installationId,
        allocationId,
        eventType,
        quantity: formatQuantity(quantity),
        actorId: requestContext.actorId,
        requestId: requestContext.requestId,
        sourceApp: requestContext.sourceApp,
        idempotencyKey,
        payloadHash: hash,
        reason: reasonResult.reason,
        metadata: { salesOrderId: allocation.sales_order_id, reversalKind: kind },
        occurredAt,
      });
      const afterRow = await repository.getAllocationForUpdate(client, {
        installationId: requestContext.installationId,
        allocationId,
      });
      const before = mapAllocation(allocation);
      const after = mapAllocation(afterRow ?? { ...allocation, ...updated });
      const audit = buildAuditRecord({
        requestContext,
        action: kind === 'PICK' ? 'sales.fulfillment.pick.reverse' : 'sales.fulfillment.pack.reverse',
        resourceType: 'sales_fulfillment_allocation',
        resourceId: allocationId,
        beforeData: before,
        afterData: after,
        metadata: { salesOrderId: allocation.sales_order_id, reason: reasonResult.reason },
      });
      const outbox = buildOutboxEvent({
        requestContext,
        aggregateType: 'sales.fulfillment_allocation',
        aggregateId: allocationId,
        eventType: kind === 'PICK'
          ? 'core.sales_order.fulfillment.pick_reversed'
          : 'core.sales_order.fulfillment.pack_reversed',
        eventVersion: 1,
        payload: after,
        metadata: { salesOrderId: allocation.sales_order_id, reason: reasonResult.reason },
      });
      await insertAuditRecord(client, audit);
      await insertOutboxEvent(client, outbox);
      return Object.freeze({ ok: true, replayed: false, allocation: after, auditId: audit.auditId, eventId: outbox.eventId });
    },
  });
  return transaction?.failed ?? transaction;
}

export function executeReverseFulfillmentPick(args) {
  return reverseAllocation({ ...args, kind: 'PICK' });
}

export function executeReverseFulfillmentPack(args) {
  return reverseAllocation({ ...args, kind: 'PACK' });
}

export async function getFulfillmentReversalState(client, { requestContext, salesOrderId }) {
  if (!hasPermission(requestContext, 'core.fulfillment.read')) {
    return failure('PERMISSION_DENIED', 'Permission core.fulfillment.read is required');
  }
  const identityError = validateUuid(salesOrderId, 'salesOrderId');
  if (identityError) return identityError;
  const allocations = await repository.listOrderAllocationsForUpdate(client, {
    installationId: requestContext.installationId,
    salesOrderId,
  });
  if (allocations.length === 0) return failure('FULFILLMENT_ORDER_NOT_FOUND', 'Fulfillment order was not found');
  if (allocations.some((allocation) => !warehouseAllowed(requestContext, allocation.warehouse_id))) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Sales Order contains allocations outside the authorized warehouse scope');
  }
  const lines = allocations.map((allocation) => {
    const picked = parseQuantity(allocation.picked_base_quantity) ?? 0n;
    const packed = parseQuantity(allocation.packed_base_quantity) ?? 0n;
    const claimed = parseQuantity(allocation.claimed_base_quantity) ?? 0n;
    return Object.freeze({
      allocation: mapAllocation(allocation),
      reversiblePackBaseQuantity: formatQuantity(packed > claimed ? packed - claimed : 0n),
      reversiblePickBaseQuantity: formatQuantity(picked > packed ? picked - packed : 0n),
      blockedByDeliveryOrder: claimed > 0n,
      blockedByPack: packed > 0n,
    });
  });
  return Object.freeze({ ok: true, salesOrderId, lines: Object.freeze(lines) });
}

export async function executeReverseFulfillmentOrder({
  adapter,
  requestContext,
  salesOrderId,
  idempotencyKey,
  payload,
}) {
  if (!hasPermission(requestContext, 'core.fulfillment.pick') || !hasPermission(requestContext, 'core.fulfillment.pack')) {
    return failure('PERMISSION_DENIED', 'Permissions core.fulfillment.pick and core.fulfillment.pack are required');
  }
  const identityError = validateUuid(salesOrderId, 'salesOrderId');
  if (identityError) return identityError;
  const reasonResult = validateReason(payload);
  if (!reasonResult.ok) return reasonResult;
  const mode = String(payload?.mode ?? 'ALL').trim().toUpperCase();
  if (!['ALL', 'ELIGIBLE'].includes(mode)) {
    return failure('INVALID_REVERSAL_MODE', 'Reversal mode must be ALL or ELIGIBLE');
  }
  const operationPayload = Object.freeze({ salesOrderId, mode, reason: reasonResult.reason });
  const hash = payloadHash(operationPayload);

  const transaction = await withAuditOutboxTransaction({
    adapter,
    mutate: async (client) => {
      await repository.setFulfillmentReversalWriteContexts(client);
      await repository.lockOperationKey(client, {
        installationId: requestContext.installationId,
        operation: 'order-reverse',
        idempotencyKey,
      });
      const replay = await repository.getReversalBatchByIdempotencyKey(client, {
        installationId: requestContext.installationId,
        idempotencyKey,
      });
      if (replay) {
        if (replay.payload_hash !== hash || replay.sales_order_id !== salesOrderId || replay.mode !== mode) {
          return { failed: failure('IDEMPOTENCY_PAYLOAD_MISMATCH', 'Idempotency key was used with another order reversal payload') };
        }
        return Object.freeze({ ok: true, replayed: true, reversal: replay.snapshot });
      }

      const allocations = await repository.listOrderAllocationsForUpdate(client, {
        installationId: requestContext.installationId,
        salesOrderId,
      });
      if (allocations.length === 0) return { failed: failure('FULFILLMENT_ORDER_NOT_FOUND', 'Fulfillment order was not found') };
      if (allocations.some((allocation) => !warehouseAllowed(requestContext, allocation.warehouse_id))) {
        return { failed: failure('WAREHOUSE_SCOPE_DENIED', 'Sales Order contains allocations outside the authorized warehouse scope') };
      }
      if (mode === 'ALL' && allocations.some((allocation) => (parseQuantity(allocation.claimed_base_quantity) ?? 0n) > 0n)) {
        return { failed: failure(
          'FULFILLMENT_ORDER_REVERSAL_BLOCKED_BY_DELIVERY_ORDER',
          'Release downstream Delivery Order claims before reversing the whole fulfillment order',
        ) };
      }

      const batchId = randomUUID();
      const occurredAt = requestContext.receivedAt ?? new Date().toISOString();
      const reversed = [];
      const blocked = [];
      for (const allocation of allocations) {
        const picked = parseQuantity(allocation.picked_base_quantity) ?? 0n;
        const packed = parseQuantity(allocation.packed_base_quantity) ?? 0n;
        const claimed = parseQuantity(allocation.claimed_base_quantity) ?? 0n;
        const packQuantity = packed > claimed ? packed - claimed : 0n;
        const remainingPacked = packed - packQuantity;
        const pickQuantity = picked > remainingPacked ? picked - remainingPacked : 0n;
        if (claimed > 0n) {
          blocked.push(Object.freeze({ allocationId: allocation.id, claimedBaseQuantity: formatQuantity(claimed) }));
        }
        if (packQuantity > 0n) {
          const updatedPack = await repository.decrementAllocationProgress(client, {
            installationId: requestContext.installationId,
            allocationId: allocation.id,
            kind: 'PACK',
            quantity: formatQuantity(packQuantity),
            actorId: requestContext.actorId,
          });
          if (!updatedPack) return { failed: failure('FULFILLMENT_REVERSAL_CONFLICT', 'Packed quantity changed concurrently', true) };
          await repository.insertAllocationEvent(client, {
            installationId: requestContext.installationId,
            allocationId: allocation.id,
            eventType: 'PACK_REVERSED',
            quantity: formatQuantity(packQuantity),
            actorId: requestContext.actorId,
            requestId: requestContext.requestId,
            sourceApp: requestContext.sourceApp,
            idempotencyKey: randomUUID(),
            payloadHash: hash,
            reason: reasonResult.reason,
            metadata: { batchId, salesOrderId, mode },
            occurredAt,
          });
        }
        if (pickQuantity > 0n) {
          const updatedPick = await repository.decrementAllocationProgress(client, {
            installationId: requestContext.installationId,
            allocationId: allocation.id,
            kind: 'PICK',
            quantity: formatQuantity(pickQuantity),
            actorId: requestContext.actorId,
          });
          if (!updatedPick) return { failed: failure('FULFILLMENT_REVERSAL_CONFLICT', 'Picked quantity changed concurrently', true) };
          await repository.insertAllocationEvent(client, {
            installationId: requestContext.installationId,
            allocationId: allocation.id,
            eventType: 'PICK_REVERSED',
            quantity: formatQuantity(pickQuantity),
            actorId: requestContext.actorId,
            requestId: requestContext.requestId,
            sourceApp: requestContext.sourceApp,
            idempotencyKey: randomUUID(),
            payloadHash: hash,
            reason: reasonResult.reason,
            metadata: { batchId, salesOrderId, mode },
            occurredAt,
          });
        }
        if (packQuantity > 0n || pickQuantity > 0n) {
          const after = await repository.getAllocationForUpdate(client, {
            installationId: requestContext.installationId,
            allocationId: allocation.id,
          });
          reversed.push(Object.freeze({
            allocationId: allocation.id,
            packReversedBaseQuantity: formatQuantity(packQuantity),
            pickReversedBaseQuantity: formatQuantity(pickQuantity),
            allocation: mapAllocation(after ?? allocation),
          }));
        }
      }
      if (reversed.length === 0 && blocked.length === 0) {
        return { failed: failure('NOTHING_TO_REVERSE', 'No effective fulfillment quantity remains to reverse') };
      }
      const snapshot = Object.freeze({
        id: batchId,
        salesOrderId,
        mode,
        reason: reasonResult.reason,
        reversed: Object.freeze(reversed),
        blocked: Object.freeze(blocked),
        occurredAt,
      });
      await repository.insertReversalBatch(client, {
        id: batchId,
        installationId: requestContext.installationId,
        salesOrderId,
        mode,
        reason: reasonResult.reason,
        idempotencyKey,
        payloadHash: hash,
        actorId: requestContext.actorId,
        requestId: requestContext.requestId,
        sourceApp: requestContext.sourceApp,
        snapshot,
        occurredAt,
      });
      const audit = buildAuditRecord({
        requestContext,
        action: 'sales.fulfillment.order.reverse',
        resourceType: 'sales_order',
        resourceId: salesOrderId,
        afterData: snapshot,
        metadata: { mode, reason: reasonResult.reason },
      });
      const outbox = buildOutboxEvent({
        requestContext,
        aggregateType: 'sales.order',
        aggregateId: salesOrderId,
        eventType: 'core.sales_order.fulfillment.reversed',
        eventVersion: 1,
        payload: snapshot,
        metadata: { mode, reason: reasonResult.reason },
      });
      await insertAuditRecord(client, audit);
      await insertOutboxEvent(client, outbox);
      return Object.freeze({ ok: true, replayed: false, reversal: snapshot, auditId: audit.auditId, eventId: outbox.eventId });
    },
  });
  return transaction?.failed ?? transaction;
}

export const fulfillmentReversalInternals = Object.freeze({
  parseQuantity,
  formatQuantity,
  payloadHash,
  mapAllocation,
  blockedDetails,
});

import { createHash } from 'node:crypto';
import { createIdempotencyKey } from '@npp/contracts';
import * as allocationRepository from '../db/repositories/sales-fulfillment-reversal.js';
import * as inventoryReservationRepository from '../db/repositories/inventory-reservations.js';
import * as repository from '../db/repositories/sales-fulfillment-allocation-release.js';
import * as deliveryOrderRepository from '../db/repositories/sales-delivery-orders.js';
import * as deliveryReversalRepository from '../db/repositories/sales-delivery-order-reversal.js';
import { reverseInventoryMovement } from './inventory-ledger-core.js';

const ZERO_DECIMAL_PATTERN = /^[+-]?0+(?:\.0+)?$/;

const RELEASE_INTENTS = Object.freeze({
  'manual-edit': Object.freeze({
    operation: 'manual-sales-order-edit',
    reason: 'Hoàn tác xử lý để sửa đơn Giao thủ công',
    blockedCode: 'MANUAL_DELIVERY_EDIT_NOT_AVAILABLE',
    blockedMessage: 'Đơn đang trên chuyến giao hoặc đã có giao nhận thực tế. Cần thu hồi hoặc hoàn hàng trước khi sửa đơn.',
  }),
  amendment: Object.freeze({
    operation: 'sales-order-amendment',
    reason: 'Hoàn tác xử lý để điều chỉnh đơn',
    blockedCode: 'SALES_ORDER_AMENDMENT_BLOCKED',
    blockedMessage: 'Đơn đang trên chuyến giao hoặc đã có giao nhận thực tế. Cần thu hồi hoặc hoàn hàng trước khi điều chỉnh.',
  }),
  cancel: Object.freeze({
    operation: 'sales-order-cancel',
    reason: 'Hoàn tác xử lý để hủy đơn trước khi giao khách',
    blockedCode: 'SALES_ORDER_CANCEL_BLOCKED',
    blockedMessage: 'Đơn đang trên chuyến giao hoặc đã có giao nhận thực tế. Cần thu hồi hoặc hoàn hàng trước khi hủy.',
  }),
});

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

function deterministicUuid(value) {
  const bytes = Buffer.from(createHash('sha256').update(value).digest().subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function releaseIntent(intentName) {
  return RELEASE_INTENTS[intentName] ?? RELEASE_INTENTS['manual-edit'];
}

function childIdempotencyKey(parentKey, allocationId, intentName = 'manual-edit') {
  const legacyManualEdit = intentName === 'manual-edit';
  const seed = legacyManualEdit
    ? `${parentKey}|${allocationId}`
    : `${parentKey}|${allocationId}|${intentName}`;
  return createIdempotencyKey(
    legacyManualEdit ? 'sales-manual-edit-release' : 'sales-pre-execution-release',
    deterministicUuid(seed),
  );
}

function unwindIdempotencyKey(parentKey, operation, targetId) {
  return createIdempotencyKey(
    'sales-order-unwind',
    deterministicUuid(`${parentKey}|${operation}|${targetId}`),
  );
}

function isZero(value) {
  return ZERO_DECIMAL_PATTERN.test(String(value ?? '0').trim() || '0');
}

function releaseBlocked(allocation) {
  return !isZero(allocation.picked_base_quantity)
    || !isZero(allocation.packed_base_quantity)
    || !isZero(allocation.claimed_base_quantity);
}

async function listOpenDeliveryOrdersForUpdate(client, { installationId, salesOrderId }) {
  const result = await client.query(
    `SELECT delivery_order.id,
            delivery_order.status,
            delivery_order.warehouse_id,
            delivery_order.revision
       FROM sales.delivery_orders delivery_order
      WHERE delivery_order.installation_id = $1
        AND delivery_order.sales_order_id = $2
        AND delivery_order.status <> 'cancelled'
      ORDER BY delivery_order.created_at ASC, delivery_order.id ASC
      FOR UPDATE OF delivery_order`,
    [installationId, salesOrderId],
  );
  return result.rows ?? [];
}

async function unwindDeliveryOrders(client, {
  requestContext,
  salesOrderId,
  idempotencyKey,
  intent,
}) {
  const deliveryOrders = await listOpenDeliveryOrdersForUpdate(client, {
    installationId: requestContext.installationId,
    salesOrderId,
  });
  const unwound = [];

  for (const deliveryOrder of deliveryOrders) {
    const childKey = unwindIdempotencyKey(idempotencyKey, 'delivery-order', deliveryOrder.id);
    const hash = payloadHash({
      deliveryOrderId: deliveryOrder.id,
      operation: intent.operation,
      reason: intent.reason,
    });
    const occurredAt = requestContext.receivedAt ?? new Date().toISOString();

    if (deliveryOrder.status === 'draft') {
      await deliveryOrderRepository.setDeliveryOrderWriteContext(client);
      const cancelled = await deliveryOrderRepository.cancelDeliveryOrder(client, {
        installationId: requestContext.installationId,
        deliveryOrderId: deliveryOrder.id,
        reason: intent.reason,
        actorId: requestContext.actorId,
      });
      if (!cancelled) {
        return failure(
          'DELIVERY_ORDER_CANCEL_CONFLICT',
          'Phiếu giao đã thay đổi trong lúc hoàn tác. Hãy tải lại đơn rồi thử lại.',
          true,
          { deliveryOrderId: deliveryOrder.id },
        );
      }
      await deliveryOrderRepository.insertDeliveryOrderEvent(client, {
        installationId: requestContext.installationId,
        deliveryOrderId: deliveryOrder.id,
        eventType: 'CANCELLED',
        idempotencyKey: childKey,
        payloadHash: hash,
        actorId: requestContext.actorId,
        requestId: requestContext.requestId,
        sourceApp: requestContext.sourceApp,
        reason: intent.reason,
        metadata: { salesOrderId, operation: intent.operation },
        occurredAt,
      });
      unwound.push(Object.freeze({ id: deliveryOrder.id, from: 'draft', to: 'cancelled' }));
      continue;
    }

    if (deliveryOrder.status === 'ready_to_dispatch') {
      await deliveryReversalRepository.setDeliveryReversalWriteContext(client);
      const blockers = await deliveryReversalRepository.getReleaseBlockers(client, {
        installationId: requestContext.installationId,
        deliveryOrderId: deliveryOrder.id,
      });
      if (blockers.has_active_inventory_issue || blockers.has_active_trip_assignment) {
        return failure(intent.blockedCode, intent.blockedMessage, false, {
          deliveryOrderId: deliveryOrder.id,
          activeInventoryIssue: Boolean(blockers.has_active_inventory_issue),
          activeTripAssignment: Boolean(blockers.has_active_trip_assignment),
        });
      }
      const released = await deliveryReversalRepository.releaseDeliveryOrderForReversal(client, {
        installationId: requestContext.installationId,
        deliveryOrderId: deliveryOrder.id,
        reason: intent.reason,
        actorId: requestContext.actorId,
        occurredAt,
      });
      if (!released) {
        return failure(
          'DELIVERY_ORDER_REVERSAL_CONFLICT',
          'Phiếu giao đã thay đổi trong lúc hoàn tác. Hãy tải lại đơn rồi thử lại.',
          true,
          { deliveryOrderId: deliveryOrder.id },
        );
      }
      await deliveryReversalRepository.insertDeliveryOrderEvent(client, {
        installationId: requestContext.installationId,
        deliveryOrderId: deliveryOrder.id,
        idempotencyKey: childKey,
        payloadHash: hash,
        actorId: requestContext.actorId,
        requestId: requestContext.requestId,
        sourceApp: requestContext.sourceApp,
        reason: intent.reason,
        metadata: { salesOrderId, operation: intent.operation },
        occurredAt,
      });
      unwound.push(Object.freeze({ id: deliveryOrder.id, from: 'ready_to_dispatch', to: 'cancelled' }));
      continue;
    }

    return failure(intent.blockedCode, intent.blockedMessage, false, {
      deliveryOrderId: deliveryOrder.id,
      deliveryOrderStatus: deliveryOrder.status,
    });
  }

  if (unwound.length > 0) {
    await deliveryOrderRepository.refreshSalesOrderDeliveryStatus(client, {
      installationId: requestContext.installationId,
      salesOrderId,
      actorId: requestContext.actorId,
    });
  }
  return Object.freeze({ ok: true, deliveryOrders: Object.freeze(unwound) });
}

async function listActiveManualIssueMovementsForUpdate(client, {
  installationId,
  salesOrderId,
}) {
  const result = await client.query(
    `SELECT movement.id, movement.document_date
       FROM inventory.inventory_movements movement
      WHERE movement.installation_id = $1
        AND movement.movement_type = 'SALES_DELIVERY_ISSUE'
        AND movement.source_domain = 'SALES'
        AND movement.source_document_type = 'SALES_ORDER'
        AND movement.source_document_id = $2
        AND movement.reason_code = 'MANUAL_SALES_ORDER_STOCK_ISSUE'
        AND NOT EXISTS (
          SELECT 1
            FROM inventory.inventory_movements reversal
           WHERE reversal.installation_id = movement.installation_id
             AND reversal.reversal_of_movement_id = movement.id
        )
      ORDER BY movement.posted_at ASC, movement.id ASC
      FOR UPDATE OF movement`,
    [installationId, salesOrderId],
  );
  return result.rows ?? [];
}

async function unwindManualStockIssues(client, {
  requestContext,
  salesOrderId,
  idempotencyKey,
  intent,
}) {
  const movements = await listActiveManualIssueMovementsForUpdate(client, {
    installationId: requestContext.installationId,
    salesOrderId,
  });
  const reversed = [];
  const documentDate = String(requestContext.receivedAt ?? new Date().toISOString()).slice(0, 10);

  for (const movement of movements) {
    const reversal = await reverseInventoryMovement(client, {
      requestContext,
      idempotencyKey: unwindIdempotencyKey(idempotencyKey, 'manual-stock-issue', movement.id),
      movementId: movement.id,
      payload: {
        documentDate,
        reasonCode: 'SALES_ORDER_UNWIND',
        reasonNote: intent.reason,
      },
    });
    if (!reversal.ok) {
      return failure(
        reversal.code,
        reversal.message,
        Boolean(reversal.retryable),
        { ...(reversal.details ?? {}), movementId: movement.id },
      );
    }
    reversed.push(Object.freeze({ movementId: movement.id, reversalMovementId: reversal.movement.id }));
  }
  return Object.freeze({ ok: true, movements: Object.freeze(reversed) });
}

async function reverseAllocationProgress(client, {
  requestContext,
  salesOrderId,
  idempotencyKey,
  intent,
}) {
  await allocationRepository.setFulfillmentReversalWriteContexts(client);
  const allocations = await allocationRepository.listOrderAllocationsForUpdate(client, {
    installationId: requestContext.installationId,
    salesOrderId,
  });
  const reversed = [];

  for (const original of allocations) {
    if (original.state === 'RELEASED') continue;
    if (!isZero(original.claimed_base_quantity)) {
      return failure(intent.blockedCode, intent.blockedMessage, false, {
        allocationId: original.id,
        claimedBaseQuantity: String(original.claimed_base_quantity),
      });
    }

    let current = original;
    if (!isZero(current.packed_base_quantity)) {
      const quantity = String(current.packed_base_quantity);
      const updated = await allocationRepository.decrementAllocationProgress(client, {
        installationId: requestContext.installationId,
        allocationId: current.id,
        kind: 'PACK',
        quantity,
        actorId: requestContext.actorId,
      });
      if (!updated) {
        return failure(
          'FULFILLMENT_PACK_REVERSAL_CONFLICT',
          'Số lượng đóng gói đã thay đổi trong lúc hoàn tác. Hãy tải lại đơn rồi thử lại.',
          true,
          { allocationId: current.id },
        );
      }
      const eventKey = unwindIdempotencyKey(idempotencyKey, 'pack', current.id);
      await allocationRepository.insertAllocationEvent(client, {
        installationId: requestContext.installationId,
        allocationId: current.id,
        eventType: 'PACK_REVERSED',
        quantity,
        actorId: requestContext.actorId,
        requestId: requestContext.requestId,
        sourceApp: requestContext.sourceApp,
        idempotencyKey: eventKey,
        payloadHash: payloadHash({ allocationId: current.id, eventType: 'PACK_REVERSED', quantity, reason: intent.reason }),
        reason: intent.reason,
        metadata: { salesOrderId, operation: intent.operation },
        occurredAt: requestContext.receivedAt ?? new Date().toISOString(),
      });
      reversed.push(Object.freeze({ allocationId: current.id, kind: 'PACK', quantity }));
      current = updated;
    }

    if (!isZero(current.picked_base_quantity)) {
      const quantity = String(current.picked_base_quantity);
      const updated = await allocationRepository.decrementAllocationProgress(client, {
        installationId: requestContext.installationId,
        allocationId: current.id,
        kind: 'PICK',
        quantity,
        actorId: requestContext.actorId,
      });
      if (!updated) {
        return failure(
          'FULFILLMENT_PICK_REVERSAL_CONFLICT',
          'Số lượng đã soạn đã thay đổi trong lúc hoàn tác. Hãy tải lại đơn rồi thử lại.',
          true,
          { allocationId: current.id },
        );
      }
      const eventKey = unwindIdempotencyKey(idempotencyKey, 'pick', current.id);
      await allocationRepository.insertAllocationEvent(client, {
        installationId: requestContext.installationId,
        allocationId: current.id,
        eventType: 'PICK_REVERSED',
        quantity,
        actorId: requestContext.actorId,
        requestId: requestContext.requestId,
        sourceApp: requestContext.sourceApp,
        idempotencyKey: eventKey,
        payloadHash: payloadHash({ allocationId: current.id, eventType: 'PICK_REVERSED', quantity, reason: intent.reason }),
        reason: intent.reason,
        metadata: { salesOrderId, operation: intent.operation },
        occurredAt: requestContext.receivedAt ?? new Date().toISOString(),
      });
      reversed.push(Object.freeze({ allocationId: current.id, kind: 'PICK', quantity }));
    }
  }

  return Object.freeze({ ok: true, reversed: Object.freeze(reversed) });
}

async function releaseInventoryReservation(client, {
  requestContext,
  reservation,
  allocation,
  occurredAt,
  intent,
}) {
  const updated = await inventoryReservationRepository.updateReservationState(client, {
    installationId: requestContext.installationId,
    id: reservation.id,
    state: 'RELEASED',
    transitionedAt: occurredAt,
  });
  if (!updated) {
    return failure(
      'FULFILLMENT_ALLOCATION_RELEASE_CONFLICT',
      'Phân bổ hàng đã thay đổi trong lúc cập nhật đơn. Hãy tải lại rồi thử lại.',
      true,
    );
  }

  const hash = payloadHash({
    reservationId: reservation.id,
    transition: 'RELEASE_TO_RELEASED',
    reason: intent.reason,
    allocationId: allocation.id,
  });
  await inventoryReservationRepository.insertReservationEvent(client, {
    id: deterministicUuid(`${allocation.id}|reservation-release-event`),
    installationId: requestContext.installationId,
    reservationId: reservation.id,
    transition: 'RELEASE_TO_RELEASED',
    actorId: requestContext.actorId,
    requestId: requestContext.requestId,
    sourceApp: requestContext.sourceApp,
    payloadHash: hash,
    occurredAt,
    metadata: {
      action: intent.operation,
      reason: intent.reason,
      salesOrderId: allocation.sales_order_id,
      allocationId: allocation.id,
    },
  });
  return Object.freeze({ ok: true, reservation: updated });
}

async function releaseRemainingAllocations(client, {
  requestContext,
  salesOrderId,
  idempotencyKey,
  intentName,
  intent,
}) {
  await repository.setManualEditReleaseWriteContexts(client);
  const allocations = await allocationRepository.listOrderAllocationsForUpdate(client, {
    installationId: requestContext.installationId,
    salesOrderId,
  });
  if (allocations.some((allocation) => allocation.state === 'ACTIVE' && releaseBlocked(allocation))) {
    return failure(intent.blockedCode, intent.blockedMessage);
  }
  const active = allocations.filter((allocation) => allocation.state === 'ACTIVE');
  if (active.length === 0) return Object.freeze({ ok: true, released: Object.freeze([]) });

  const released = [];
  for (const allocation of active) {
    const reservation = await inventoryReservationRepository.getReservationById(client, {
      installationId: requestContext.installationId,
      id: allocation.inventory_reservation_id,
      forUpdate: true,
    });
    if (!reservation || reservation.state !== 'ACTIVE') {
      return failure(
        'FULFILLMENT_ALLOCATION_RESERVATION_CONFLICT',
        'Phần hàng đã phân bổ không còn ở trạng thái có thể giải phóng. Hãy tải lại đơn.',
        true,
        { allocationId: allocation.id },
      );
    }
    await inventoryReservationRepository.lockReservationScope(client, {
      installationId: requestContext.installationId,
      warehouseId: reservation.warehouse_id,
      locationId: reservation.location_id,
      baseVariantId: reservation.base_variant_id,
      lotId: reservation.lot_id,
    });

    const occurredAt = requestContext.receivedAt ?? new Date().toISOString();
    const reservationResult = await releaseInventoryReservation(client, {
      requestContext,
      reservation,
      allocation,
      occurredAt,
      intent,
    });
    if (!reservationResult.ok) return reservationResult;

    const allocationAfter = await repository.releaseAllocation(client, {
      installationId: requestContext.installationId,
      allocationId: allocation.id,
      actorId: requestContext.actorId,
    });
    if (!allocationAfter) {
      return failure(
        'FULFILLMENT_ALLOCATION_RELEASE_CONFLICT',
        'Phân bổ hàng đã thay đổi trong lúc cập nhật đơn. Hãy tải lại rồi thử lại.',
        true,
        { allocationId: allocation.id },
      );
    }

    const operationKey = childIdempotencyKey(idempotencyKey, allocation.id, intentName);
    const hash = payloadHash({
      allocationId: allocation.id,
      eventType: 'RELEASED',
      quantity: String(allocation.allocated_base_quantity),
      reason: intent.reason,
    });
    await allocationRepository.insertAllocationEvent(client, {
      installationId: requestContext.installationId,
      allocationId: allocation.id,
      eventType: 'RELEASED',
      quantity: String(allocation.allocated_base_quantity),
      actorId: requestContext.actorId,
      requestId: requestContext.requestId,
      sourceApp: requestContext.sourceApp,
      idempotencyKey: operationKey,
      payloadHash: hash,
      reason: intent.reason,
      metadata: { salesOrderId, operation: intent.operation },
      occurredAt,
    });
    released.push(Object.freeze({ allocation: allocationAfter, reservation: reservationResult.reservation }));
  }
  return Object.freeze({ ok: true, released: Object.freeze(released) });
}

export async function releasePreExecutionAllocations(client, {
  requestContext,
  salesOrderId,
  idempotencyKey,
  intentName = 'manual-edit',
}) {
  const intent = releaseIntent(intentName);

  const delivery = await unwindDeliveryOrders(client, {
    requestContext,
    salesOrderId,
    idempotencyKey,
    intent,
  });
  if (!delivery.ok) return delivery;

  const manualIssue = await unwindManualStockIssues(client, {
    requestContext,
    salesOrderId,
    idempotencyKey,
    intent,
  });
  if (!manualIssue.ok) return manualIssue;

  const progress = await reverseAllocationProgress(client, {
    requestContext,
    salesOrderId,
    idempotencyKey,
    intent,
  });
  if (!progress.ok) return progress;

  const released = await releaseRemainingAllocations(client, {
    requestContext,
    salesOrderId,
    idempotencyKey,
    intentName,
    intent,
  });
  if (!released.ok) return released;

  return Object.freeze({
    ok: true,
    deliveryOrders: delivery.deliveryOrders,
    reversedManualIssues: manualIssue.movements,
    reversedProgress: progress.reversed,
    released: released.released,
  });
}

export function releaseManualEditAllocations(client, input) {
  return releasePreExecutionAllocations(client, { ...input, intentName: 'manual-edit' });
}

export const manualEditAllocationReleaseInternals = Object.freeze({
  deterministicUuid,
  childIdempotencyKey,
  unwindIdempotencyKey,
  releaseBlocked,
  payloadHash,
  releaseIntent,
});
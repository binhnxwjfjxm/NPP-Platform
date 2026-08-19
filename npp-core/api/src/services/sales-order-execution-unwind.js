import { createHash } from 'node:crypto';
import { createIdempotencyKey } from '@npp/contracts';
import * as allocationRepository from '../db/repositories/sales-fulfillment-reversal.js';
import * as deliveryOrderRepository from '../db/repositories/sales-delivery-orders.js';
import * as deliveryReversalRepository from '../db/repositories/sales-delivery-order-reversal.js';
import * as deliveryInventoryRepository from '../db/repositories/sales-delivery-inventory.js';
import * as tripPlanningRepository from '../db/repositories/logistics-trip-planning.js';
import * as tripRecoveryRepository from '../db/repositories/logistics-trip-recovery.js';
import { reverseInventoryMovement } from './inventory-ledger-core.js';

const ZERO_DECIMAL_PATTERN = /^[+-]?0+(?:\.0+)?$/;

function failure(code, message, retryable = false, details = {}) {
  return Object.freeze({ ok: false, code, message, retryable, details });
}

function canonicalize(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

export function payloadHash(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function deterministicUuid(value) {
  const bytes = Buffer.from(createHash('sha256').update(value).digest().subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function unwindIdempotencyKey(parentKey, operation, targetId) {
  return createIdempotencyKey(
    'sales-order-unwind',
    deterministicUuid(`${parentKey}|${operation}|${targetId}`),
  );
}

function isZero(value) {
  return ZERO_DECIMAL_PATTERN.test(String(value ?? '0').trim() || '0');
}

function warehouseAllowed(requestContext, warehouseId) {
  return Array.isArray(requestContext?.scopes?.warehouseIds)
    && requestContext.scopes.warehouseIds.includes(warehouseId);
}

function now(requestContext) {
  return requestContext.receivedAt ?? new Date().toISOString();
}

async function setTripPlanningWriteContext(client) {
  await client.query("SELECT set_config('npp.logistics_write_context', 'trip_planning_service', true)");
}

async function setSalesOrderUnwindTripWriteContext(client) {
  await client.query("SELECT set_config('npp.logistics_write_context', 'sales_order_unwind_service', true)");
}

async function listOpenDeliveryOrdersForUpdate(client, { installationId, salesOrderId }) {
  const result = await client.query(
    `SELECT delivery_order.id
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

async function getActiveAssignmentForDeliveryOrder(client, { installationId, deliveryOrderId }) {
  const result = await client.query(
    `SELECT assignment.id,
            assignment.trip_id,
            assignment.trip_stop_id,
            assignment.delivery_order_id,
            trip.status AS trip_status,
            trip.warehouse_id
       FROM logistics.trip_order_assignments assignment
       JOIN logistics.delivery_trips trip
         ON trip.installation_id = assignment.installation_id
        AND trip.id = assignment.trip_id
      WHERE assignment.installation_id = $1
        AND assignment.delivery_order_id = $2
        AND assignment.unassigned_at IS NULL
      FOR UPDATE OF assignment, trip`,
    [installationId, deliveryOrderId],
  );
  return result.rows?.[0] ?? null;
}

async function listActiveTripAssignments(client, { installationId, tripId }) {
  const result = await client.query(
    `SELECT assignment.id,
            assignment.trip_id,
            assignment.trip_stop_id,
            assignment.delivery_order_id,
            dispatch_item.inventory_issue_id,
            issue.status AS inventory_issue_status
       FROM logistics.trip_order_assignments assignment
       LEFT JOIN logistics.trip_dispatch_items dispatch_item
         ON dispatch_item.installation_id = assignment.installation_id
        AND dispatch_item.assignment_id = assignment.id
       LEFT JOIN sales.delivery_order_inventory_issues issue
         ON issue.installation_id = dispatch_item.installation_id
        AND issue.id = dispatch_item.inventory_issue_id
      WHERE assignment.installation_id = $1
        AND assignment.trip_id = $2
        AND assignment.unassigned_at IS NULL
      ORDER BY assignment.assigned_at ASC, assignment.id ASC
      FOR UPDATE OF assignment`,
    [installationId, tripId],
  );
  return result.rows ?? [];
}

async function insertPlanningTripEvent(client, {
  requestContext,
  tripId,
  eventType,
  idempotencyKey,
  reason,
  metadata,
}) {
  await tripPlanningRepository.insertTripEvent(client, {
    id: deterministicUuid(`${idempotencyKey}|event|${eventType}`),
    installationId: requestContext.installationId,
    tripId,
    eventType,
    idempotencyKey,
    payloadHash: payloadHash({ tripId, eventType, reason, metadata }),
    actorId: requestContext.actorId,
    requestId: requestContext.requestId,
    sourceApp: requestContext.sourceApp,
    reason,
    metadata,
  });
}

async function reopenAndUnassignPreDispatch(client, {
  requestContext,
  assignment,
  idempotencyKey,
  intent,
}) {
  if (!warehouseAllowed(requestContext, assignment.warehouse_id)) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Đơn nằm ngoài phạm vi kho được cấp quyền.');
  }

  if (assignment.trip_status === 'planned') {
    await setTripPlanningWriteContext(client);
    const reopened = await tripPlanningRepository.transitionTrip(client, {
      installationId: requestContext.installationId,
      tripId: assignment.trip_id,
      expectedStatus: 'planned',
      nextStatus: 'draft',
      reason: intent.reason,
      actorId: requestContext.actorId,
    });
    if (!reopened) {
      return failure('DELIVERY_TRIP_REOPEN_CONFLICT', 'Chuyến giao đã thay đổi. Hãy tải lại rồi thử lại.', true);
    }
    await insertPlanningTripEvent(client, {
      requestContext,
      tripId: assignment.trip_id,
      eventType: 'REOPENED',
      idempotencyKey: unwindIdempotencyKey(idempotencyKey, 'trip-reopen', assignment.trip_id),
      reason: intent.reason,
      metadata: { salesOrderUnwind: true, deliveryOrderId: assignment.delivery_order_id },
    });
  } else if (assignment.trip_status === 'locked') {
    await setSalesOrderUnwindTripWriteContext(client);
    const reopened = await client.query(
      `UPDATE logistics.delivery_trips
          SET status = 'draft',
              reopened_at = $3,
              reopened_by = $4,
              reopen_reason = $5,
              revision = revision + 1,
              updated_at = $3,
              updated_by = $4
        WHERE installation_id = $1
          AND id = $2
          AND status = 'locked'
          AND dispatch_id IS NULL
        RETURNING id`,
      [requestContext.installationId, assignment.trip_id, now(requestContext), requestContext.actorId, intent.reason],
    );
    if (!reopened.rows?.[0]) {
      return failure('DELIVERY_TRIP_UNLOCK_CONFLICT', 'Chuyến giao đã thay đổi. Hãy tải lại rồi thử lại.', true);
    }
    await insertPlanningTripEvent(client, {
      requestContext,
      tripId: assignment.trip_id,
      eventType: 'REOPENED',
      idempotencyKey: unwindIdempotencyKey(idempotencyKey, 'trip-unlock', assignment.trip_id),
      reason: intent.reason,
      metadata: { salesOrderUnwind: true, deliveryOrderId: assignment.delivery_order_id, fromStatus: 'locked' },
    });
  } else if (assignment.trip_status === 'draft') {
    await setTripPlanningWriteContext(client);
  } else {
    return failure(intent.blockedCode, intent.blockedMessage, false, {
      tripId: assignment.trip_id,
      tripStatus: assignment.trip_status,
    });
  }

  if (assignment.trip_status === 'locked') await setSalesOrderUnwindTripWriteContext(client);
  else await setTripPlanningWriteContext(client);

  const unassigned = await tripPlanningRepository.unassignDeliveryOrder(client, {
    installationId: requestContext.installationId,
    tripId: assignment.trip_id,
    deliveryOrderId: assignment.delivery_order_id,
    actorId: requestContext.actorId,
    reason: intent.reason,
  });
  if (!unassigned) {
    return failure('TRIP_UNASSIGN_CONFLICT', 'Phiếu giao đã thay đổi trong lúc gỡ khỏi chuyến.', true);
  }

  await insertPlanningTripEvent(client, {
    requestContext,
    tripId: assignment.trip_id,
    eventType: 'UNASSIGNED',
    idempotencyKey: unwindIdempotencyKey(idempotencyKey, 'trip-unassign', assignment.id),
    reason: intent.reason,
    metadata: { salesOrderUnwind: true, assignmentId: assignment.id, deliveryOrderId: assignment.delivery_order_id },
  });

  await setTripPlanningWriteContext(client);
  await tripPlanningRepository.deleteUnreferencedStop(client, {
    installationId: requestContext.installationId,
    stopId: assignment.trip_stop_id,
  });
  return Object.freeze({ ok: true });
}

async function reverseDeliveryInventoryIssue(client, {
  requestContext,
  deliveryOrderId,
  idempotencyKey,
  intent,
}) {
  const header = await deliveryInventoryRepository.getDeliveryOrderIssueSource(client, {
    installationId: requestContext.installationId,
    deliveryOrderId,
    forUpdate: true,
  });
  if (!header) return failure('DELIVERY_ORDER_NOT_FOUND', 'Không tìm thấy phiếu giao.');
  if (!warehouseAllowed(requestContext, header.warehouse_id)) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Phiếu giao nằm ngoài phạm vi kho được cấp quyền.');
  }

  const issue = await deliveryInventoryRepository.getActiveIssueForDeliveryOrder(client, {
    installationId: requestContext.installationId,
    deliveryOrderId,
    forUpdate: true,
  });
  if (!issue) return Object.freeze({ ok: true, reversed: false });
  if (issue.status !== 'POSTED' || !issue.inventory_movement_id) {
    return failure(intent.blockedCode, 'Phiếu Xuất kho đang ở trạng thái chưa thể hoàn tác. Hãy tải lại rồi thử lại.', false, {
      deliveryOrderId,
      issueStatus: issue.status,
    });
  }
  if (await deliveryInventoryRepository.hasBlockingCustomerReturn(client, {
    installationId: requestContext.installationId,
    issueId: issue.id,
  })) {
    return failure(intent.blockedCode, 'Đơn đã có chứng từ hoàn hàng liên quan nên không thể tự động hủy.', false, {
      deliveryOrderId,
      issueId: issue.id,
    });
  }

  await deliveryInventoryRepository.setDeliveryIssueWriteContext(client);
  const reversal = await reverseInventoryMovement(client, {
    requestContext,
    idempotencyKey: unwindIdempotencyKey(idempotencyKey, 'delivery-inventory', issue.id),
    movementId: issue.inventory_movement_id,
    payload: {
      documentDate: String(now(requestContext)).slice(0, 10),
      reasonCode: 'SALES_ORDER_UNWIND',
      reasonNote: intent.reason,
    },
  });
  if (!reversal.ok) return reversal;

  const issueLines = await deliveryInventoryRepository.listIssueLines(client, {
    installationId: requestContext.installationId,
    issueId: issue.id,
  });
  for (let index = 0; index < issueLines.length; index += 1) {
    const line = issueLines[index];
    const adjustmentPayload = {
      adjustmentType: 'RESTORE',
      reservationId: line.inventory_reservation_id,
      quantity: String(line.issued_base_quantity),
      deliveryOrderId,
      deliveryOrderLineId: line.delivery_order_line_id,
      issueId: issue.id,
      issueLineId: line.id,
      reversalMovementId: reversal.movement.id,
    };
    await deliveryInventoryRepository.insertReservationAdjustment(client, {
      installationId: requestContext.installationId,
      reservationId: line.inventory_reservation_id,
      adjustmentType: 'RESTORE',
      quantity: String(line.issued_base_quantity),
      sourceDocumentType: 'DELIVERY_ORDER_REVERSAL',
      sourceDocumentId: deliveryOrderId,
      sourceLineId: line.id,
      idempotencyKey: unwindIdempotencyKey(idempotencyKey, 'delivery-restore', line.id),
      payloadHash: payloadHash(adjustmentPayload),
      actorId: requestContext.actorId,
      requestId: requestContext.requestId,
      sourceApp: requestContext.sourceApp,
      metadata: adjustmentPayload,
      occurredAt: now(requestContext),
    });
  }

  const reversedAt = now(requestContext);
  const reversed = await deliveryInventoryRepository.reverseIssue(client, {
    installationId: requestContext.installationId,
    issueId: issue.id,
    reversalMovementId: reversal.movement.id,
    reason: intent.reason,
    actorId: requestContext.actorId,
    reversedAt,
  });
  if (!reversed) return failure('DELIVERY_ISSUE_REVERSAL_CONFLICT', 'Phiếu Xuất kho đã thay đổi trong lúc hoàn tác.', true);

  await deliveryInventoryRepository.updateDeliveryOrderIssueStatus(client, {
    installationId: requestContext.installationId,
    deliveryOrderId,
    status: 'ready_to_dispatch',
    actorId: requestContext.actorId,
  });
  const demandIds = [...new Set(issueLines.map((line) => line.fulfillment_demand_id))];
  await deliveryInventoryRepository.refreshFulfillmentIssuedProjection(client, {
    installationId: requestContext.installationId,
    demandIds,
    actorId: requestContext.actorId,
  });
  await deliveryInventoryRepository.refreshSalesOrderFulfillmentStatus(client, {
    installationId: requestContext.installationId,
    salesOrderId: header.sales_order_id,
    actorId: requestContext.actorId,
  });
  await deliveryInventoryRepository.refreshSalesOrderDeliveryStatus(client, {
    installationId: requestContext.installationId,
    salesOrderId: header.sales_order_id,
    actorId: requestContext.actorId,
  });
  await deliveryOrderRepository.insertDeliveryOrderEvent(client, {
    installationId: requestContext.installationId,
    deliveryOrderId,
    eventType: 'INVENTORY_ISSUE_REVERSED',
    idempotencyKey: unwindIdempotencyKey(idempotencyKey, 'delivery-issue-reversed', issue.id),
    payloadHash: payloadHash({ deliveryOrderId, issueId: issue.id, reversalMovementId: reversal.movement.id, reason: intent.reason }),
    actorId: requestContext.actorId,
    requestId: requestContext.requestId,
    sourceApp: requestContext.sourceApp,
    reason: intent.reason,
    metadata: { issueId: issue.id, reversalMovementId: reversal.movement.id, salesOrderUnwind: true },
    occurredAt: reversedAt,
  });
  return Object.freeze({ ok: true, reversed: true, issueId: issue.id, reversalMovementId: reversal.movement.id });
}

async function recoverTripAndUnassign(client, {
  requestContext,
  tripId,
  idempotencyKey,
  intent,
}) {
  let trip = await tripRecoveryRepository.getTripForUpdate(client, {
    installationId: requestContext.installationId,
    tripId,
  });
  if (!trip) return failure('DELIVERY_TRIP_NOT_FOUND', 'Không tìm thấy chuyến giao.');
  if (!warehouseAllowed(requestContext, trip.warehouse_id)) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Chuyến giao nằm ngoài phạm vi kho được cấp quyền.');
  }
  if (trip.status === 'dispatched') {
    if (await tripRecoveryRepository.hasDeliveryAttempts(client, {
      installationId: requestContext.installationId,
      tripId,
    })) {
      return failure(intent.blockedCode, 'Chuyến đã có kết quả giao khách. Cần xử lý thu hồi hoặc hoàn hàng trước khi hủy đơn.', false, { tripId });
    }
    await tripRecoveryRepository.setTripRecoveryWriteContext(client);
    const recoveryKey = unwindIdempotencyKey(idempotencyKey, 'trip-recovery', tripId);
    const recoveryHash = payloadHash({ tripId, operation: 'recover-dispatch', reason: intent.reason });
    const recovered = await tripRecoveryRepository.markTripRecovered(client, {
      installationId: requestContext.installationId,
      tripId,
      reason: intent.reason,
      idempotencyKey: recoveryKey,
      payloadHash: recoveryHash,
      actorId: requestContext.actorId,
      occurredAt: now(requestContext),
    });
    if (!recovered) return failure('TRIP_RECOVERY_CONFLICT', 'Chuyến giao đã thay đổi trong lúc thu hồi.', true);
    await tripRecoveryRepository.insertRecoveryEvent(client, {
      installationId: requestContext.installationId,
      tripId,
      eventType: 'DISPATCH_RECOVERED',
      idempotencyKey: recoveryKey,
      payloadHash: recoveryHash,
      actorId: requestContext.actorId,
      requestId: requestContext.requestId,
      sourceApp: requestContext.sourceApp,
      reason: intent.reason,
      metadata: { dispatchId: trip.dispatch_id, salesOrderUnwind: true },
      occurredAt: now(requestContext),
    });
    trip = recovered;
  }
  if (trip.status !== 'recovered') {
    return failure(intent.blockedCode, intent.blockedMessage, false, { tripId, tripStatus: trip.status });
  }

  const assignments = await listActiveTripAssignments(client, {
    installationId: requestContext.installationId,
    tripId,
  });
  for (const assignment of assignments) {
    if (assignment.inventory_issue_status === 'POSTED') {
      const reversal = await reverseDeliveryInventoryIssue(client, {
        requestContext,
        deliveryOrderId: assignment.delivery_order_id,
        idempotencyKey,
        intent,
      });
      if (!reversal.ok) return reversal;
    } else if (assignment.inventory_issue_status !== 'REVERSED') {
      return failure(intent.blockedCode, 'Chuyến có phiếu Xuất kho chưa ở trạng thái có thể thu hồi.', false, {
        tripId,
        assignmentId: assignment.id,
        issueStatus: assignment.inventory_issue_status,
      });
    }
  }

  await tripRecoveryRepository.setTripRecoveryWriteContext(client);
  for (const assignment of assignments) {
    const current = await tripRecoveryRepository.getAssignmentForRecovery(client, {
      installationId: requestContext.installationId,
      tripId,
      assignmentId: assignment.id,
    });
    if (!current) return failure('TRIP_ASSIGNMENT_NOT_FOUND', 'Không tìm thấy phiếu giao trên chuyến thu hồi.');
    if (current.inventory_issue_status !== 'REVERSED') {
      return failure(intent.blockedCode, 'Phiếu Xuất kho chưa được hoàn tác nên chưa thể gỡ khỏi chuyến.', false, {
        tripId,
        assignmentId: assignment.id,
      });
    }
    const unassigned = await tripRecoveryRepository.recoveryUnassign(client, {
      installationId: requestContext.installationId,
      tripId,
      assignmentId: assignment.id,
      reason: intent.reason,
      actorId: requestContext.actorId,
      occurredAt: now(requestContext),
    });
    if (!unassigned) return failure('RECOVERY_UNASSIGN_CONFLICT', 'Phiếu giao đã thay đổi trong lúc gỡ khỏi chuyến.', true);
    const eventKey = unwindIdempotencyKey(idempotencyKey, 'recovery-unassign', assignment.id);
    await tripRecoveryRepository.insertRecoveryEvent(client, {
      installationId: requestContext.installationId,
      tripId,
      eventType: 'RECOVERY_UNASSIGNED',
      idempotencyKey: eventKey,
      payloadHash: payloadHash({ tripId, assignmentId: assignment.id, operation: 'recovery-unassign', reason: intent.reason }),
      actorId: requestContext.actorId,
      requestId: requestContext.requestId,
      sourceApp: requestContext.sourceApp,
      reason: intent.reason,
      metadata: {
        assignmentId: assignment.id,
        deliveryOrderId: assignment.delivery_order_id,
        inventoryIssueId: assignment.inventory_issue_id,
        salesOrderUnwind: true,
      },
      occurredAt: now(requestContext),
    });
  }
  return Object.freeze({ ok: true, assignments: Object.freeze(assignments) });
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
  const recoveredTrips = new Set();
  const unwound = [];

  for (const row of deliveryOrders) {
    let assignment = await getActiveAssignmentForDeliveryOrder(client, {
      installationId: requestContext.installationId,
      deliveryOrderId: row.id,
    });
    if (assignment) {
      if (['draft', 'planned', 'locked'].includes(assignment.trip_status)) {
        const unassigned = await reopenAndUnassignPreDispatch(client, {
          requestContext,
          assignment,
          idempotencyKey,
          intent,
        });
        if (!unassigned.ok) return unassigned;
      } else if (['dispatched', 'recovered'].includes(assignment.trip_status)) {
        if (!recoveredTrips.has(assignment.trip_id)) {
          const recovered = await recoverTripAndUnassign(client, {
            requestContext,
            tripId: assignment.trip_id,
            idempotencyKey,
            intent,
          });
          if (!recovered.ok) return recovered;
          recoveredTrips.add(assignment.trip_id);
        }
      } else {
        return failure(intent.blockedCode, intent.blockedMessage, false, {
          tripId: assignment.trip_id,
          tripStatus: assignment.trip_status,
        });
      }
    }

    let header = await deliveryInventoryRepository.getDeliveryOrderIssueSource(client, {
      installationId: requestContext.installationId,
      deliveryOrderId: row.id,
      forUpdate: true,
    });
    if (!header) return failure('DELIVERY_ORDER_NOT_FOUND', 'Không tìm thấy phiếu giao.');
    if (header.status === 'handed_over') {
      return failure(intent.blockedCode, 'Đơn đã giao khách. Cần xử lý hoàn hàng thay vì hủy trực tiếp.', false, { deliveryOrderId: row.id });
    }
    if (header.status === 'dispatched') {
      const reversal = await reverseDeliveryInventoryIssue(client, {
        requestContext,
        deliveryOrderId: row.id,
        idempotencyKey,
        intent,
      });
      if (!reversal.ok) return reversal;
      header = await deliveryInventoryRepository.getDeliveryOrderIssueSource(client, {
        installationId: requestContext.installationId,
        deliveryOrderId: row.id,
        forUpdate: true,
      });
    }

    if (header.status === 'draft') {
      await deliveryOrderRepository.setDeliveryOrderWriteContext(client);
      const cancelled = await deliveryOrderRepository.cancelDeliveryOrder(client, {
        installationId: requestContext.installationId,
        deliveryOrderId: row.id,
        reason: intent.reason,
        actorId: requestContext.actorId,
      });
      if (!cancelled) return failure('DELIVERY_ORDER_CANCEL_CONFLICT', 'Phiếu giao đã thay đổi trong lúc hủy.', true);
      await deliveryOrderRepository.insertDeliveryOrderEvent(client, {
        installationId: requestContext.installationId,
        deliveryOrderId: row.id,
        eventType: 'CANCELLED',
        idempotencyKey: unwindIdempotencyKey(idempotencyKey, 'delivery-order-cancel', row.id),
        payloadHash: payloadHash({ deliveryOrderId: row.id, operation: intent.operation, reason: intent.reason }),
        actorId: requestContext.actorId,
        requestId: requestContext.requestId,
        sourceApp: requestContext.sourceApp,
        reason: intent.reason,
        metadata: { salesOrderId, operation: intent.operation, salesOrderUnwind: true },
        occurredAt: now(requestContext),
      });
      unwound.push(Object.freeze({ id: row.id, from: 'draft', to: 'cancelled' }));
      continue;
    }

    if (header.status === 'ready_to_dispatch') {
      const activeIssue = await deliveryInventoryRepository.getActiveIssueForDeliveryOrder(client, {
        installationId: requestContext.installationId,
        deliveryOrderId: row.id,
        forUpdate: true,
      });
      if (activeIssue) {
        const reversal = await reverseDeliveryInventoryIssue(client, {
          requestContext,
          deliveryOrderId: row.id,
          idempotencyKey,
          intent,
        });
        if (!reversal.ok) return reversal;
      }
      assignment = await getActiveAssignmentForDeliveryOrder(client, {
        installationId: requestContext.installationId,
        deliveryOrderId: row.id,
      });
      if (assignment) return failure(intent.blockedCode, intent.blockedMessage, false, { deliveryOrderId: row.id, tripId: assignment.trip_id });
      await deliveryReversalRepository.setDeliveryReversalWriteContext(client);
      const blockers = await deliveryReversalRepository.getReleaseBlockers(client, {
        installationId: requestContext.installationId,
        deliveryOrderId: row.id,
      });
      if (blockers.has_active_inventory_issue || blockers.has_active_trip_assignment) {
        return failure(intent.blockedCode, intent.blockedMessage, false, {
          deliveryOrderId: row.id,
          activeInventoryIssue: Boolean(blockers.has_active_inventory_issue),
          activeTripAssignment: Boolean(blockers.has_active_trip_assignment),
        });
      }
      const released = await deliveryReversalRepository.releaseDeliveryOrderForReversal(client, {
        installationId: requestContext.installationId,
        deliveryOrderId: row.id,
        reason: intent.reason,
        actorId: requestContext.actorId,
        occurredAt: now(requestContext),
      });
      if (!released) return failure('DELIVERY_ORDER_REVERSAL_CONFLICT', 'Phiếu giao đã thay đổi trong lúc hoàn tác.', true);
      await deliveryReversalRepository.insertDeliveryOrderEvent(client, {
        installationId: requestContext.installationId,
        deliveryOrderId: row.id,
        idempotencyKey: unwindIdempotencyKey(idempotencyKey, 'delivery-order-release', row.id),
        payloadHash: payloadHash({ deliveryOrderId: row.id, operation: intent.operation, reason: intent.reason }),
        actorId: requestContext.actorId,
        requestId: requestContext.requestId,
        sourceApp: requestContext.sourceApp,
        reason: intent.reason,
        metadata: { salesOrderId, operation: intent.operation, salesOrderUnwind: true },
        occurredAt: now(requestContext),
      });
      unwound.push(Object.freeze({ id: row.id, from: 'ready_to_dispatch', to: 'cancelled' }));
      continue;
    }

    return failure(intent.blockedCode, intent.blockedMessage, false, {
      deliveryOrderId: row.id,
      deliveryOrderStatus: header.status,
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

async function listActiveManualIssueMovementsForUpdate(client, { installationId, salesOrderId }) {
  const result = await client.query(
    `SELECT movement.id
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

async function resetManualIssueProjection(client, { requestContext, salesOrderId }) {
  await deliveryInventoryRepository.setDeliveryIssueWriteContext(client);
  await client.query(
    `UPDATE sales.sales_order_fulfillment_demands demand
        SET issued_base_quantity = 0,
            updated_at = now(),
            updated_by = $3
      WHERE demand.installation_id = $1
        AND demand.sales_order_id = $2
        AND demand.state = 'ACTIVE'
        AND demand.issued_base_quantity <> 0
        AND NOT EXISTS (
          SELECT 1 FROM sales.sales_order_fulfillment_allocations allocation
           WHERE allocation.installation_id = demand.installation_id
             AND allocation.fulfillment_demand_id = demand.id
             AND allocation.state <> 'RELEASED'
        )`,
    [requestContext.installationId, salesOrderId, requestContext.actorId],
  );

  await allocationRepository.setFulfillmentReversalWriteContexts(client);
  await client.query(
    `UPDATE sales.sales_order_fulfillment_demands demand
        SET picked_base_quantity = 0,
            packed_base_quantity = 0,
            updated_at = now(),
            updated_by = $3
      WHERE demand.installation_id = $1
        AND demand.sales_order_id = $2
        AND demand.state = 'ACTIVE'
        AND demand.issued_base_quantity = 0
        AND (demand.picked_base_quantity <> 0 OR demand.packed_base_quantity <> 0)
        AND NOT EXISTS (
          SELECT 1 FROM sales.sales_order_fulfillment_allocations allocation
           WHERE allocation.installation_id = demand.installation_id
             AND allocation.fulfillment_demand_id = demand.id
             AND allocation.state <> 'RELEASED'
        )`,
    [requestContext.installationId, salesOrderId, requestContext.actorId],
  );

  await client.query("SELECT set_config('npp.sales_fulfillment_write_context', 'fulfillment_release_service', true)");
  await client.query(
    `UPDATE sales.sales_order_fulfillment_demands demand
        SET allocated_base_quantity = 0,
            updated_at = now(),
            updated_by = $3
      WHERE demand.installation_id = $1
        AND demand.sales_order_id = $2
        AND demand.state = 'ACTIVE'
        AND demand.issued_base_quantity = 0
        AND demand.picked_base_quantity = 0
        AND demand.packed_base_quantity = 0
        AND demand.allocated_base_quantity <> 0
        AND NOT EXISTS (
          SELECT 1 FROM sales.sales_order_fulfillment_allocations allocation
           WHERE allocation.installation_id = demand.installation_id
             AND allocation.fulfillment_demand_id = demand.id
             AND allocation.state <> 'RELEASED'
        )`,
    [requestContext.installationId, salesOrderId, requestContext.actorId],
  );

  await deliveryInventoryRepository.refreshSalesOrderFulfillmentStatus(client, {
    installationId: requestContext.installationId,
    salesOrderId,
    actorId: requestContext.actorId,
  });
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
  for (const movement of movements) {
    const reversal = await reverseInventoryMovement(client, {
      requestContext,
      idempotencyKey: unwindIdempotencyKey(idempotencyKey, 'manual-stock-issue', movement.id),
      movementId: movement.id,
      payload: {
        documentDate: String(now(requestContext)).slice(0, 10),
        reasonCode: 'SALES_ORDER_UNWIND',
        reasonNote: intent.reason,
      },
    });
    if (!reversal.ok) return reversal;
    reversed.push(Object.freeze({ movementId: movement.id, reversalMovementId: reversal.movement.id }));
  }
  await resetManualIssueProjection(client, { requestContext, salesOrderId });
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
      if (!updated) return failure('FULFILLMENT_PACK_REVERSAL_CONFLICT', 'Số lượng đóng gói đã thay đổi trong lúc hoàn tác.', true);
      await allocationRepository.insertAllocationEvent(client, {
        installationId: requestContext.installationId,
        allocationId: current.id,
        eventType: 'PACK_REVERSED',
        quantity,
        actorId: requestContext.actorId,
        requestId: requestContext.requestId,
        sourceApp: requestContext.sourceApp,
        idempotencyKey: unwindIdempotencyKey(idempotencyKey, 'pack', current.id),
        payloadHash: payloadHash({ allocationId: current.id, eventType: 'PACK_REVERSED', quantity, reason: intent.reason }),
        reason: intent.reason,
        metadata: { salesOrderId, operation: intent.operation, salesOrderUnwind: true },
        occurredAt: now(requestContext),
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
      if (!updated) return failure('FULFILLMENT_PICK_REVERSAL_CONFLICT', 'Số lượng đã soạn đã thay đổi trong lúc hoàn tác.', true);
      await allocationRepository.insertAllocationEvent(client, {
        installationId: requestContext.installationId,
        allocationId: current.id,
        eventType: 'PICK_REVERSED',
        quantity,
        actorId: requestContext.actorId,
        requestId: requestContext.requestId,
        sourceApp: requestContext.sourceApp,
        idempotencyKey: unwindIdempotencyKey(idempotencyKey, 'pick', current.id),
        payloadHash: payloadHash({ allocationId: current.id, eventType: 'PICK_REVERSED', quantity, reason: intent.reason }),
        reason: intent.reason,
        metadata: { salesOrderId, operation: intent.operation, salesOrderUnwind: true },
        occurredAt: now(requestContext),
      });
      reversed.push(Object.freeze({ allocationId: current.id, kind: 'PICK', quantity }));
    }
  }
  return Object.freeze({ ok: true, reversed: Object.freeze(reversed) });
}

export async function unwindSalesOrderExecution(client, {
  requestContext,
  salesOrderId,
  idempotencyKey,
  intent,
}) {
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
  return Object.freeze({
    ok: true,
    deliveryOrders: delivery.deliveryOrders,
    reversedManualIssues: manualIssue.movements,
    reversedProgress: progress.reversed,
  });
}

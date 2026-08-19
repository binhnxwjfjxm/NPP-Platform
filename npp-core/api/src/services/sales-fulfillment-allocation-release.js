import { createHash } from 'node:crypto';
import { createIdempotencyKey } from '@npp/contracts';
import * as allocationRepository from '../db/repositories/sales-fulfillment-reversal.js';
import * as inventoryReservationRepository from '../db/repositories/inventory-reservations.js';
import * as repository from '../db/repositories/sales-fulfillment-allocation-release.js';

const ZERO_DECIMAL_PATTERN = /^[+-]?0+(?:\.0+)?$/;

const RELEASE_INTENTS = Object.freeze({
  'manual-edit': Object.freeze({
    operation: 'manual-sales-order-edit',
    reason: 'Sửa đơn Giao thủ công trước khi xử lý hàng',
    blockedCode: 'MANUAL_DELIVERY_EDIT_NOT_AVAILABLE',
    blockedMessage: 'Đơn đã bắt đầu soạn, đóng gói hoặc giao hàng nên không thể sửa trực tiếp.',
  }),
  amendment: Object.freeze({
    operation: 'sales-order-amendment',
    reason: 'Điều chỉnh đơn trước khi xử lý hàng',
    blockedCode: 'SALES_ORDER_AMENDMENT_BLOCKED',
    blockedMessage: 'Đơn đã bắt đầu soạn, đóng gói hoặc giao hàng nên không thể xác nhận thay đổi.',
  }),
  cancel: Object.freeze({
    operation: 'sales-order-cancel',
    reason: 'Hủy đơn trước khi xử lý hàng',
    blockedCode: 'SALES_ORDER_CANCEL_BLOCKED',
    blockedMessage: 'Đơn đã bắt đầu soạn, đóng gói hoặc giao hàng nên không thể hủy trực tiếp.',
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

function isZero(value) {
  return ZERO_DECIMAL_PATTERN.test(String(value ?? '0').trim() || '0');
}

function releaseBlocked(allocation) {
  return !isZero(allocation.picked_base_quantity)
    || !isZero(allocation.packed_base_quantity)
    || !isZero(allocation.claimed_base_quantity);
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

export async function releasePreExecutionAllocations(client, {
  requestContext,
  salesOrderId,
  idempotencyKey,
  intentName = 'manual-edit',
}) {
  const intent = releaseIntent(intentName);
  await repository.setManualEditReleaseWriteContexts(client);
  if (await repository.hasPhysicalExecutionFacts(client, {
    installationId: requestContext.installationId,
    salesOrderId,
  })) {
    return failure(intent.blockedCode, intent.blockedMessage);
  }

  const allocations = await allocationRepository.listOrderAllocationsForUpdate(client, {
    installationId: requestContext.installationId,
    salesOrderId,
  });
  if (allocations.some(releaseBlocked)) {
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

export function releaseManualEditAllocations(client, input) {
  return releasePreExecutionAllocations(client, { ...input, intentName: 'manual-edit' });
}

export const manualEditAllocationReleaseInternals = Object.freeze({
  deterministicUuid,
  childIdempotencyKey,
  releaseBlocked,
  payloadHash,
  releaseIntent,
});
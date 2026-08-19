import { createHash } from 'node:crypto';
import { createIdempotencyKey } from '@npp/contracts';
import * as allocationRepository from '../db/repositories/sales-fulfillment-reversal.js';
import * as inventoryReservationRepository from '../db/repositories/inventory-reservations.js';
import * as repository from '../db/repositories/sales-fulfillment-allocation-release.js';

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

function childIdempotencyKey(parentKey, allocationId) {
  return createIdempotencyKey(
    'sales-manual-edit-release',
    deterministicUuid(`${parentKey}|${allocationId}`),
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
      'Phân bổ hàng đã thay đổi trong lúc sửa đơn. Hãy tải lại rồi thử lại.',
      true,
    );
  }

  const hash = payloadHash({
    reservationId: reservation.id,
    transition: 'RELEASE_TO_RELEASED',
    reason: 'Sửa đơn Giao thủ công trước khi xử lý hàng',
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
      action: 'manual-sales-order-edit',
      reason: 'Sửa đơn Giao thủ công trước khi xử lý hàng',
      salesOrderId: allocation.sales_order_id,
      allocationId: allocation.id,
    },
  });
  return Object.freeze({ ok: true, reservation: updated });
}

export async function releaseManualEditAllocations(client, {
  requestContext,
  salesOrderId,
  idempotencyKey,
}) {
  await repository.setManualEditReleaseWriteContexts(client);
  const allocations = await allocationRepository.listOrderAllocationsForUpdate(client, {
    installationId: requestContext.installationId,
    salesOrderId,
  });
  const active = allocations.filter((allocation) => allocation.state === 'ACTIVE');
  if (active.length === 0) return Object.freeze({ ok: true, released: Object.freeze([]) });

  if (active.some(releaseBlocked)) {
    return failure(
      'MANUAL_DELIVERY_EDIT_NOT_AVAILABLE',
      'Đơn đã bắt đầu soạn, đóng gói hoặc giao hàng nên không thể sửa trực tiếp.',
    );
  }

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
        'Phân bổ hàng đã thay đổi trong lúc sửa đơn. Hãy tải lại rồi thử lại.',
        true,
        { allocationId: allocation.id },
      );
    }

    const operationKey = childIdempotencyKey(idempotencyKey, allocation.id);
    const hash = payloadHash({
      allocationId: allocation.id,
      eventType: 'RELEASED',
      quantity: String(allocation.allocated_base_quantity),
      reason: 'Sửa đơn Giao thủ công trước khi xử lý hàng',
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
      reason: 'Sửa đơn Giao thủ công trước khi xử lý hàng',
      metadata: { salesOrderId, operation: 'manual-sales-order-edit' },
      occurredAt,
    });
    released.push(Object.freeze({ allocation: allocationAfter, reservation: reservationResult.reservation }));
  }

  return Object.freeze({ ok: true, released: Object.freeze(released) });
}

export const manualEditAllocationReleaseInternals = Object.freeze({
  deterministicUuid,
  childIdempotencyKey,
  releaseBlocked,
  payloadHash,
});

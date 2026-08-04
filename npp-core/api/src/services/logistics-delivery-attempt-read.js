import * as attemptRepository from '../db/repositories/logistics-driver-delivery.js';
import * as tripRepository from '../db/repositories/logistics-trip-planning.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function failure(code, message, retryable = false, details = {}) {
  return Object.freeze({ ok: false, code, message, retryable, details });
}

function hasPermission(requestContext, permission) {
  return Array.isArray(requestContext?.permissions) && requestContext.permissions.includes(permission);
}

function warehouseAllowed(requestContext, warehouseId) {
  return Array.isArray(requestContext?.scopes?.warehouseIds)
    && requestContext.scopes.warehouseIds.includes(warehouseId);
}

function mapAttempt(row) {
  return Object.freeze({
    id: row.id,
    tripId: row.trip_id,
    stopId: row.trip_stop_id,
    stopSequence: Number(row.stop_sequence),
    assignmentId: row.assignment_id,
    deliveryOrderId: row.delivery_order_id,
    deliveryOrderNumber: row.delivery_order_number ?? null,
    customerCode: row.customer_code_snapshot ?? null,
    customerName: row.customer_name_snapshot ?? null,
    driverProfileId: row.driver_profile_id,
    result: row.result,
    attemptedAt: row.attempted_at,
    reasonCode: row.reason_code ?? null,
    note: row.note ?? null,
    rescheduledFor: row.rescheduled_for ?? null,
  });
}

export async function getDeliveryTripAttemptSummary(adapter, { requestContext, tripId }) {
  if (!UUID_PATTERN.test(String(tripId ?? ''))) return failure('INVALID_TRIP_ID', 'Trip id is invalid');
  if (!hasPermission(requestContext, 'core.delivery-trip.read')) {
    return failure('PERMISSION_DENIED', 'Permission core.delivery-trip.read is required');
  }
  if (!hasPermission(requestContext, 'core.delivery-attempt.read')) {
    return failure('PERMISSION_DENIED', 'Permission core.delivery-attempt.read is required');
  }
  try {
    const trip = await tripRepository.getTrip(adapter, {
      installationId: requestContext.installationId,
      tripId,
    });
    if (!trip) return failure('DELIVERY_TRIP_NOT_FOUND', 'Delivery trip was not found');
    if (!warehouseAllowed(requestContext, trip.warehouse_id)) {
      return failure('WAREHOUSE_SCOPE_DENIED', 'Delivery trip is outside the authorized warehouse scope');
    }
    if (trip.status !== 'dispatched') {
      return Object.freeze({
        ok: true,
        trip: Object.freeze({
          id: trip.id,
          number: trip.trip_number,
          status: trip.status,
          warehouseId: trip.warehouse_id,
        }),
        attempts: Object.freeze([]),
      });
    }
    const rows = await attemptRepository.listTripAttempts(adapter, {
      installationId: requestContext.installationId,
      tripId,
    });
    return Object.freeze({
      ok: true,
      trip: Object.freeze({
        id: trip.id,
        number: trip.trip_number,
        status: trip.status,
        warehouseId: trip.warehouse_id,
      }),
      attempts: Object.freeze(rows.map(mapAttempt)),
    });
  } catch {
    return failure('DELIVERY_ATTEMPT_SUMMARY_QUERY_FAILED', 'Delivery attempt summary is temporarily unavailable', true);
  }
}

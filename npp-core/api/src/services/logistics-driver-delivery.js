import * as repository from '../db/repositories/logistics-driver-delivery.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function failure(code, message, retryable = false, details = {}) {
  return Object.freeze({ ok: false, code, message, retryable, details });
}

function hasPermission(requestContext, permission) {
  return Array.isArray(requestContext?.permissions) && requestContext.permissions.includes(permission);
}

function warehouseIds(requestContext) {
  return Array.isArray(requestContext?.scopes?.warehouseIds)
    ? [...new Set(requestContext.scopes.warehouseIds.filter((value) => UUID_PATTERN.test(value)))]
    : [];
}

function mapAssignment(value) {
  return Object.freeze({
    assignmentId: value.assignmentId,
    deliveryOrderId: value.deliveryOrderId,
    deliveryOrderNumber: value.deliveryOrderNumber ?? null,
    salesOrderId: value.salesOrderId ?? null,
    customerCode: value.customerCode ?? null,
    customerName: value.customerName ?? null,
    requestedDeliveryDate: value.requestedDeliveryDate ?? null,
    collectionPolicy: value.collectionPolicy ?? null,
    assignedAt: value.assignedAt ?? null,
  });
}

function mapStop(row) {
  return Object.freeze({
    id: row.id,
    sequence: Number(row.stop_sequence),
    customerId: row.customer_id,
    customerAddressId: row.customer_address_id,
    address: row.address_snapshot ?? {},
    plannedArrivalAt: row.planned_arrival_at ?? null,
    assignments: Object.freeze((Array.isArray(row.assignments) ? row.assignments : []).map(mapAssignment)),
  });
}

function mapTrip(row, stops = undefined) {
  return Object.freeze({
    id: row.id,
    number: row.trip_number,
    status: row.status,
    warehouseId: row.warehouse_id,
    warehouseCode: row.warehouse_code ?? null,
    warehouseName: row.warehouse_name ?? null,
    vehicleId: row.vehicle_id ?? null,
    vehicleCode: row.vehicle_code ?? null,
    licensePlate: row.license_plate ?? null,
    vehicleType: row.vehicle_type ?? null,
    primaryDriverId: row.primary_driver_id,
    driverCode: row.driver_code ?? null,
    driverName: row.driver_name ?? null,
    driverPhone: row.driver_phone ?? null,
    plannedStartAt: row.planned_start_at ?? null,
    dispatchedAt: row.dispatched_at ?? null,
    handoverReceiverName: row.handover_receiver_name ?? null,
    handoverNote: row.handover_note ?? null,
    note: row.note ?? null,
    stopCount: row.stop_count === undefined ? undefined : Number(row.stop_count),
    assignmentCount: row.assignment_count === undefined ? undefined : Number(row.assignment_count),
    stops,
  });
}

async function resolveDriver(adapter, requestContext) {
  if (!hasPermission(requestContext, 'core.delivery-trip.driver-read')) {
    return failure('PERMISSION_DENIED', 'Permission core.delivery-trip.driver-read is required');
  }
  if (!UUID_PATTERN.test(String(requestContext?.employeeId ?? ''))) {
    return failure('DELIVERY_DRIVER_IDENTITY_REQUIRED', 'A trusted employee identity is required');
  }
  const scopes = warehouseIds(requestContext);
  if (scopes.length === 0) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Driver has no authorized warehouse scope');
  }
  const driver = await repository.getActiveDriverByEmployee(adapter, {
    installationId: requestContext.installationId,
    employeeId: requestContext.employeeId,
  });
  if (!driver) {
    return failure('DELIVERY_DRIVER_PROFILE_NOT_FOUND', 'Active driver profile was not found');
  }
  return Object.freeze({ ok: true, driver, warehouseIds: Object.freeze(scopes) });
}

export async function listAssignedDriverTrips(adapter, {
  requestContext,
  limit = 100,
  offset = 0,
}) {
  try {
    const identity = await resolveDriver(adapter, requestContext);
    if (!identity.ok) return identity;
    const rows = await repository.listDriverTrips(adapter, {
      installationId: requestContext.installationId,
      driverProfileId: identity.driver.id,
      warehouseIds: identity.warehouseIds,
      limit,
      offset,
    });
    return Object.freeze({
      ok: true,
      driver: Object.freeze({
        id: identity.driver.id,
        code: identity.driver.code,
        name: identity.driver.name,
        employeeId: identity.driver.employee_id,
      }),
      trips: Object.freeze(rows.map((row) => mapTrip(row))),
    });
  } catch {
    return failure('DELIVERY_DRIVER_TRIPS_QUERY_FAILED', 'Assigned trips are temporarily unavailable', true);
  }
}

export async function getAssignedDriverTrip(adapter, { requestContext, tripId }) {
  if (!UUID_PATTERN.test(String(tripId ?? ''))) return failure('INVALID_TRIP_ID', 'Trip id is invalid');
  try {
    const identity = await resolveDriver(adapter, requestContext);
    if (!identity.ok) return identity;
    const row = await repository.getDriverTrip(adapter, {
      installationId: requestContext.installationId,
      tripId,
      driverProfileId: identity.driver.id,
      warehouseIds: identity.warehouseIds,
    });
    if (!row) return failure('DELIVERY_TRIP_NOT_FOUND', 'Delivery trip was not found');
    const stops = await repository.listDriverTripStops(adapter, {
      installationId: requestContext.installationId,
      tripId,
    });
    return Object.freeze({
      ok: true,
      driver: Object.freeze({
        id: identity.driver.id,
        code: identity.driver.code,
        name: identity.driver.name,
        employeeId: identity.driver.employee_id,
      }),
      trip: mapTrip(row, Object.freeze(stops.map(mapStop))),
    });
  } catch {
    return failure('DELIVERY_DRIVER_TRIP_QUERY_FAILED', 'Assigned trip is temporarily unavailable', true);
  }
}

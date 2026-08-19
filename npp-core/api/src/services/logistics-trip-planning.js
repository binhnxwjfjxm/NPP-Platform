import { createHash, randomUUID } from 'node:crypto';
import {
  buildAuditRecord,
  buildOutboxEvent,
  insertAuditRecord,
  insertOutboxEvent,
  withAuditOutboxTransaction,
} from '../audit-outbox.js';
import * as repository from '../db/repositories/logistics-trip-planning.js';
import * as warehouseRepository from '../db/repositories/warehouse.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DECIMAL_PATTERN = /^(?:0|[1-9]\d{0,17})(?:\.\d{1,12})?$/;
const TRIP_STATUSES = new Set(['draft', 'planned', 'locked']);

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

function trimText(value, max, required = false) {
  if (value === null || value === undefined) return required ? null : null;
  const text = String(value).trim();
  if (!text) return required ? null : null;
  return text.length <= max ? text : null;
}

function nullableUuid(value) {
  if (value === null || value === undefined || value === '') return null;
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value : undefined;
}

function warehouseIds(requestContext) {
  return Array.isArray(requestContext?.scopes?.warehouseIds)
    ? [...new Set(requestContext.scopes.warehouseIds.filter((value) => UUID_PATTERN.test(value)))]
    : [];
}

function warehouseAllowed(requestContext, warehouseId) {
  return warehouseIds(requestContext).includes(warehouseId);
}

function mapRoute(row) {
  return Object.freeze({
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description ?? null,
    defaultWarehouseId: row.default_warehouse_id ?? null,
    defaultWarehouseCode: row.warehouse_code ?? null,
    defaultWarehouseName: row.warehouse_name ?? null,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function mapVehicle(row) {
  return Object.freeze({
    id: row.id,
    code: row.code,
    licensePlate: row.license_plate,
    vehicleType: row.vehicle_type,
    capacityWeight: row.capacity_weight == null ? null : String(row.capacity_weight),
    capacityVolume: row.capacity_volume == null ? null : String(row.capacity_volume),
    operationalStatus: row.operational_status,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function mapDriver(row) {
  return Object.freeze({
    id: row.id,
    code: row.code,
    employeeId: row.employee_id ?? null,
    name: row.name,
    phone: row.phone ?? null,
    licenseReference: row.license_reference ?? null,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function mapTrip(row, stops = undefined, events = undefined) {
  return Object.freeze({
    id: row.id,
    number: row.trip_number,
    warehouseId: row.warehouse_id,
    warehouseCode: row.warehouse_code ?? null,
    warehouseName: row.warehouse_name ?? null,
    deliveryRouteId: row.delivery_route_id ?? null,
    routeCode: row.route_code ?? null,
    routeName: row.route_name ?? null,
    vehicleId: row.vehicle_id ?? null,
    vehicleCode: row.vehicle_code ?? null,
    licensePlate: row.license_plate ?? null,
    primaryDriverId: row.primary_driver_id ?? null,
    driverCode: row.driver_code ?? null,
    driverName: row.driver_name ?? null,
    plannedStartAt: row.planned_start_at ?? null,
    status: row.status,
    note: row.note ?? null,
    revision: String(row.revision),
    stopCount: row.stop_count === undefined ? undefined : Number(row.stop_count),
    assignmentCount: row.assignment_count === undefined ? undefined : Number(row.assignment_count),
    plannedAt: row.planned_at ?? null,
    plannedBy: row.planned_by ?? null,
    reopenedAt: row.reopened_at ?? null,
    reopenedBy: row.reopened_by ?? null,
    reopenReason: row.reopen_reason ?? null,
    lockedAt: row.locked_at ?? null,
    lockedBy: row.locked_by ?? null,
    createdAt: row.created_at,
    createdBy: row.created_by,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
    stops,
    events,
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
    assignments: Object.freeze(Array.isArray(row.assignments) ? row.assignments : []),
  });
}

function mapEvent(row) {
  return Object.freeze({
    id: row.id,
    type: row.event_type,
    actorId: row.actor_id,
    requestId: row.request_id,
    sourceApp: row.source_app,
    reason: row.reason ?? null,
    metadata: row.metadata ?? {},
    occurredAt: row.occurred_at,
  });
}

function mapEligibleDeliveryOrder(row) {
  return Object.freeze({
    id: row.id,
    number: row.delivery_order_number,
    salesOrderId: row.sales_order_id,
    warehouseId: row.warehouse_id,
    warehouseCode: row.warehouse_code,
    warehouseName: row.warehouse_name,
    customerId: row.customer_id,
    customerAddressId: row.customer_address_id,
    customerCode: row.customer_code_snapshot,
    customerName: row.customer_name_snapshot,
    destination: row.destination_snapshot ?? {},
    requestedDeliveryDate: row.requested_delivery_date
      ? String(row.requested_delivery_date).slice(0, 10)
      : null,
    collectionPolicy: row.collection_policy,
    lineCount: Number(row.line_count),
    totalBaseQuantity: String(row.total_base_quantity),
  });
}

async function setWriteContext(client) {
  await client.query("SELECT set_config('npp.logistics_write_context', 'trip_planning_service', true)");
}

async function loadTripDetail(client, { requestContext, tripId, forUpdate = false }) {
  const row = await repository.getTrip(client, {
    installationId: requestContext.installationId,
    tripId,
    forUpdate,
  });
  if (!row) return failure('DELIVERY_TRIP_NOT_FOUND', 'Delivery trip was not found');
  if (!warehouseAllowed(requestContext, row.warehouse_id)) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Delivery trip is outside the authorized warehouse scope');
  }
  const [stops, events] = await Promise.all([
    repository.listTripStops(client, { installationId: requestContext.installationId, tripId }),
    repository.listTripEvents(client, { installationId: requestContext.installationId, tripId }),
  ]);
  return Object.freeze({
    ok: true,
    trip: mapTrip(row, Object.freeze(stops.map(mapStop)), Object.freeze(events.map(mapEvent))),
  });
}

async function validateRouteWarehouse(client, { requestContext, deliveryRouteId, warehouseId }) {
  if (!deliveryRouteId) return Object.freeze({ ok: true });
  const rows = await repository.listRoutes(client, {
    installationId: requestContext.installationId,
    active: true,
    limit: 1000,
    offset: 0,
  });
  const route = rows.find((candidate) => candidate.id === deliveryRouteId);
  if (!route || !route.default_warehouse_id) {
    return failure('DELIVERY_ROUTE_NOT_AVAILABLE', 'Delivery route is inactive or has no warehouse configuration');
  }
  if (!warehouseAllowed(requestContext, route.default_warehouse_id)) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Delivery route warehouse is outside the authorized scope');
  }
  if (route.default_warehouse_id !== warehouseId) {
    return failure('DELIVERY_ROUTE_WAREHOUSE_MISMATCH', 'Delivery route belongs to another warehouse');
  }
  return Object.freeze({ ok: true, route: mapRoute(route) });
}

function eventName(eventType) {
  return {
    CREATED: 'core.delivery_trip.created',
    UPDATED: 'core.delivery_trip.updated',
    ASSIGNED: 'core.delivery_trip.delivery_order_assigned',
    UNASSIGNED: 'core.delivery_trip.delivery_order_unassigned',
    REORDERED: 'core.delivery_trip.stops_reordered',
    PLANNED: 'core.delivery_trip.planned',
    REOPENED: 'core.delivery_trip.reopened',
    LOCKED: 'core.delivery_trip.locked',
  }[eventType];
}

async function writeTripAuditOutbox(client, { requestContext, eventType, trip, beforeData = null, metadata = {} }) {
  const action = eventName(eventType);
  await insertAuditRecord(client, buildAuditRecord({
    requestContext,
    action,
    resourceType: 'delivery_trip',
    resourceId: trip.id,
    beforeData,
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

async function createMaster({ adapter, requestContext, resourceType, payload, insert, map }) {
  try {
    const result = await withAuditOutboxTransaction({
      adapter,
      mutate: async (client) => {
        const row = await insert(client);
        const resource = map(row);
        const action = `core.${resourceType}.created`;
        await insertAuditRecord(client, buildAuditRecord({
          requestContext,
          action,
          resourceType,
          resourceId: resource.id,
          afterData: resource,
        }));
        const outbox = buildOutboxEvent({
          requestContext,
          aggregateType: `logistics.${resourceType}`,
          aggregateId: resource.id,
          eventType: action,
          payload: resource,
        });
        await insertOutboxEvent(client, outbox);
        return { resource, eventId: outbox.eventId };
      },
    });
    return Object.freeze({ ok: true, [resourceType]: result.resource });
  } catch (error) {
    if (error?.code === '23505') return failure('LOGISTICS_MASTER_DUPLICATE', 'Logistics master code already exists');
    return failure('LOGISTICS_MASTER_TRANSACTION_FAILED', 'Logistics master transaction failed', true);
  }
}

export async function listDeliveryRoutes(adapter, { requestContext, active = null, limit = 200, offset = 0 }) {
  const rows = await repository.listRoutes(adapter, {
    installationId: requestContext.installationId, active, limit, offset,
  });
  return Object.freeze({ ok: true, routes: Object.freeze(rows.map(mapRoute)) });
}

export async function createDeliveryRoute({ adapter, requestContext, payload }) {
  const code = trimText(payload?.code, 64, true)?.toUpperCase();
  const name = trimText(payload?.name, 256, true);
  const defaultWarehouseId = nullableUuid(payload?.defaultWarehouseId);
  if (!code || !name || !defaultWarehouseId) {
    return failure('INVALID_LOGISTICS_ROUTE', 'Route code, name and warehouse are required');
  }
  if (!warehouseAllowed(requestContext, defaultWarehouseId)) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Default warehouse is outside the authorized scope');
  }
  const activeWarehouses = await warehouseRepository.listWarehousesForInstallation(adapter, {
    installationId: requestContext.installationId,
    active: true,
    limit: 10000,
    offset: 0,
  });
  if (!activeWarehouses.some((warehouse) => warehouse.id === defaultWarehouseId)) {
    return failure('DELIVERY_ROUTE_WAREHOUSE_NOT_AVAILABLE', 'Default warehouse is not active');
  }
  return createMaster({
    adapter, requestContext, resourceType: 'delivery_route', payload,
    insert: (client) => repository.insertRoute(client, {
      id: randomUUID(), installationId: requestContext.installationId, code, name,
      description: trimText(payload?.description, 2000), defaultWarehouseId,
      actorId: requestContext.actorId,
    }),
    map: mapRoute,
  });
}

export async function listVehicles(adapter, { requestContext, active = null, limit = 200, offset = 0 }) {
  const rows = await repository.listVehicles(adapter, {
    installationId: requestContext.installationId, active, limit, offset,
  });
  return Object.freeze({ ok: true, vehicles: Object.freeze(rows.map(mapVehicle)) });
}

export async function createVehicle({ adapter, requestContext, payload }) {
  const code = trimText(payload?.code, 64, true)?.toUpperCase();
  const licensePlate = trimText(payload?.licensePlate, 32, true)?.toUpperCase();
  const vehicleType = trimText(payload?.vehicleType, 80, true);
  const capacityWeight = payload?.capacityWeight == null || payload.capacityWeight === ''
    ? null : String(payload.capacityWeight).trim();
  const capacityVolume = payload?.capacityVolume == null || payload.capacityVolume === ''
    ? null : String(payload.capacityVolume).trim();
  if (!code || !licensePlate || !vehicleType
      || (capacityWeight !== null && !DECIMAL_PATTERN.test(capacityWeight))
      || (capacityVolume !== null && !DECIMAL_PATTERN.test(capacityVolume))) {
    return failure('INVALID_VEHICLE', 'Vehicle data is invalid');
  }
  return createMaster({
    adapter, requestContext, resourceType: 'vehicle', payload,
    insert: (client) => repository.insertVehicle(client, {
      id: randomUUID(), installationId: requestContext.installationId, code,
      licensePlate, vehicleType, capacityWeight, capacityVolume,
      actorId: requestContext.actorId,
    }),
    map: mapVehicle,
  });
}

export async function listDriverProfiles(adapter, { requestContext, active = null, limit = 200, offset = 0 }) {
  const rows = await repository.listDrivers(adapter, {
    installationId: requestContext.installationId, active, limit, offset,
  });
  return Object.freeze({ ok: true, drivers: Object.freeze(rows.map(mapDriver)) });
}

export async function createDriverProfile({ adapter, requestContext, payload }) {
  const code = trimText(payload?.code, 64, true)?.toUpperCase();
  const name = trimText(payload?.name, 256, true);
  const employeeId = nullableUuid(payload?.employeeId);
  if (!code || !name || employeeId === undefined) {
    return failure('INVALID_DRIVER_PROFILE', 'Driver profile data is invalid');
  }
  return createMaster({
    adapter, requestContext, resourceType: 'driver_profile', payload,
    insert: (client) => repository.insertDriver(client, {
      id: randomUUID(), installationId: requestContext.installationId, code,
      employeeId, name, phone: trimText(payload?.phone, 32),
      licenseReference: trimText(payload?.licenseReference, 128), actorId: requestContext.actorId,
    }),
    map: mapDriver,
  });
}

export async function listEligibleDeliveryOrders(adapter, { requestContext, warehouseId = null, limit = 500, offset = 0 }) {
  const normalizedWarehouseId = nullableUuid(warehouseId);
  if (normalizedWarehouseId === undefined) return failure('INVALID_WAREHOUSE_ID', 'Warehouse id is invalid');
  if (normalizedWarehouseId && !warehouseAllowed(requestContext, normalizedWarehouseId)) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Warehouse is outside the authorized scope');
  }
  const rows = await repository.listEligibleDeliveryOrders(adapter, {
    installationId: requestContext.installationId,
    warehouseIds: warehouseIds(requestContext),
    warehouseId: normalizedWarehouseId,
    limit,
    offset,
  });
  return Object.freeze({ ok: true, deliveryOrders: Object.freeze(rows.map(mapEligibleDeliveryOrder)) });
}

export async function listDeliveryTrips(adapter, { requestContext, status = null, limit = 200, offset = 0 }) {
  if (status && !TRIP_STATUSES.has(status)) return failure('INVALID_TRIP_STATUS', 'Trip status is invalid');
  const rows = await repository.listTrips(adapter, {
    installationId: requestContext.installationId,
    warehouseIds: warehouseIds(requestContext),
    status,
    limit,
    offset,
  });
  return Object.freeze({ ok: true, trips: Object.freeze(rows.map((row) => mapTrip(row)))});
}

export async function getDeliveryTrip(adapter, { requestContext, tripId }) {
  if (!UUID_PATTERN.test(String(tripId ?? ''))) return failure('INVALID_TRIP_ID', 'Trip id is invalid');
  return loadTripDetail(adapter, { requestContext, tripId });
}

function businessDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

export async function createDeliveryTrip({ adapter, requestContext, payload, idempotencyKey }) {
  const warehouseId = nullableUuid(payload?.warehouseId);
  const deliveryRouteId = nullableUuid(payload?.deliveryRouteId);
  const vehicleId = nullableUuid(payload?.vehicleId);
  const primaryDriverId = nullableUuid(payload?.primaryDriverId);
  const plannedStartAt = payload?.plannedStartAt ? new Date(payload.plannedStartAt) : null;
  if (warehouseId === undefined || deliveryRouteId === undefined || vehicleId === undefined || primaryDriverId === undefined
      || !warehouseId || (plannedStartAt && Number.isNaN(plannedStartAt.getTime()))) {
    return failure('INVALID_DELIVERY_TRIP', 'Trip payload is invalid');
  }
  if (!warehouseAllowed(requestContext, warehouseId)) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Warehouse is outside the authorized scope');
  }
  const normalized = {
    warehouseId, deliveryRouteId, vehicleId, primaryDriverId,
    plannedStartAt: plannedStartAt?.toISOString() ?? null,
    note: trimText(payload?.note, 4000),
  };
  const hash = payloadHash(normalized);
  try {
    const transaction = await withAuditOutboxTransaction({
      adapter,
      mutate: async (client) => {
        const replay = await repository.findTripByCreateKey(client, {
          installationId: requestContext.installationId, idempotencyKey, forUpdate: true,
        });
        if (replay) {
          if (replay.create_payload_hash !== hash) {
            return { failed: true, result: failure('IDEMPOTENCY_PAYLOAD_MISMATCH', 'Idempotency key was used with another payload') };
          }
          if (!warehouseAllowed(requestContext, replay.warehouse_id)) {
            return { failed: true, result: failure('WAREHOUSE_SCOPE_DENIED', 'Trip is outside the authorized scope') };
          }
          const detail = await loadTripDetail(client, { requestContext, tripId: replay.id });
          return { ...detail, replayed: true, skipAudit: true };
        }
        const routeValidation = await validateRouteWarehouse(client, {
          requestContext,
          deliveryRouteId: normalized.deliveryRouteId,
          warehouseId: normalized.warehouseId,
        });
        if (!routeValidation.ok) return { failed: true, result: routeValidation };
        await setWriteContext(client);
        const date = businessDate(normalized.plannedStartAt);
        const sequence = await repository.allocateTripNumber(client, {
          installationId: requestContext.installationId, businessDate: date,
        });
        const tripNumber = `TRP-${date.replaceAll('-', '')}-${String(sequence).padStart(5, '0')}`;
        const row = await repository.insertTrip(client, {
          id: randomUUID(), installationId: requestContext.installationId, tripNumber,
          ...normalized, idempotencyKey, payloadHash: hash, actorId: requestContext.actorId,
        });
        await repository.insertTripEvent(client, {
          id: randomUUID(), installationId: requestContext.installationId, tripId: row.id,
          eventType: 'CREATED', idempotencyKey, payloadHash: hash,
          actorId: requestContext.actorId, requestId: requestContext.requestId,
          sourceApp: requestContext.sourceApp, reason: null, metadata: { warehouseId },
        });
        const detail = await loadTripDetail(client, { requestContext, tripId: row.id });
        const eventId = await writeTripAuditOutbox(client, {
          requestContext, eventType: 'CREATED', trip: detail.trip,
        });
        return { ...detail, eventId };
      },
    });
    if (transaction.failed) return transaction.result;
    return Object.freeze({ ok: true, trip: transaction.trip, replayed: Boolean(transaction.replayed) });
  } catch (error) {
    if (error?.constraint === 'delivery_trips_create_idempotency_unique') {
      const replay = await repository.findTripByCreateKey(adapter, {
        installationId: requestContext.installationId, idempotencyKey,
      });
      if (replay && replay.create_payload_hash === hash && warehouseAllowed(requestContext, replay.warehouse_id)) {
        const detail = await loadTripDetail(adapter, { requestContext, tripId: replay.id });
        return Object.freeze({ ok: true, trip: detail.trip, replayed: true });
      }
    }
    return failure('DELIVERY_TRIP_TRANSACTION_FAILED', 'Delivery trip transaction failed', true);
  }
}

async function mutateTrip({
  adapter,
  requestContext,
  tripId,
  payload,
  idempotencyKey,
  operationType,
  eventType,
  reason = null,
  allowedStatuses = ['draft'],
  mutate,
}) {
  if (!UUID_PATTERN.test(String(tripId ?? ''))) return failure('INVALID_TRIP_ID', 'Trip id is invalid');
  const hash = payloadHash({ tripId, operationType, payload });
  try {
    const transaction = await withAuditOutboxTransaction({
      adapter,
      mutate: async (client) => {
        let replay = await repository.findOperationReplay(client, {
          installationId: requestContext.installationId, idempotencyKey, forUpdate: true,
        });
        if (replay) {
          if (replay.operation_type !== operationType || replay.payload_hash !== hash || replay.trip_id !== tripId) {
            return { failed: true, result: failure('IDEMPOTENCY_PAYLOAD_MISMATCH', 'Idempotency key was used with another operation') };
          }
          const detail = await loadTripDetail(client, { requestContext, tripId });
          return { ...detail, replayed: true, skipAudit: true };
        }
        const before = await loadTripDetail(client, { requestContext, tripId, forUpdate: true });
        if (!before.ok) return { failed: true, result: before };
        replay = await repository.findOperationReplay(client, {
          installationId: requestContext.installationId, idempotencyKey, forUpdate: true,
        });
        if (replay) {
          if (replay.operation_type !== operationType || replay.payload_hash !== hash || replay.trip_id !== tripId) {
            return { failed: true, result: failure('IDEMPOTENCY_PAYLOAD_MISMATCH', 'Idempotency key was used with another operation') };
          }
          const detail = await loadTripDetail(client, { requestContext, tripId });
          return { ...detail, replayed: true, skipAudit: true };
        }
        if (Array.isArray(allowedStatuses) && !allowedStatuses.includes(before.trip.status)) {
          if (before.trip.status === 'locked') {
            return { failed: true, result: failure('DELIVERY_TRIP_LOCKED', 'Locked trip cannot be changed') };
          }
          return { failed: true, result: failure('DELIVERY_TRIP_NOT_EDITABLE', 'Planned trip is read-only; reopen it before making changes') };
        }
        await setWriteContext(client);
        const mutation = await mutate(client, before.trip);
        if (!mutation.ok) return { failed: true, result: mutation };
        await repository.insertTripEvent(client, {
          id: randomUUID(), installationId: requestContext.installationId, tripId,
          eventType, idempotencyKey, payloadHash: hash,
          actorId: requestContext.actorId, requestId: requestContext.requestId,
          sourceApp: requestContext.sourceApp, reason, metadata: mutation.metadata ?? {},
        });
        const detail = await loadTripDetail(client, { requestContext, tripId });
        if (!detail.ok) return { failed: true, result: detail };
        const eventId = await writeTripAuditOutbox(client, {
          requestContext, eventType, trip: detail.trip, beforeData: before.trip,
          metadata: mutation.metadata ?? {},
        });
        await repository.insertOperationReplay(client, {
          id: randomUUID(), installationId: requestContext.installationId,
          operationType, idempotencyKey, payloadHash: hash, tripId,
          responseSnapshot: { tripId, revision: detail.trip.revision, eventType },
          actorId: requestContext.actorId,
        });
        return { ...detail, eventId };
      },
    });
    if (transaction.failed) return transaction.result;
    return Object.freeze({ ok: true, trip: transaction.trip, replayed: Boolean(transaction.replayed) });
  } catch (error) {
    if (error?.code === '23505') return failure('DELIVERY_ORDER_ALREADY_ASSIGNED', 'Delivery Order already has an active trip assignment');
    if (String(error?.message ?? '').includes('logistics_trip_locked')) return failure('DELIVERY_TRIP_LOCKED', 'Locked trip cannot be changed');
    return failure('DELIVERY_TRIP_TRANSACTION_FAILED', 'Delivery trip transaction failed', true);
  }
}

export function updateDeliveryTrip(args) {
  const routeId = nullableUuid(args.payload?.deliveryRouteId);
  const vehicleId = nullableUuid(args.payload?.vehicleId);
  const driverId = nullableUuid(args.payload?.primaryDriverId);
  const start = args.payload?.plannedStartAt ? new Date(args.payload.plannedStartAt) : null;
  if (routeId === undefined || vehicleId === undefined || driverId === undefined || (start && Number.isNaN(start.getTime()))) {
    return Promise.resolve(failure('INVALID_DELIVERY_TRIP', 'Trip planning data is invalid'));
  }
  const normalized = {
    deliveryRouteId: routeId, vehicleId, primaryDriverId: driverId,
    plannedStartAt: start?.toISOString() ?? null,
    note: trimText(args.payload?.note, 4000),
  };
  return mutateTrip({
    ...args, payload: normalized, operationType: 'UPDATE', eventType: 'UPDATED',
    mutate: async (client, trip) => {
      const routeValidation = await validateRouteWarehouse(client, {
        requestContext: args.requestContext,
        deliveryRouteId: normalized.deliveryRouteId,
        warehouseId: trip.warehouseId,
      });
      if (!routeValidation.ok) return routeValidation;
      const row = await repository.updateTripPlan(client, {
        installationId: args.requestContext.installationId, tripId: args.tripId,
        ...normalized, actorId: args.requestContext.actorId,
      });
      return row ? { ok: true } : failure('DELIVERY_TRIP_NOT_EDITABLE', 'Trip cannot be edited in its current state');
    },
  });
}

export function assignDeliveryOrder(args) {
  const deliveryOrderId = nullableUuid(args.payload?.deliveryOrderId);
  const plannedArrivalAt = args.payload?.plannedArrivalAt ? new Date(args.payload.plannedArrivalAt) : null;
  if (!deliveryOrderId || deliveryOrderId === undefined || (plannedArrivalAt && Number.isNaN(plannedArrivalAt.getTime()))) {
    return Promise.resolve(failure('INVALID_DELIVERY_ORDER_ID', 'Delivery Order id is invalid'));
  }
  const normalized = { deliveryOrderId, plannedArrivalAt: plannedArrivalAt?.toISOString() ?? null };
  return mutateTrip({
    ...args, payload: normalized, operationType: 'ASSIGN', eventType: 'ASSIGNED',
    mutate: async (client, trip) => {
      const deliveryOrder = await repository.getDeliveryOrderForAssignment(client, {
        installationId: args.requestContext.installationId, deliveryOrderId,
      });
      if (!deliveryOrder) return failure('DELIVERY_ORDER_NOT_FOUND', 'Delivery Order was not found');
      if (deliveryOrder.status !== 'ready_to_dispatch' || deliveryOrder.handover_mode !== 'DELIVERY') {
        return failure('DELIVERY_ORDER_NOT_ELIGIBLE', 'Delivery Order is not ready for trip planning');
      }
      if (deliveryOrder.warehouse_id !== trip.warehouseId) {
        return failure('DELIVERY_ORDER_WAREHOUSE_MISMATCH', 'Delivery Order belongs to another warehouse');
      }
      const active = await repository.findActiveAssignment(client, {
        installationId: args.requestContext.installationId, deliveryOrderId, forUpdate: true,
      });
      if (active) return failure('DELIVERY_ORDER_ALREADY_ASSIGNED', 'Delivery Order already has an active trip assignment');
      let stop = await repository.findStop(client, {
        installationId: args.requestContext.installationId,
        tripId: args.tripId,
        customerId: deliveryOrder.customer_id,
        customerAddressId: deliveryOrder.customer_address_id,
      });
      if (!stop) {
        const stopSequence = await repository.nextStopSequence(client, {
          installationId: args.requestContext.installationId, tripId: args.tripId,
        });
        stop = await repository.insertStop(client, {
          id: randomUUID(), installationId: args.requestContext.installationId,
          tripId: args.tripId, stopSequence,
          customerId: deliveryOrder.customer_id,
          customerAddressId: deliveryOrder.customer_address_id,
          addressSnapshot: deliveryOrder.destination_snapshot,
          plannedArrivalAt: normalized.plannedArrivalAt,
          actorId: args.requestContext.actorId,
        });
      }
      await repository.insertAssignment(client, {
        id: randomUUID(), installationId: args.requestContext.installationId,
        tripId: args.tripId, tripStopId: stop.id, deliveryOrderId,
        actorId: args.requestContext.actorId,
      });
      return { ok: true, metadata: { deliveryOrderId, stopId: stop.id } };
    },
  });
}

export function unassignDeliveryOrder(args) {
  const deliveryOrderId = nullableUuid(args.payload?.deliveryOrderId);
  const reason = trimText(args.payload?.reason, 1000, true);
  if (!deliveryOrderId || deliveryOrderId === undefined || !reason) {
    return Promise.resolve(failure('INVALID_UNASSIGNMENT', 'Delivery Order and reason are required'));
  }
  const normalized = { deliveryOrderId, reason };
  return mutateTrip({
    ...args, payload: normalized, operationType: 'UNASSIGN', eventType: 'UNASSIGNED', reason,
    mutate: async (client) => {
      const assignment = await repository.unassignDeliveryOrder(client, {
        installationId: args.requestContext.installationId, tripId: args.tripId,
        deliveryOrderId, actorId: args.requestContext.actorId, reason,
      });
      if (!assignment) return failure('TRIP_ASSIGNMENT_NOT_FOUND', 'Active trip assignment was not found');
      await repository.deleteUnreferencedStop(client, {
        installationId: args.requestContext.installationId, stopId: assignment.trip_stop_id,
      });
      return { ok: true, metadata: { deliveryOrderId, stopId: assignment.trip_stop_id } };
    },
  });
}

export function reorderTripStops(args) {
  const stopIds = Array.isArray(args.payload?.stopIds) ? args.payload.stopIds : [];
  if (stopIds.length === 0 || stopIds.some((id) => !UUID_PATTERN.test(String(id)))) {
    return Promise.resolve(failure('INVALID_STOP_ORDER', 'Stop order is invalid'));
  }
  const unique = [...new Set(stopIds)];
  if (unique.length !== stopIds.length) return Promise.resolve(failure('INVALID_STOP_ORDER', 'Stop order contains duplicates'));
  return mutateTrip({
    ...args, payload: { stopIds: unique }, operationType: 'REORDER', eventType: 'REORDERED',
    mutate: async (client) => {
      const current = await repository.listTripStops(client, {
        installationId: args.requestContext.installationId, tripId: args.tripId,
      });
      const currentIds = current.map((stop) => stop.id).sort();
      if (currentIds.length !== unique.length || currentIds.some((id, index) => id !== [...unique].sort()[index])) {
        return failure('STOP_ORDER_MISMATCH', 'Stop order must contain every current stop exactly once');
      }
      await repository.reorderStops(client, {
        installationId: args.requestContext.installationId, tripId: args.tripId,
        stopIds: unique, actorId: args.requestContext.actorId,
      });
      return { ok: true, metadata: { stopIds: unique } };
    },
  });
}

function transition(args, expectedStatus, nextStatus, eventType, reason = null) {
  return mutateTrip({
    ...args,
    payload: { expectedStatus, nextStatus, reason },
    operationType: eventType,
    eventType,
    reason,
    allowedStatuses: null,
    mutate: async (client, trip) => {
      if (trip.status !== expectedStatus) {
        return failure('INVALID_TRIP_STATUS_TRANSITION', `Trip must be ${expectedStatus} before ${nextStatus}`);
      }
      const row = await repository.transitionTrip(client, {
        installationId: args.requestContext.installationId,
        tripId: args.tripId,
        expectedStatus,
        nextStatus,
        reason,
        actorId: args.requestContext.actorId,
      });
      return row ? { ok: true } : failure('INVALID_TRIP_STATUS_TRANSITION', 'Trip status changed concurrently');
    },
  });
}

export function planDeliveryTrip(args) {
  return transition(args, 'draft', 'planned', 'PLANNED');
}

export function reopenDeliveryTrip(args) {
  const reason = trimText(args.payload?.reason, 1000, true);
  if (!reason) return Promise.resolve(failure('REOPEN_REASON_REQUIRED', 'Reopen reason is required'));
  return transition(args, 'planned', 'draft', 'REOPENED', reason);
}

export function lockDeliveryTrip(args) {
  return transition(args, 'planned', 'locked', 'LOCKED');
}

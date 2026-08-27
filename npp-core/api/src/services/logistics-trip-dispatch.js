import { createHash, randomUUID } from 'node:crypto';
import { IDEMPOTENCY_KEY_PATTERN } from '@npp/contracts';
import {
  buildAuditRecord,
  buildOutboxEvent,
  insertAuditRecord,
  insertOutboxEvent,
} from '../audit-outbox.js';
import { deriveIdempotencyKey } from '../idempotency-derived.js';
import * as dispatchRepository from '../db/repositories/logistics-trip-dispatch.js';
import * as tripRepository from '../db/repositories/logistics-trip-planning.js';
import * as deliveryOrderRepository from '../db/repositories/sales-delivery-orders.js';
import * as issueRepository from '../db/repositories/sales-delivery-inventory.js';
import { postServerOwnedSalesMovement } from './sales-inventory-ledger.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const QUANTITY_PATTERN = /^(0|[1-9]\d{0,17})(?:\.(\d{1,12}))?$/;
const SCALE = 1_000_000_000_000n;
const LOGISTICS_DISPATCH = 'LOGISTICS_DISPATCH';

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

function text(value, maxLength, required = false) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  if (!normalized || normalized.length > maxLength) return required ? null : null;
  return normalized;
}

function strictTimestamp(value) {
  const normalized = text(value, 64, true);
  if (!normalized) return null;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function timestampDateOnly(value, timeZone = 'Asia/Ho_Chi_Minh') {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(parsed);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return year && month && day ? `${year}-${month}-${day}` : null;
}

function grantedPermissions(requestContext) {
  return new Set([
    ...(Array.isArray(requestContext?.permissions) ? requestContext.permissions : []),
    ...(Array.isArray(requestContext?.grantedPermissions) ? requestContext.grantedPermissions : []),
  ]);
}

function warehouseAllowed(requestContext, warehouseId) {
  return Array.isArray(requestContext?.scopes?.warehouseIds)
    && requestContext.scopes.warehouseIds.includes(warehouseId);
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

function mapDispatchItem(row) {
  return Object.freeze({
    id: row.id,
    dispatchId: row.dispatch_id,
    assignmentId: row.assignment_id,
    stopId: row.trip_stop_id,
    deliveryOrderId: row.delivery_order_id,
    deliveryOrderNumber: row.delivery_order_number ?? null,
    customerCode: row.customer_code_snapshot ?? null,
    customerName: row.customer_name_snapshot ?? null,
    inventoryIssueId: row.inventory_issue_id,
    inventoryIssueStatus: row.inventory_issue_status ?? null,
    inventoryMovementId: row.inventory_movement_id,
    movementType: row.movement_type ?? null,
    documentDate: row.document_date ? String(row.document_date).slice(0, 10) : null,
    postedAt: row.posted_at,
  });
}

function mapTrip(row, stops, events, dispatchItems) {
  return Object.freeze({
    id: row.id,
    number: row.trip_number,
    warehouseId: row.warehouse_id,
    warehouseCode: row.warehouse_code ?? null,
    warehouseName: row.warehouse_name ?? null,
    deliveryRouteId: row.delivery_route_id ?? null,
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
    lockedAt: row.locked_at ?? null,
    lockedBy: row.locked_by ?? null,
    dispatchId: row.dispatch_id ?? null,
    handoverReceiverName: row.handover_receiver_name ?? null,
    handoverNote: row.handover_note ?? null,
    dispatchedAt: row.dispatched_at ?? null,
    dispatchedBy: row.dispatched_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    stops: Object.freeze(stops.map(mapStop)),
    events: Object.freeze(events.map(mapEvent)),
    dispatchItems: Object.freeze(dispatchItems.map(mapDispatchItem)),
  });
}

async function loadDispatchDetail(client, { requestContext, tripId }) {
  const trip = await tripRepository.getTrip(client, {
    installationId: requestContext.installationId,
    tripId,
  });
  if (!trip) return failure('DELIVERY_TRIP_NOT_FOUND', 'Delivery trip was not found');
  if (!warehouseAllowed(requestContext, trip.warehouse_id)) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Delivery trip is outside the authorized warehouse scope');
  }
  const [stops, events, dispatchItems] = await Promise.all([
    tripRepository.listTripStops(client, { installationId: requestContext.installationId, tripId }),
    tripRepository.listTripEvents(client, { installationId: requestContext.installationId, tripId }),
    dispatchRepository.listDispatchItems(client, { installationId: requestContext.installationId, tripId }),
  ]);
  return Object.freeze({ ok: true, trip: mapTrip(trip, stops, events, dispatchItems) });
}

function issueKeyFor(idempotencyKey, deliveryOrderId) {
  return deriveIdempotencyKey(
    'trip-dispatch-issue',
    payloadHash({ idempotencyKey, deliveryOrderId }),
  );
}

function issueSnapshot({ issueId, assignment, dispatchId, movementResult, dispatchedAt, receiverName, issueLines }) {
  return Object.freeze({
    id: issueId,
    deliveryOrderId: assignment.delivery_order_id,
    deliveryOrderNumber: assignment.delivery_order_number,
    salesOrderId: assignment.sales_order_id,
    customerId: assignment.customer_id,
    warehouseId: assignment.warehouse_id,
    handoverMode: assignment.handover_mode,
    deliveryOrderStatus: 'dispatched',
    issueSourceType: LOGISTICS_DISPATCH,
    issueSourceId: dispatchId,
    status: 'POSTED',
    inventoryMovementId: movementResult.movement.id,
    receiverName,
    postedAt: dispatchedAt,
    lines: Object.freeze(issueLines.map(({ issueLine, source, movementLine }) => Object.freeze({
      id: issueLine.id,
      deliveryOrderLineId: source.id,
      fulfillmentDemandId: source.fulfillment_demand_id,
      fulfillmentAllocationId: source.fulfillment_allocation_id,
      inventoryReservationId: source.inventory_reservation_id,
      inventoryMovementLineId: movementLine.id,
      warehouseId: source.warehouse_id,
      locationId: source.location_id ?? null,
      baseVariantId: source.base_variant_id,
      lotId: source.lot_id ?? null,
      sku: source.sku_snapshot,
      itemName: source.item_name_snapshot,
      unitCode: source.unit_code_snapshot,
      issuedBaseQuantity: String(source.delivery_base_quantity),
    }))),
  });
}

async function issueDeliveryOrderInTransaction(client, {
  requestContext,
  trip,
  assignment,
  dispatchId,
  idempotencyKey,
  dispatchedAt,
  handoverReceiverName,
  handoverNote,
}) {
  const deliveryOrderId = assignment.delivery_order_id;
  const issueIdempotencyKey = issueKeyFor(idempotencyKey, deliveryOrderId);
  const canonicalPayload = Object.freeze({
    deliveryOrderId,
    issueSourceType: LOGISTICS_DISPATCH,
    issueSourceId: dispatchId,
    occurredAt: dispatchedAt,
    receiverName: handoverReceiverName,
    receiverNote: handoverNote,
  });
  const hash = payloadHash(canonicalPayload);

  await issueRepository.lockOperationKey(client, {
    installationId: requestContext.installationId,
    operation: 'issue',
    idempotencyKey: issueIdempotencyKey,
  });
  const existing = await issueRepository.getIssueByIdempotencyKey(client, {
    installationId: requestContext.installationId,
    idempotencyKey: issueIdempotencyKey,
  });
  if (existing) {
    return failure('DELIVERY_ORDER_ALREADY_ISSUED', 'Delivery Order already has an inventory issue');
  }

  const header = await issueRepository.getDeliveryOrderIssueSource(client, {
    installationId: requestContext.installationId,
    deliveryOrderId,
    forUpdate: true,
  });
  if (!header) return failure('DELIVERY_ORDER_NOT_FOUND', 'Delivery Order was not found');
  if (header.warehouse_id !== trip.warehouse_id || !warehouseAllowed(requestContext, header.warehouse_id)) {
    return failure('DELIVERY_ORDER_WAREHOUSE_MISMATCH', 'Delivery Order belongs to another warehouse');
  }
  if (header.status !== 'ready_to_dispatch' || header.sales_order_status !== 'confirmed') {
    return failure('DELIVERY_ORDER_NOT_READY', 'Delivery Order is no longer ready for dispatch');
  }
  if (header.handover_mode !== 'DELIVERY' || header.sales_order_delivery_mode !== 'DELIVERY') {
    return failure('DELIVERY_ORDER_MODE_MISMATCH', 'Delivery Order is not a delivery handover');
  }
  if (!header.delivery_order_number) {
    return failure('DELIVERY_ORDER_NUMBER_REQUIRED', 'Delivery Order must have an official number');
  }
  if (await issueRepository.getActiveIssueForDeliveryOrder(client, {
    installationId: requestContext.installationId,
    deliveryOrderId,
    forUpdate: true,
  })) {
    return failure('DELIVERY_ORDER_ALREADY_ISSUED', 'Delivery Order already has an active inventory issue');
  }

  const sourceLines = await issueRepository.listDeliveryOrderIssueSourceLines(client, {
    installationId: requestContext.installationId,
    deliveryOrderId,
  });
  if (sourceLines.length === 0) return failure('DELIVERY_ORDER_LINES_REQUIRED', 'Delivery Order has no source lines');
  for (const line of sourceLines) {
    const quantity = parseQuantity(line.delivery_base_quantity);
    const reservationQuantity = parseQuantity(line.reservation_quantity);
    const consumedQuantity = parseQuantity(line.reservation_consumed_quantity);
    if (quantity === null || reservationQuantity === null || consumedQuantity === null
      || quantity <= 0n || consumedQuantity + quantity > reservationQuantity
      || !['ACTIVE', 'CONSUMED'].includes(line.reservation_state)
      || line.demand_state !== 'ACTIVE') {
      return failure(
        'DELIVERY_ORDER_LINE_NOT_ISSUABLE',
        'One or more Delivery Order lines no longer have valid packed reservation quantity',
        true,
        { deliveryOrderLineId: line.id },
      );
    }
  }

  const issueId = randomUUID();
  await issueRepository.insertIssue(client, {
    id: issueId,
    installationId: requestContext.installationId,
    deliveryOrderId,
    issueSourceType: LOGISTICS_DISPATCH,
    issueSourceId: dispatchId,
    receiverName: handoverReceiverName,
    receiverNote: handoverNote,
    idempotencyKey: issueIdempotencyKey,
    payloadHash: hash,
    actorId: requestContext.actorId,
  });

  const issueLines = [];
  for (let index = 0; index < sourceLines.length; index += 1) {
    const source = sourceLines[index];
    const issueLine = await issueRepository.insertIssueLine(client, {
      id: randomUUID(),
      installationId: requestContext.installationId,
      issueId,
      deliveryOrderId,
      deliveryOrderLineId: source.id,
      fulfillmentDemandId: source.fulfillment_demand_id,
      fulfillmentAllocationId: source.fulfillment_allocation_id,
      inventoryReservationId: source.inventory_reservation_id,
      warehouseId: source.warehouse_id,
      locationId: source.location_id,
      baseVariantId: source.base_variant_id,
      lotId: source.lot_id,
      quantity: String(source.delivery_base_quantity),
      actorId: requestContext.actorId,
    });
    issueLines.push({ issueLine, source, movementLine: null });
    const adjustmentPayload = {
      adjustmentType: 'CONSUME',
      reservationId: source.inventory_reservation_id,
      quantity: String(source.delivery_base_quantity),
      deliveryOrderId,
      deliveryOrderLineId: source.id,
      issueId,
      issueLineId: issueLine.id,
      dispatchId,
      tripId: trip.id,
    };
    await issueRepository.insertReservationAdjustment(client, {
      installationId: requestContext.installationId,
      reservationId: source.inventory_reservation_id,
      adjustmentType: 'CONSUME',
      quantity: String(source.delivery_base_quantity),
      sourceDocumentType: 'DELIVERY_ORDER',
      sourceDocumentId: deliveryOrderId,
      sourceLineId: issueLine.id,
      idempotencyKey: deriveIdempotencyKey(
        'trip-dispatch-consume',
        `${issueIdempotencyKey}.${index + 1}`,
      ),
      payloadHash: payloadHash(adjustmentPayload),
      actorId: requestContext.actorId,
      requestId: requestContext.requestId,
      sourceApp: requestContext.sourceApp,
      metadata: adjustmentPayload,
      occurredAt: dispatchedAt,
    });
  }

  const movementContext = Object.freeze({ ...requestContext, receivedAt: dispatchedAt });
  const movementResult = await postServerOwnedSalesMovement(client, {
    requestContext: movementContext,
    idempotencyKey: deriveIdempotencyKey('delivery-issue-movement', issueIdempotencyKey),
    payload: {
      movementType: 'SALES_DELIVERY_ISSUE',
      direction: 'OUT',
      sourceDocumentType: 'DELIVERY_ORDER',
      sourceDocumentId: deliveryOrderId,
      sourceDocumentNumber: header.delivery_order_number,
      documentDate: timestampDateOnly(dispatchedAt),
      reasonCode: 'DELIVERY_DISPATCH',
      reasonNote: `Xuất kho theo chuyến ${trip.trip_number}`,
      metadata: {
        deliveryOrderId,
        salesOrderId: header.sales_order_id,
        issueId,
        issueSourceType: LOGISTICS_DISPATCH,
        issueSourceId: dispatchId,
        tripId: trip.id,
        tripNumber: trip.trip_number,
      },
      lines: issueLines.map(({ issueLine, source }) => ({
        sourceLineId: issueLine.id,
        warehouseId: source.warehouse_id,
        locationId: source.location_id,
        baseVariantId: source.base_variant_id,
        baseSku: source.base_sku,
        baseUnitId: source.base_unit_id,
        baseUnitCode: source.base_unit_code,
        lotId: source.lot_id,
        lotCode: source.lot_code,
        expiryDate: source.expiry_date,
        quantity: String(source.delivery_base_quantity),
        metadata: {
          issueId,
          issueLineId: issueLine.id,
          deliveryOrderId,
          deliveryOrderLineId: source.id,
          salesOrderId: source.sales_order_id,
          salesOrderLineId: source.sales_order_line_id,
          fulfillmentDemandId: source.fulfillment_demand_id,
          fulfillmentAllocationId: source.fulfillment_allocation_id,
          inventoryReservationId: source.inventory_reservation_id,
          dispatchId,
          tripId: trip.id,
        },
      })),
    },
  });
  if (!movementResult.ok) return movementResult;
  if (movementResult.lines.length !== issueLines.length) {
    return failure('INVENTORY_MOVEMENT_LINE_MISMATCH', 'Inventory movement line count is invalid');
  }
  for (let index = 0; index < issueLines.length; index += 1) {
    issueLines[index].movementLine = movementResult.lines[index];
    if (!await issueRepository.attachMovementLineToIssueLine(client, {
      installationId: requestContext.installationId,
      issueLineId: issueLines[index].issueLine.id,
      movementLineId: movementResult.lines[index].id,
    })) {
      return failure('INVENTORY_MOVEMENT_LINE_MISMATCH', 'Inventory movement line could not be linked');
    }
  }
  if (!await issueRepository.finalizeIssue(client, {
    installationId: requestContext.installationId,
    issueId,
    movementId: movementResult.movement.id,
    actorId: requestContext.actorId,
    postedAt: dispatchedAt,
  })) {
    return failure('DELIVERY_ISSUE_CONFLICT', 'Delivery issue changed concurrently', true);
  }
  if (!await issueRepository.updateDeliveryOrderIssueStatus(client, {
    installationId: requestContext.installationId,
    deliveryOrderId,
    status: 'dispatched',
    actorId: requestContext.actorId,
  })) {
    return failure('DELIVERY_ORDER_TRANSITION_CONFLICT', 'Delivery Order changed concurrently', true);
  }

  const demandIds = [...new Set(sourceLines.map((line) => line.fulfillment_demand_id))];
  await issueRepository.refreshFulfillmentIssuedProjection(client, {
    installationId: requestContext.installationId,
    demandIds,
    actorId: requestContext.actorId,
  });
  await issueRepository.refreshSalesOrderFulfillmentStatus(client, {
    installationId: requestContext.installationId,
    salesOrderId: header.sales_order_id,
    actorId: requestContext.actorId,
  });
  await issueRepository.refreshSalesOrderDeliveryStatus(client, {
    installationId: requestContext.installationId,
    salesOrderId: header.sales_order_id,
    actorId: requestContext.actorId,
  });
  await deliveryOrderRepository.insertDeliveryOrderEvent(client, {
    installationId: requestContext.installationId,
    deliveryOrderId,
    eventType: 'INVENTORY_ISSUED',
    idempotencyKey: issueIdempotencyKey,
    payloadHash: hash,
    actorId: requestContext.actorId,
    requestId: requestContext.requestId,
    sourceApp: requestContext.sourceApp,
    metadata: {
      issueId,
      inventoryMovementId: movementResult.movement.id,
      issueSourceType: LOGISTICS_DISPATCH,
      issueSourceId: dispatchId,
      tripId: trip.id,
      tripNumber: trip.trip_number,
    },
    occurredAt: dispatchedAt,
  });

  const snapshot = issueSnapshot({
    issueId,
    assignment,
    dispatchId,
    movementResult,
    dispatchedAt,
    receiverName: handoverReceiverName,
    issueLines,
  });
  await insertAuditRecord(client, buildAuditRecord({
    requestContext,
    action: 'sales.delivery_order.inventory_issue',
    resourceType: 'delivery_order_inventory_issue',
    resourceId: issueId,
    afterData: snapshot,
    metadata: {
      deliveryOrderId,
      inventoryMovementId: movementResult.movement.id,
      warehouseId: header.warehouse_id,
      tripId: trip.id,
      dispatchId,
    },
    occurredAt: dispatchedAt,
  }));
  await insertOutboxEvent(client, buildOutboxEvent({
    requestContext,
    aggregateType: 'sales.delivery_order',
    aggregateId: deliveryOrderId,
    eventType: 'core.sales.delivery_order.inventory_issued',
    eventVersion: 1,
    payload: snapshot,
    metadata: {
      inventoryMovementId: movementResult.movement.id,
      warehouseId: header.warehouse_id,
      tripId: trip.id,
      dispatchId,
    },
    createdAt: dispatchedAt,
    availableAt: dispatchedAt,
  }));

  return Object.freeze({
    ok: true,
    deliveryOrderId,
    inventoryIssueId: issueId,
    inventoryMovementId: movementResult.movement.id,
    issue: snapshot,
  });
}

function knownDatabaseFailure(error) {
  const message = String(error?.message ?? '');
  const mappings = [
    ['delivery_trips_dispatch_idempotency_unique', 'IDEMPOTENCY_PAYLOAD_MISMATCH', 'Dispatch key was used by another trip'],
    ['trip_dispatch_items_delivery_order_unique', 'DELIVERY_ORDER_ALREADY_DISPATCHED', 'Delivery Order already belongs to a posted trip dispatch'],
    ['delivery_order_inventory_issues_one_active_idx', 'DELIVERY_ORDER_ALREADY_ISSUED', 'Delivery Order already has an active inventory issue'],
    ['delivery_issue_exceeds_delivery_order_line', 'DELIVERY_ISSUE_QUANTITY_CONFLICT', 'Inventory issue exceeds the Delivery Order line quantity'],
    ['inventory_reservation_issue_exceeds_remaining', 'RESERVATION_QUANTITY_CONFLICT', 'Exact reservation does not have enough remaining quantity'],
    ['inventory_reservation_balance_mismatch', 'RESERVATION_BALANCE_CONFLICT', 'Reservation and inventory balance are inconsistent'],
    ['inventory_negative_stock_denied', 'INSUFFICIENT_INVENTORY', 'Inventory is insufficient for this dispatch'],
    ['logistics_trip_dispatch_reconciliation_mismatch', 'TRIP_DISPATCH_RECONCILIATION_FAILED', 'Trip dispatch does not reconcile with its assignments'],
    ['logistics_vehicle_not_available', 'LOGISTICS_VEHICLE_NOT_AVAILABLE', 'Vehicle is not available for dispatch'],
    ['logistics_driver_not_available', 'LOGISTICS_DRIVER_NOT_AVAILABLE', 'Driver is not available for dispatch'],
  ];
  for (const [needle, code, messageText] of mappings) {
    if (message.includes(needle) || error?.constraint === needle) {
      return failure(code, messageText, code.includes('CONFLICT') || code.includes('INSUFFICIENT'));
    }
  }
  return null;
}

function sanitizedTransactionError(error, requestId) {
  return Object.freeze({
    event: 'logistics_trip_dispatch_failed',
    requestId,
    name: typeof error?.name === 'string' ? error.name.slice(0, 80) : 'Error',
    code: typeof error?.code === 'string' ? error.code.slice(0, 80) : null,
    constraint: typeof error?.constraint === 'string' ? error.constraint.slice(0, 160) : null,
    message: String(error?.message ?? 'transaction_failed')
      .replace(/(?:postgres(?:ql)?|https?):\/\/\S+/gi, '[redacted-url]')
      .replace(/(?:password|token|secret|api[_-]?key)\s*[=:]\s*\S+/gi, '$1=[redacted]')
      .replace(/[\r\n\t]+/g, ' ')
      .slice(0, 240),
  });
}

export async function dispatchDeliveryTrip({
  adapter,
  requestContext,
  tripId,
  idempotencyKey,
  payload,
}) {
  if (!UUID_PATTERN.test(String(tripId ?? ''))) return failure('INVALID_TRIP_ID', 'Trip id is invalid');
  if (!IDEMPOTENCY_KEY_PATTERN.test(String(idempotencyKey ?? ''))) {
    return failure('INVALID_IDEMPOTENCY_KEY', 'Idempotency key must use the canonical safe-character contract');
  }
  const permissions = grantedPermissions(requestContext);
  if (!permissions.has('core.delivery-trip.dispatch')) {
    return failure('PERMISSION_DENIED', 'Permission core.delivery-trip.dispatch is required');
  }
  if (!permissions.has('core.delivery-order.issue-inventory')) {
    return failure('PERMISSION_DENIED', 'Internal inventory issue capability is required');
  }
  const dispatchedAt = strictTimestamp(payload?.dispatchedAt);
  const handoverReceiverName = text(payload?.handoverReceiverName, 256, true);
  const handoverNote = text(payload?.handoverNote, 2000);
  if (!dispatchedAt || !handoverReceiverName) {
    return failure('INVALID_TRIP_DISPATCH', 'Dispatch time and handover receiver are required');
  }
  const normalized = Object.freeze({ tripId, dispatchedAt, handoverReceiverName, handoverNote });
  const hash = payloadHash(normalized);
  const client = await adapter.connect();
  try {
    await client.query('BEGIN');
    await dispatchRepository.setTripDispatchWriteContext(client);
    await issueRepository.setDeliveryIssueWriteContext(client);
    await dispatchRepository.lockDispatchKey(client, {
      installationId: requestContext.installationId,
      tripId,
      idempotencyKey,
    });
    const trip = await dispatchRepository.getTripForDispatch(client, {
      installationId: requestContext.installationId,
      tripId,
    });
    if (!trip) {
      await client.query('ROLLBACK');
      return failure('DELIVERY_TRIP_NOT_FOUND', 'Delivery trip was not found');
    }
    if (!warehouseAllowed(requestContext, trip.warehouse_id)) {
      await client.query('ROLLBACK');
      return failure('WAREHOUSE_SCOPE_DENIED', 'Delivery trip is outside the authorized warehouse scope');
    }
    if (trip.status === 'dispatched') {
      if (trip.dispatch_idempotency_key !== idempotencyKey || trip.dispatch_payload_hash !== hash) {
        await client.query('ROLLBACK');
        return failure('IDEMPOTENCY_PAYLOAD_MISMATCH', 'Dispatch key was used with another payload');
      }
      const detail = await loadDispatchDetail(client, { requestContext, tripId });
      await client.query('COMMIT');
      return Object.freeze({ ok: true, trip: detail.trip, replayed: true });
    }
    if (trip.status !== 'locked') {
      await client.query('ROLLBACK');
      return failure('INVALID_TRIP_STATUS_TRANSITION', 'Trip must be locked before dispatch');
    }
    if (!trip.vehicle_id || !trip.vehicle_is_active || trip.vehicle_operational_status !== 'AVAILABLE') {
      await client.query('ROLLBACK');
      return failure('LOGISTICS_VEHICLE_NOT_AVAILABLE', 'Vehicle is not available for dispatch');
    }
    if (!trip.primary_driver_id || !trip.driver_is_active) {
      await client.query('ROLLBACK');
      return failure('LOGISTICS_DRIVER_NOT_AVAILABLE', 'Driver is not available for dispatch');
    }

    const assignments = await dispatchRepository.listAssignmentsForDispatch(client, {
      installationId: requestContext.installationId,
      tripId,
    });
    if (assignments.length === 0) {
      await client.query('ROLLBACK');
      return failure('DELIVERY_TRIP_ASSIGNMENT_REQUIRED', 'Trip requires at least one Delivery Order');
    }
    for (const assignment of assignments) {
      if (assignment.delivery_order_status !== 'ready_to_dispatch'
        || assignment.handover_mode !== 'DELIVERY'
        || assignment.sales_order_status !== 'confirmed'
        || assignment.sales_order_delivery_mode !== 'DELIVERY'
        || assignment.warehouse_id !== trip.warehouse_id) {
        await client.query('ROLLBACK');
        return failure(
          'DELIVERY_ORDER_NOT_ELIGIBLE',
          'One or more Delivery Orders are no longer eligible for dispatch',
          true,
          { deliveryOrderId: assignment.delivery_order_id },
        );
      }
    }

    const dispatchId = randomUUID();
    const issued = [];
    for (const assignment of assignments) {
      const result = await issueDeliveryOrderInTransaction(client, {
        requestContext,
        trip,
        assignment,
        dispatchId,
        idempotencyKey,
        dispatchedAt,
        handoverReceiverName,
        handoverNote,
      });
      if (!result.ok) {
        await client.query('ROLLBACK');
        return result;
      }
      await dispatchRepository.insertDispatchItem(client, {
        id: randomUUID(),
        installationId: requestContext.installationId,
        dispatchId,
        tripId,
        assignmentId: assignment.assignment_id,
        tripStopId: assignment.trip_stop_id,
        deliveryOrderId: assignment.delivery_order_id,
        inventoryIssueId: result.inventoryIssueId,
        inventoryMovementId: result.inventoryMovementId,
        postedAt: dispatchedAt,
        actorId: requestContext.actorId,
      });
      issued.push(result);
    }

    const updated = await dispatchRepository.markTripDispatched(client, {
      installationId: requestContext.installationId,
      tripId,
      dispatchId,
      idempotencyKey,
      payloadHash: hash,
      handoverReceiverName,
      handoverNote,
      dispatchedAt,
      actorId: requestContext.actorId,
    });
    if (!updated) {
      await client.query('ROLLBACK');
      return failure('TRIP_DISPATCH_CONFLICT', 'Trip status changed concurrently', true);
    }
    await dispatchRepository.insertDispatchTripEvent(client, {
      id: randomUUID(),
      installationId: requestContext.installationId,
      tripId,
      idempotencyKey,
      payloadHash: hash,
      actorId: requestContext.actorId,
      requestId: requestContext.requestId,
      sourceApp: requestContext.sourceApp,
      metadata: {
        dispatchId,
        handoverReceiverName,
        deliveryOrderCount: issued.length,
        inventoryMovementIds: issued.map((item) => item.inventoryMovementId),
      },
      occurredAt: dispatchedAt,
    });
    const detail = await loadDispatchDetail(client, { requestContext, tripId });
    if (!detail.ok) {
      await client.query('ROLLBACK');
      return detail;
    }
    const audit = buildAuditRecord({
      requestContext,
      action: 'logistics.delivery_trip.dispatch',
      resourceType: 'delivery_trip',
      resourceId: tripId,
      beforeData: {
        id: trip.id,
        number: trip.trip_number,
        status: trip.status,
        warehouseId: trip.warehouse_id,
        vehicleId: trip.vehicle_id,
        primaryDriverId: trip.primary_driver_id,
      },
      afterData: detail.trip,
      metadata: {
        dispatchId,
        warehouseId: trip.warehouse_id,
        deliveryOrderCount: issued.length,
      },
      occurredAt: dispatchedAt,
    });
    const event = buildOutboxEvent({
      requestContext,
      aggregateType: 'logistics.delivery_trip',
      aggregateId: tripId,
      eventType: 'core.delivery_trip.dispatched',
      eventVersion: Number(detail.trip.revision),
      payload: {
        tripId,
        tripNumber: trip.trip_number,
        dispatchId,
        warehouseId: trip.warehouse_id,
        vehicleId: trip.vehicle_id,
        primaryDriverId: trip.primary_driver_id,
        dispatchedAt,
        deliveryOrders: issued.map((item) => ({
          deliveryOrderId: item.deliveryOrderId,
          inventoryIssueId: item.inventoryIssueId,
          inventoryMovementId: item.inventoryMovementId,
        })),
      },
      metadata: { warehouseId: trip.warehouse_id, deliveryOrderCount: issued.length },
      createdAt: dispatchedAt,
      availableAt: dispatchedAt,
    });
    await insertAuditRecord(client, audit);
    await insertOutboxEvent(client, event);
    await client.query('COMMIT');
    return Object.freeze({ ok: true, trip: detail.trip, replayed: false });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(JSON.stringify(sanitizedTransactionError(error, requestContext.requestId)));
    return knownDatabaseFailure(error)
      ?? failure('TRIP_DISPATCH_TRANSACTION_FAILED', 'Trip dispatch transaction failed', true);
  } finally {
    if (typeof client.release === 'function') await client.release();
  }
}

export async function getDeliveryTripDispatchSummary(adapter, { requestContext, tripId }) {
  if (!UUID_PATTERN.test(String(tripId ?? ''))) return failure('INVALID_TRIP_ID', 'Trip id is invalid');
  return loadDispatchDetail(adapter, { requestContext, tripId });
}

export const logisticsTripDispatchInternals = Object.freeze({
  canonicalize,
  payloadHash,
  parseQuantity,
  strictTimestamp,
  timestampDateOnly,
  issueKeyFor,
});

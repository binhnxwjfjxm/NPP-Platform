import { createHash, randomUUID } from 'node:crypto';
import { IDEMPOTENCY_KEY_PATTERN } from '@npp/contracts';
import {
  buildAuditRecord,
  buildOutboxEvent,
  insertAuditRecord,
  insertOutboxEvent,
} from '../audit-outbox.js';
import * as repository from '../db/repositories/logistics-driver-delivery.js';
import { postReceivableFromDeliveryAttempt } from './customer-receivable.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REASON_PATTERN = /^[A-Z0-9][A-Z0-9._-]{0,63}$/;
const QUANTITY_PATTERN = /^(0|[1-9]\d{0,17})(?:\.(\d{1,12}))?$/;
const SCALE = 1_000_000_000_000n;
const RESULTS = new Set(['delivered_full', 'delivered_partial', 'failed', 'rescheduled']);

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

function hasPermission(requestContext, permission) {
  return Array.isArray(requestContext?.permissions) && requestContext.permissions.includes(permission);
}

function warehouseIds(requestContext) {
  return Array.isArray(requestContext?.scopes?.warehouseIds)
    ? [...new Set(requestContext.scopes.warehouseIds.filter((value) => UUID_PATTERN.test(value)))]
    : [];
}

function text(value, maxLength) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function strictTimestamp(value) {
  const normalized = text(value, 64);
  if (!normalized) return null;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function parseQuantity(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  const match = QUANTITY_PATTERN.exec(normalized);
  if (!match) return null;
  return BigInt(match[1]) * SCALE + BigInt((match[2] ?? '').padEnd(12, '0'));
}

function formatQuantity(value) {
  const whole = value / SCALE;
  const fraction = String(value % SCALE).padStart(12, '0');
  return `${whole}.${fraction}`;
}

function validateDeliveryBaseQuantity(source, quantity) {
  const conversion = parseQuantity(String(source?.conversion_to_base ?? ''));
  const baseUnitCode = text(source?.base_unit_code, 32);
  if (conversion === null || conversion <= 0n || !baseUnitCode) {
    return failure(
      'DELIVERY_ATTEMPT_UNIT_CONTRACT_INVALID',
      'Không thể xác định quy cách và đơn vị tồn của dòng hàng. Vui lòng kiểm tra lại sản phẩm trước khi giao.',
      false,
      { inventoryIssueLineId: source?.inventory_issue_line_id ?? null },
    );
  }
  if (source?.base_unit_allows_fractional !== true && quantity % SCALE !== 0n) {
    return failure(
      'DELIVERY_ATTEMPT_BASE_UNIT_FRACTION_NOT_ALLOWED',
      `Số thực giao phải là số nguyên theo đơn vị ${baseUnitCode}.`,
      false,
      {
        inventoryIssueLineId: source?.inventory_issue_line_id ?? null,
        baseUnitCode,
      },
    );
  }
  return null;
}

function mapAttemptLine(row) {
  return Object.freeze({
    id: row.id,
    deliveryOrderLineId: row.delivery_order_line_id,
    inventoryIssueLineId: row.inventory_issue_line_id,
    sku: row.sku_snapshot ?? null,
    itemName: row.item_name_snapshot ?? null,
    unitCode: row.unit_code_snapshot ?? null,
    conversionToBase: row.conversion_to_base == null ? null : String(row.conversion_to_base),
    baseUnitCode: row.base_unit_code ?? null,
    baseUnitAllowsFractional: row.base_unit_allows_fractional === true,
    issuedBaseQuantity: String(row.issued_base_quantity),
    deliveredBaseQuantity: String(row.delivered_base_quantity),
  });
}

function mapAttempt(row, lines = []) {
  return Object.freeze({
    id: row.id,
    tripId: row.trip_id,
    stopId: row.trip_stop_id,
    assignmentId: row.assignment_id,
    deliveryOrderId: row.delivery_order_id,
    driverProfileId: row.driver_profile_id,
    result: row.result,
    attemptedAt: row.attempted_at,
    reasonCode: row.reason_code ?? null,
    note: row.note ?? null,
    rescheduledFor: row.rescheduled_for ?? null,
    lines: Object.freeze(lines.map(mapAttemptLine)),
  });
}

function mapAssignmentLine(value) {
  return Object.freeze({
    deliveryOrderLineId: value.deliveryOrderLineId,
    inventoryIssueLineId: value.inventoryIssueLineId,
    sku: value.sku ?? null,
    itemName: value.itemName ?? null,
    unitCode: value.unitCode ?? null,
    conversionToBase: value.conversionToBase == null ? null : String(value.conversionToBase),
    baseUnitCode: value.baseUnitCode ?? null,
    baseUnitAllowsFractional: value.baseUnitAllowsFractional === true,
    issuedBaseQuantity: String(value.issuedBaseQuantity),
    deliveredBaseQuantity: value.deliveredBaseQuantity == null
      ? null
      : String(value.deliveredBaseQuantity),
  });
}

function mapAssignmentAttempt(value) {
  if (!value || typeof value !== 'object') return null;
  return Object.freeze({
    id: value.id,
    result: value.result,
    attemptedAt: value.attemptedAt,
    reasonCode: value.reasonCode ?? null,
    note: value.note ?? null,
    rescheduledFor: value.rescheduledFor ?? null,
  });
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
    dispatchItemId: value.dispatchItemId ?? null,
    inventoryIssueId: value.inventoryIssueId ?? null,
    attempt: mapAssignmentAttempt(value.attempt),
    lines: Object.freeze((Array.isArray(value.lines) ? value.lines : []).map(mapAssignmentLine)),
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
    attemptCount: row.attempt_count === undefined ? undefined : Number(row.attempt_count),
    stops,
  });
}

async function resolveDriver(adapter, requestContext, permission) {
  if (!hasPermission(requestContext, 'core.delivery-trip.driver-read')) {
    return failure('PERMISSION_DENIED', 'Permission core.delivery-trip.driver-read is required');
  }
  if (!hasPermission(requestContext, permission)) {
    return failure('PERMISSION_DENIED', `Permission ${permission} is required`);
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

async function loadAttempt(client, { installationId, assignmentId }) {
  const attempt = await repository.getAttemptByAssignment(client, { installationId, assignmentId });
  if (!attempt) return null;
  const lines = await repository.listAttemptLines(client, { installationId, attemptId: attempt.id });
  return mapAttempt(attempt, lines);
}

export async function listAssignedDriverTrips(adapter, {
  requestContext,
  limit = 100,
  offset = 0,
}) {
  try {
    const identity = await resolveDriver(adapter, requestContext, 'core.delivery-attempt.read');
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
    const identity = await resolveDriver(adapter, requestContext, 'core.delivery-attempt.read');
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

function normalizeAttemptPayload(payload) {
  const result = String(payload?.result ?? '').trim();
  if (!RESULTS.has(result)) return failure('INVALID_DELIVERY_ATTEMPT_RESULT', 'Delivery attempt result is invalid');
  const attemptedAt = strictTimestamp(payload?.attemptedAt ?? payload?.occurredAt);
  if (!attemptedAt) return failure('INVALID_DELIVERY_ATTEMPT_TIME', 'Attempt time is required');
  const note = payload?.note == null ? null : text(payload.note, 2000);
  if (payload?.note != null && !note) return failure('INVALID_DELIVERY_ATTEMPT_NOTE', 'Attempt note is invalid');

  const rawReason = payload?.reasonCode == null ? null : String(payload.reasonCode).trim().toUpperCase();
  const reasonCode = rawReason && REASON_PATTERN.test(rawReason) ? rawReason : null;
  const rescheduledFor = payload?.rescheduledFor == null ? null : strictTimestamp(payload.rescheduledFor);
  const rawLines = Array.isArray(payload?.lines) ? payload.lines : [];

  if (result === 'failed' || result === 'rescheduled') {
    if (!reasonCode) return failure('DELIVERY_ATTEMPT_REASON_REQUIRED', 'Reason code is required');
    if (rawLines.length > 0) return failure('DELIVERY_ATTEMPT_LINES_FORBIDDEN', 'Non-delivery result cannot contain quantities');
  } else if (rawReason || rescheduledFor) {
    return failure('DELIVERY_ATTEMPT_RESULT_SHAPE_INVALID', 'Delivered result cannot include failure or reschedule fields');
  }

  if (result === 'failed' && rescheduledFor) {
    return failure('DELIVERY_ATTEMPT_RESULT_SHAPE_INVALID', 'Failed result cannot include reschedule time');
  }
  if (result === 'rescheduled') {
    if (!rescheduledFor || new Date(rescheduledFor).getTime() <= new Date(attemptedAt).getTime()) {
      return failure('DELIVERY_ATTEMPT_RESCHEDULE_TIME_INVALID', 'Reschedule time must be after attempt time');
    }
  }
  if (result === 'delivered_full' && rawLines.length > 0) {
    return failure('DELIVERY_ATTEMPT_LINES_FORBIDDEN', 'Full delivery quantities are derived from Inventory OUT');
  }
  if (result === 'delivered_partial' && (rawLines.length === 0 || rawLines.length > 500)) {
    return failure('DELIVERY_ATTEMPT_PARTIAL_LINES_REQUIRED', 'Partial delivery requires exact line quantities');
  }

  const seen = new Set();
  const lines = [];
  for (const raw of rawLines) {
    const inventoryIssueLineId = String(raw?.inventoryIssueLineId ?? '').trim();
    const quantity = parseQuantity(raw?.deliveredBaseQuantity);
    if (!UUID_PATTERN.test(inventoryIssueLineId) || quantity === null || seen.has(inventoryIssueLineId)) {
      return failure('INVALID_DELIVERY_ATTEMPT_LINE', 'Attempt line identity or quantity is invalid');
    }
    seen.add(inventoryIssueLineId);
    lines.push(Object.freeze({ inventoryIssueLineId, quantity }));
  }
  lines.sort((left, right) => left.inventoryIssueLineId.localeCompare(right.inventoryIssueLineId));

  return Object.freeze({
    ok: true,
    normalized: Object.freeze({
      result,
      attemptedAt,
      reasonCode,
      note,
      rescheduledFor,
      lines: Object.freeze(lines),
    }),
  });
}

function eventKey(idempotencyKey, assignmentId) {
  return `delivery-attempt-${payloadHash({ idempotencyKey, assignmentId }).slice(0, 48)}`;
}

function knownDatabaseFailure(error) {
  const message = String(error?.message ?? '');
  const mappings = [
    ['delivery_attempts_assignment_unique', 'DELIVERY_ATTEMPT_ALREADY_RECORDED', 'Assignment already has a terminal delivery attempt'],
    ['delivery_attempts_idempotency_unique', 'IDEMPOTENCY_PAYLOAD_MISMATCH', 'Idempotency key was used by another attempt'],
    ['delivery_attempt_full_quantity_mismatch', 'DELIVERY_ATTEMPT_FULL_QUANTITY_MISMATCH', 'Full delivery does not match Inventory OUT'],
    ['delivery_attempt_partial_quantity_mismatch', 'DELIVERY_ATTEMPT_PARTIAL_QUANTITY_MISMATCH', 'Partial delivery quantities are invalid'],
    ['delivery_attempt_line_source_mismatch', 'DELIVERY_ATTEMPT_LINEAGE_MISMATCH', 'Attempt line does not match Inventory OUT lineage'],
    ['delivery_attempt_lineage_mismatch', 'DELIVERY_ATTEMPT_LINEAGE_MISMATCH', 'Attempt does not match dispatched trip lineage'],
    ['receivable_documents_source_unique', 'RECEIVABLE_SOURCE_CONFLICT', 'Accepted delivery already has a receivable document'],
    ['receivable_ledger_entries_source_type_unique', 'RECEIVABLE_SOURCE_CONFLICT', 'Accepted delivery already has a receivable ledger entry'],
  ];
  for (const [needle, code, publicMessage] of mappings) {
    if (message.includes(needle) || error?.constraint === needle) {
      return failure(code, publicMessage, code.includes('CONFLICT'));
    }
  }
  return null;
}

export async function recordDriverDeliveryAttempt({
  adapter,
  requestContext,
  tripId,
  assignmentId,
  idempotencyKey,
  payload,
}) {
  if (!UUID_PATTERN.test(String(tripId ?? ''))) return failure('INVALID_TRIP_ID', 'Trip id is invalid');
  if (!UUID_PATTERN.test(String(assignmentId ?? ''))) return failure('INVALID_ASSIGNMENT_ID', 'Assignment id is invalid');
  if (!IDEMPOTENCY_KEY_PATTERN.test(String(idempotencyKey ?? ''))) {
    return failure('INVALID_IDEMPOTENCY_KEY', 'Idempotency key must use 1-128 safe characters');
  }
  const parsed = normalizeAttemptPayload(payload);
  if (!parsed.ok) return parsed;
  const normalized = parsed.normalized;
  const canonicalPayload = Object.freeze({
    tripId,
    assignmentId,
    result: normalized.result,
    attemptedAt: normalized.attemptedAt,
    reasonCode: normalized.reasonCode,
    note: normalized.note,
    rescheduledFor: normalized.rescheduledFor,
    lines: normalized.lines.map((line) => Object.freeze({
      inventoryIssueLineId: line.inventoryIssueLineId,
      deliveredBaseQuantity: formatQuantity(line.quantity),
    })),
  });
  const hash = payloadHash(canonicalPayload);
  const client = await adapter.connect();
  try {
    await client.query('BEGIN');
    const identity = await resolveDriver(client, requestContext, 'core.delivery-attempt.record');
    if (!identity.ok) {
      await client.query('ROLLBACK');
      return identity;
    }
    await repository.setDeliveryAttemptWriteContext(client);
    await repository.lockDeliveryAttemptKey(client, {
      installationId: requestContext.installationId,
      assignmentId,
      idempotencyKey,
    });
    const lineage = await repository.getAttemptLineageForDriver(client, {
      installationId: requestContext.installationId,
      tripId,
      assignmentId,
      driverProfileId: identity.driver.id,
      warehouseIds: identity.warehouseIds,
    });
    if (!lineage) {
      await client.query('ROLLBACK');
      return failure('DELIVERY_ASSIGNMENT_NOT_FOUND', 'Delivery assignment was not found');
    }

    const keyed = await repository.getAttemptByIdempotencyKey(client, {
      installationId: requestContext.installationId,
      idempotencyKey,
    });
    if (keyed) {
      if (keyed.assignment_id !== assignmentId || keyed.payload_hash !== hash) {
        await client.query('ROLLBACK');
        return failure('IDEMPOTENCY_PAYLOAD_MISMATCH', 'Idempotency key was used with another payload');
      }
      const replay = await loadAttempt(client, {
        installationId: requestContext.installationId,
        assignmentId,
      });
      await client.query('COMMIT');
      return Object.freeze({ ok: true, attempt: replay, replayed: true });
    }

    const existing = await repository.getAttemptByAssignment(client, {
      installationId: requestContext.installationId,
      assignmentId,
    });
    if (existing) {
      await client.query('ROLLBACK');
      return failure('DELIVERY_ATTEMPT_ALREADY_RECORDED', 'Assignment already has a terminal delivery attempt');
    }

    const sourceLines = await repository.listAttemptIssueLines(client, {
      installationId: requestContext.installationId,
      inventoryIssueId: lineage.inventory_issue_id,
    });
    if (sourceLines.length === 0) {
      await client.query('ROLLBACK');
      return failure('DELIVERY_ATTEMPT_SOURCE_LINES_REQUIRED', 'Inventory OUT source lines were not found');
    }

    const issuedByLine = new Map();
    for (const source of sourceLines) {
      const issued = parseQuantity(String(source.issued_base_quantity));
      if (issued === null || issued <= 0n) {
        await client.query('ROLLBACK');
        return failure(
          'DELIVERY_ATTEMPT_SOURCE_QUANTITY_INVALID',
          'Số lượng đã xuất của dòng hàng không hợp lệ. Vui lòng kiểm tra lại phiếu xuất.',
          false,
          { inventoryIssueLineId: source.inventory_issue_line_id },
        );
      }
      const contractError = validateDeliveryBaseQuantity(source, issued);
      if (contractError) {
        await client.query('ROLLBACK');
        return contractError;
      }
      issuedByLine.set(source.inventory_issue_line_id, issued);
    }

    let attemptLines = [];
    if (normalized.result === 'delivered_full') {
      attemptLines = sourceLines.map((source) => Object.freeze({
        source,
        delivered: issuedByLine.get(source.inventory_issue_line_id),
      }));
    } else if (normalized.result === 'delivered_partial') {
      if (normalized.lines.length !== sourceLines.length) {
        await client.query('ROLLBACK');
        return failure('DELIVERY_ATTEMPT_PARTIAL_LINE_SET_MISMATCH', 'Partial delivery must include every Inventory OUT line');
      }
      const requested = new Map(normalized.lines.map((line) => [line.inventoryIssueLineId, line.quantity]));
      let hasDeliveredQuantity = false;
      let hasRemainingQuantity = false;
      attemptLines = [];
      for (const source of sourceLines) {
        const issued = issuedByLine.get(source.inventory_issue_line_id);
        const delivered = requested.get(source.inventory_issue_line_id);
        if (issued === undefined || delivered === undefined || delivered > issued) {
          await client.query('ROLLBACK');
          return failure('DELIVERY_ATTEMPT_QUANTITY_EXCEEDS_ISSUED', 'Delivered quantity exceeds Inventory OUT');
        }
        const contractError = validateDeliveryBaseQuantity(source, delivered);
        if (contractError) {
          await client.query('ROLLBACK');
          return contractError;
        }
        if (delivered > 0n) hasDeliveredQuantity = true;
        if (delivered < issued) hasRemainingQuantity = true;
        attemptLines.push(Object.freeze({ source, delivered }));
      }
      if (!hasDeliveredQuantity || !hasRemainingQuantity) {
        await client.query('ROLLBACK');
        return failure('DELIVERY_ATTEMPT_PARTIAL_QUANTITY_INVALID', 'Partial delivery must include delivered and remaining quantity');
      }
    }

    const attemptId = randomUUID();
    const inserted = await repository.insertDeliveryAttempt(client, {
      id: attemptId,
      installationId: requestContext.installationId,
      tripId,
      tripStopId: lineage.trip_stop_id,
      assignmentId,
      deliveryOrderId: lineage.delivery_order_id,
      dispatchItemId: lineage.dispatch_item_id,
      inventoryIssueId: lineage.inventory_issue_id,
      driverProfileId: identity.driver.id,
      result: normalized.result,
      attemptedAt: normalized.attemptedAt,
      reasonCode: normalized.reasonCode,
      note: normalized.note,
      rescheduledFor: normalized.rescheduledFor,
      idempotencyKey,
      payloadHash: hash,
      actorId: requestContext.actorId,
      requestId: requestContext.requestId,
      sourceApp: requestContext.sourceApp,
    });

    const insertedLines = [];
    for (const line of attemptLines) {
      insertedLines.push(await repository.insertDeliveryAttemptLine(client, {
        id: randomUUID(),
        installationId: requestContext.installationId,
        attemptId,
        deliveryOrderLineId: line.source.delivery_order_line_id,
        inventoryIssueLineId: line.source.inventory_issue_line_id,
        issuedBaseQuantity: String(line.source.issued_base_quantity),
        deliveredBaseQuantity: formatQuantity(line.delivered),
        actorId: requestContext.actorId,
      }));
    }
    const snapshotLines = insertedLines.map((line) => {
      const source = sourceLines.find((candidate) => candidate.inventory_issue_line_id === line.inventory_issue_line_id);
      return {
        ...line,
        line_number: source?.line_number,
        sku_snapshot: source?.sku_snapshot,
        item_name_snapshot: source?.item_name_snapshot,
        unit_code_snapshot: source?.unit_code_snapshot,
        conversion_to_base: source?.conversion_to_base,
        base_unit_code: source?.base_unit_code,
        base_unit_allows_fractional: source?.base_unit_allows_fractional === true,
      };
    });
    const snapshot = mapAttempt(inserted, snapshotLines);

    if (normalized.result === 'delivered_full' || normalized.result === 'delivered_partial') {
      const receivableResult = await postReceivableFromDeliveryAttempt(client, {
        requestContext,
        attemptId,
      });
      if (!receivableResult.ok) {
        await client.query('ROLLBACK');
        return receivableResult;
      }
    }

    await repository.insertDeliveryAttemptTripEvent(client, {
      id: randomUUID(),
      installationId: requestContext.installationId,
      tripId,
      idempotencyKey: eventKey(idempotencyKey, assignmentId),
      payloadHash: hash,
      actorId: requestContext.actorId,
      requestId: requestContext.requestId,
      sourceApp: requestContext.sourceApp,
      reason: normalized.reasonCode,
      metadata: {
        attemptId,
        assignmentId,
        deliveryOrderId: lineage.delivery_order_id,
        result: normalized.result,
        deliveredLines: insertedLines.length,
      },
      occurredAt: normalized.attemptedAt,
    });

    await insertAuditRecord(client, buildAuditRecord({
      requestContext,
      action: 'logistics.delivery_attempt.record',
      resourceType: 'delivery_attempt',
      resourceId: attemptId,
      afterData: snapshot,
      metadata: {
        tripId,
        assignmentId,
        deliveryOrderId: lineage.delivery_order_id,
        warehouseId: lineage.warehouse_id,
      },
      occurredAt: normalized.attemptedAt,
    }));
    const outbox = buildOutboxEvent({
      requestContext,
      aggregateType: 'logistics.delivery_attempt',
      aggregateId: attemptId,
      eventType: 'core.delivery_attempt.recorded',
      eventVersion: 1,
      payload: snapshot,
      metadata: {
        tripId,
        assignmentId,
        deliveryOrderId: lineage.delivery_order_id,
        warehouseId: lineage.warehouse_id,
      },
      createdAt: normalized.attemptedAt,
      availableAt: normalized.attemptedAt,
    });
    await insertOutboxEvent(client, outbox);
    await client.query('COMMIT');
    return Object.freeze({ ok: true, attempt: snapshot, replayed: false, eventId: outbox.eventId });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(JSON.stringify({
      event: 'delivery_attempt_transaction_failed',
      requestId: requestContext.requestId,
      name: typeof error?.name === 'string' ? error.name.slice(0, 80) : 'Error',
      code: typeof error?.code === 'string' ? error.code.slice(0, 80) : null,
      constraint: typeof error?.constraint === 'string' ? error.constraint.slice(0, 160) : null,
      message: String(error?.message ?? 'transaction_failed')
        .replace(/(?:postgres(?:ql)?|https?):\/\/\S+/gi, '[redacted-url]')
        .replace(/(?:password|token|secret|api[_-]?key)\s*[=:]\s*\S+/gi, '$1=[redacted]')
        .replace(/[\r\n\t]+/g, ' ')
        .slice(0, 240),
    }));
    return knownDatabaseFailure(error)
      ?? failure('DELIVERY_ATTEMPT_TRANSACTION_FAILED', 'Delivery attempt transaction failed', true);
  } finally {
    if (typeof client.release === 'function') await client.release();
  }
}

export const logisticsDriverDeliveryInternals = Object.freeze({
  canonicalize,
  payloadHash,
  parseQuantity,
  formatQuantity,
  validateDeliveryBaseQuantity,
  normalizeAttemptPayload,
  eventKey,
});
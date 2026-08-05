import { createHash, randomUUID } from 'node:crypto';
import {
  buildAuditRecord,
  buildOutboxEvent,
  insertAuditRecord,
  insertOutboxEvent,
} from '../audit-outbox.js';
import * as repository from '../db/repositories/logistics-trip-reconciliation.js';
import { postServerOwnedDomainMovement } from './sales-inventory-ledger.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const QUANTITY_PATTERN = /^(0|[1-9]\d{0,17})(?:\.(\d{1,12}))?$/;
const SCALE = 1_000_000_000_000n;
const MAX_OPERATION_BACKDATE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_OPERATION_FUTURE_SKEW_MS = 5 * 60 * 1000;

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

function eventKey(prefix, value) {
  return `${prefix}:${createHash('sha256').update(String(value)).digest('hex').slice(0, 48)}`;
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

function documentDate(value, timeZone = 'Asia/Ho_Chi_Minh') {
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

function parseQuantity(value) {
  const normalized = String(value ?? '').trim();
  const match = QUANTITY_PATTERN.exec(normalized);
  if (!match) return null;
  return BigInt(match[1]) * SCALE + BigInt((match[2] ?? '').padEnd(12, '0'));
}

function formatQuantity(value) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return `${negative ? '-' : ''}${absolute / SCALE}.${String(absolute % SCALE).padStart(12, '0')}`;
}

function permissions(requestContext) {
  return new Set([
    ...(Array.isArray(requestContext?.permissions) ? requestContext.permissions : []),
    ...(Array.isArray(requestContext?.grantedPermissions) ? requestContext.grantedPermissions : []),
  ]);
}

function warehouseAllowed(requestContext, warehouseId) {
  return Array.isArray(requestContext?.scopes?.warehouseIds)
    && requestContext.scopes.warehouseIds.includes(warehouseId);
}

function validateOperationalTimestamp({
  value,
  requestReceivedAt,
  dispatchedAt,
  code,
  label,
}) {
  const operationTime = new Date(value).getTime();
  const serverTime = new Date(requestReceivedAt ?? Date.now()).getTime();
  const dispatchTime = new Date(dispatchedAt).getTime();
  if (!Number.isFinite(operationTime) || !Number.isFinite(serverTime) || !Number.isFinite(dispatchTime)) {
    return failure(code, `${label} is invalid`);
  }
  const earliest = Math.max(dispatchTime, serverTime - MAX_OPERATION_BACKDATE_MS);
  const latest = serverTime + MAX_OPERATION_FUTURE_SKEW_MS;
  if (operationTime < earliest || operationTime > latest) {
    return failure(code, `${label} must be after dispatch and within the allowed operating window`);
  }
  return Object.freeze({ ok: true, value: new Date(operationTime).toISOString() });
}

function mapReceipt(row) {
  return Object.freeze({
    id: row.id,
    tripId: row.trip_id,
    warehouseId: row.warehouse_id,
    status: row.status,
    inventoryMovementId: row.inventory_movement_id,
    receivedAt: row.received_at,
    note: row.note ?? null,
    lines: Object.freeze(Array.isArray(row.lines) ? row.lines : []),
  });
}

function mapLine(row) {
  const issued = parseQuantity(row.issued_base_quantity) ?? 0n;
  const delivered = parseQuantity(row.delivered_base_quantity) ?? 0n;
  const returned = parseQuantity(row.returned_base_quantity) ?? 0n;
  return Object.freeze({
    assignmentId: row.assignment_id,
    stopId: row.trip_stop_id,
    stopSequence: Number(row.stop_sequence),
    deliveryOrderId: row.delivery_order_id,
    deliveryOrderNumber: row.delivery_order_number ?? null,
    customerCode: row.customer_code_snapshot ?? null,
    customerName: row.customer_name_snapshot ?? null,
    attemptId: row.attempt_id ?? null,
    attemptResult: row.attempt_result ?? null,
    attemptedAt: row.attempted_at ?? null,
    reasonCode: row.reason_code ?? null,
    rescheduledFor: row.rescheduled_for ?? null,
    inventoryIssueId: row.inventory_issue_id,
    inventoryIssueLineId: row.inventory_issue_line_id,
    deliveryOrderLineId: row.delivery_order_line_id,
    sku: row.sku_snapshot,
    itemName: row.item_name_snapshot,
    unitCode: row.unit_code_snapshot,
    warehouseId: row.warehouse_id,
    locationId: row.location_id ?? null,
    locationCode: row.location_code ?? null,
    locationName: row.location_name ?? null,
    baseVariantId: row.base_variant_id,
    baseSku: row.base_sku,
    baseUnitId: row.base_unit_id,
    baseUnitCode: row.base_unit_code,
    lotId: row.lot_id ?? null,
    lotCode: row.lot_code ?? null,
    expiryDate: row.expiry_date ?? null,
    issuedBaseQuantity: formatQuantity(issued),
    deliveredBaseQuantity: formatQuantity(delivered),
    returnedBaseQuantity: formatQuantity(returned),
    outstandingBaseQuantity: formatQuantity(issued - delivered - returned),
  });
}

function mapTrip(row, lines, receipts) {
  const mappedLines = lines.map(mapLine);
  const canClose = row.status === 'dispatched'
    && mappedLines.length > 0
    && mappedLines.every((line) => line.attemptId && parseQuantity(line.outstandingBaseQuantity) === 0n);
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
    primaryDriverId: row.primary_driver_id ?? null,
    driverCode: row.driver_code ?? null,
    driverName: row.driver_name ?? null,
    dispatchedAt: row.dispatched_at ?? null,
    closedAt: row.closed_at ?? null,
    closedBy: row.closed_by ?? null,
    closeNote: row.close_note ?? null,
    revision: String(row.revision),
    canClose,
    lines: Object.freeze(mappedLines),
    receipts: Object.freeze(receipts.map(mapReceipt)),
  });
}

async function loadDetail(client, { requestContext, tripId, lock = false }) {
  const trip = lock
    ? await repository.getTripForReconciliation(client, {
      installationId: requestContext.installationId,
      tripId,
    })
    : await repository.getTripForReconciliationRead(client, {
      installationId: requestContext.installationId,
      tripId,
    });
  if (!trip) return failure('DELIVERY_TRIP_NOT_FOUND', 'Delivery trip was not found');
  if (!warehouseAllowed(requestContext, trip.warehouse_id)) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Delivery trip is outside the authorized warehouse scope');
  }
  const [lines, receipts] = await Promise.all([
    repository.listReconciliationLines(client, {
      installationId: requestContext.installationId,
      tripId,
    }),
    repository.listReturnReceipts(client, {
      installationId: requestContext.installationId,
      tripId,
    }),
  ]);
  return Object.freeze({ ok: true, trip: mapTrip(trip, lines, receipts) });
}

function normalizeReceiptPayload(tripId, payload) {
  const receivedAt = strictTimestamp(payload?.receivedAt);
  const note = text(payload?.note, 2000);
  if (!receivedAt) return failure('INVALID_RECEIVED_AT', 'receivedAt must be a valid timestamp');
  if (!Array.isArray(payload?.lines) || payload.lines.length < 1 || payload.lines.length > 500) {
    return failure('INVALID_RETURN_LINES', 'Return receipt requires 1-500 lines');
  }
  const seen = new Set();
  const lines = [];
  for (let index = 0; index < payload.lines.length; index += 1) {
    const inventoryIssueLineId = String(payload.lines[index]?.inventoryIssueLineId ?? '').trim();
    const quantity = parseQuantity(payload.lines[index]?.returnedBaseQuantity);
    if (!UUID_PATTERN.test(inventoryIssueLineId) || seen.has(inventoryIssueLineId)) {
      return failure('INVALID_INVENTORY_ISSUE_LINE', 'Inventory issue line is invalid or duplicated', false, { line: index + 1 });
    }
    if (quantity === null || quantity <= 0n) {
      return failure('INVALID_RETURN_QUANTITY', 'Returned quantity must be a positive exact decimal', false, { line: index + 1 });
    }
    seen.add(inventoryIssueLineId);
    lines.push({ inventoryIssueLineId, returnedBaseQuantity: formatQuantity(quantity), quantity });
  }
  lines.sort((left, right) => left.inventoryIssueLineId.localeCompare(right.inventoryIssueLineId));
  return Object.freeze({
    ok: true,
    value: Object.freeze({ tripId, receivedAt, note, lines: Object.freeze(lines) }),
  });
}

function knownDatabaseFailure(error) {
  const message = String(error?.message ?? '');
  const mappings = [
    ['trip_return_receipts_idempotency_unique', 'IDEMPOTENCY_PAYLOAD_MISMATCH', 'Receipt key was used with another payload', false],
    ['delivery_trips_close_idempotency_unique', 'IDEMPOTENCY_PAYLOAD_MISMATCH', 'Close key was used with another trip', false],
    ['logistics_trip_return_quantity_exceeds_outstanding', 'RETURN_QUANTITY_EXCEEDS_OUTSTANDING', 'Returned quantity exceeds stock still held by the trip', false],
    ['logistics_trip_return_receipt_lineage_mismatch', 'RETURN_LINEAGE_MISMATCH', 'Return line does not belong to this trip', false],
    ['logistics_trip_close_missing_attempts', 'TRIP_CLOSE_MISSING_ATTEMPTS', 'Every assignment requires a delivery result before close', false],
    ['logistics_trip_close_receipt_posting', 'TRIP_CLOSE_RECEIPT_POSTING', 'A return receipt is still posting', true],
    ['logistics_trip_close_unreconciled_stock', 'TRIP_CLOSE_UNRECONCILED_STOCK', 'Trip still has undelivered stock outside the warehouse', false],
  ];
  for (const [needle, code, publicMessage, retryable] of mappings) {
    if (message.includes(needle) || error?.constraint === needle) {
      return failure(code, publicMessage, retryable);
    }
  }
  return null;
}

function logTransactionError(error, requestId, event) {
  console.error(JSON.stringify({
    event,
    requestId,
    name: typeof error?.name === 'string' ? error.name.slice(0, 80) : 'Error',
    code: typeof error?.code === 'string' ? error.code.slice(0, 80) : null,
    constraint: typeof error?.constraint === 'string' ? error.constraint.slice(0, 160) : null,
    message: String(error?.message ?? 'transaction_failed')
      .replace(/(?:postgres(?:ql)?|https?):\/\/\S+/gi, '[redacted-url]')
      .replace(/(?:password|token|secret|api[_-]?key)\s*[=:]\s*\S+/gi, '$1=[redacted]')
      .replace(/[\r\n\t]+/g, ' ')
      .slice(0, 240),
  }));
}

export async function getTripReconciliation(adapter, { requestContext, tripId }) {
  if (!UUID_PATTERN.test(String(tripId ?? ''))) return failure('INVALID_TRIP_ID', 'Trip id is invalid');
  const granted = permissions(requestContext);
  if (!granted.has('core.delivery-trip.reconciliation-read') || !granted.has('core.delivery-trip.read')) {
    return failure('PERMISSION_DENIED', 'Trip reconciliation read permission is required');
  }
  return loadDetail(adapter, { requestContext, tripId });
}

export async function receiveTripReturn({
  adapter,
  requestContext,
  tripId,
  idempotencyKey,
  payload,
}) {
  if (!UUID_PATTERN.test(String(tripId ?? ''))) return failure('INVALID_TRIP_ID', 'Trip id is invalid');
  if (!IDEMPOTENCY_PATTERN.test(String(idempotencyKey ?? ''))) {
    return failure('INVALID_IDEMPOTENCY_KEY', 'Idempotency key must use 1-128 safe characters');
  }
  if (!permissions(requestContext).has('core.delivery-trip.return-receive')) {
    return failure('PERMISSION_DENIED', 'Permission core.delivery-trip.return-receive is required');
  }
  const normalized = normalizeReceiptPayload(tripId, payload);
  if (!normalized.ok) return normalized;
  const canonicalPayload = {
    tripId,
    receivedAt: normalized.value.receivedAt,
    note: normalized.value.note,
    lines: normalized.value.lines.map(({ inventoryIssueLineId, returnedBaseQuantity }) => ({
      inventoryIssueLineId,
      returnedBaseQuantity,
    })),
  };
  const hash = payloadHash(canonicalPayload);
  const client = await adapter.connect();
  try {
    await client.query('BEGIN');
    await repository.setTripReconciliationWriteContext(client);
    await repository.lockReconciliationKey(client, {
      installationId: requestContext.installationId,
      tripId,
      operation: 'return-receipt',
      idempotencyKey,
    });
    const detailBefore = await loadDetail(client, { requestContext, tripId, lock: true });
    if (!detailBefore.ok) {
      await client.query('ROLLBACK');
      return detailBefore;
    }
    const existing = await repository.getReceiptByIdempotencyKey(client, {
      installationId: requestContext.installationId,
      idempotencyKey,
    });
    if (existing) {
      if (existing.trip_id !== tripId || existing.payload_hash !== hash) {
        await client.query('ROLLBACK');
        return failure('IDEMPOTENCY_PAYLOAD_MISMATCH', 'Receipt key was used with another payload');
      }
      const replay = await loadDetail(client, { requestContext, tripId });
      await client.query('COMMIT');
      return Object.freeze({ ok: true, trip: replay.trip, receiptId: existing.id, replayed: true });
    }
    if (detailBefore.trip.status !== 'dispatched') {
      await client.query('ROLLBACK');
      return failure('INVALID_TRIP_STATUS_TRANSITION', 'Only a dispatched trip can receive returned stock');
    }
    const operationalTime = validateOperationalTimestamp({
      value: normalized.value.receivedAt,
      requestReceivedAt: requestContext.receivedAt,
      dispatchedAt: detailBefore.trip.dispatchedAt,
      code: 'INVALID_RECEIVED_AT',
      label: 'receivedAt',
    });
    if (!operationalTime.ok) {
      await client.query('ROLLBACK');
      return operationalTime;
    }

    const sourceLines = await repository.listReceiptSourceLinesForUpdate(client, {
      installationId: requestContext.installationId,
      tripId,
      inventoryIssueLineIds: normalized.value.lines.map((line) => line.inventoryIssueLineId),
    });
    if (sourceLines.length !== normalized.value.lines.length) {
      await client.query('ROLLBACK');
      return failure('RETURN_LINEAGE_MISMATCH', 'One or more return lines do not belong to this trip');
    }
    const sourceById = new Map(sourceLines.map((line) => [line.inventory_issue_line_id, line]));
    for (const line of normalized.value.lines) {
      const source = sourceById.get(line.inventoryIssueLineId);
      if (!source?.attempt_id) {
        await client.query('ROLLBACK');
        return failure('DELIVERY_ATTEMPT_REQUIRED', 'Delivery result is required before warehouse receipt');
      }
      const issued = parseQuantity(source.issued_base_quantity) ?? 0n;
      const delivered = parseQuantity(source.delivered_base_quantity) ?? 0n;
      const returned = parseQuantity(source.returned_base_quantity) ?? 0n;
      if (line.quantity > issued - delivered - returned) {
        await client.query('ROLLBACK');
        return failure('RETURN_QUANTITY_EXCEEDS_OUTSTANDING', 'Returned quantity exceeds stock still held by the trip');
      }
    }

    const receiptId = randomUUID();
    await repository.insertReturnReceipt(client, {
      id: receiptId,
      installationId: requestContext.installationId,
      tripId,
      warehouseId: detailBefore.trip.warehouseId,
      receivedAt: operationalTime.value,
      note: normalized.value.note,
      idempotencyKey,
      payloadHash: hash,
      actorId: requestContext.actorId,
      requestId: requestContext.requestId,
      sourceApp: requestContext.sourceApp,
    });
    const receiptLines = [];
    for (const line of normalized.value.lines) {
      const source = sourceById.get(line.inventoryIssueLineId);
      const receiptLine = await repository.insertReturnReceiptLine(client, {
        id: randomUUID(),
        installationId: requestContext.installationId,
        receiptId,
        tripId,
        assignmentId: source.assignment_id,
        attemptId: source.attempt_id,
        inventoryIssueLineId: source.inventory_issue_line_id,
        returnedBaseQuantity: line.returnedBaseQuantity,
        actorId: requestContext.actorId,
      });
      receiptLines.push({ receiptLine, source, quantity: line.returnedBaseQuantity });
    }

    const movement = await postServerOwnedDomainMovement(client, {
      requestContext: Object.freeze({ ...requestContext, receivedAt: operationalTime.value }),
      idempotencyKey: eventKey('trip-return-movement', idempotencyKey),
      payload: {
        movementType: 'LOGISTICS_TRIP_RETURN',
        direction: 'IN',
        sourceDomain: 'LOGISTICS',
        sourceDocumentType: 'TRIP_RETURN_RECEIPT',
        sourceDocumentId: receiptId,
        sourceDocumentNumber: `${detailBefore.trip.number}-RETURN`,
        documentDate: documentDate(operationalTime.value),
        reasonCode: 'FAILED_DELIVERY_RETURN',
        reasonNote: normalized.value.note ?? 'Hàng chưa giao đã được kho thực nhận',
        metadata: { tripId, tripNumber: detailBefore.trip.number, receiptId },
        lines: receiptLines.map(({ receiptLine, source, quantity }) => ({
          sourceLineId: receiptLine.id,
          warehouseId: source.warehouse_id,
          locationId: source.location_id,
          baseVariantId: source.base_variant_id,
          baseSku: source.base_sku,
          baseUnitId: source.base_unit_id,
          baseUnitCode: source.base_unit_code,
          lotId: source.lot_id,
          lotCode: source.lot_code,
          expiryDate: source.expiry_date,
          quantity,
          metadata: {
            tripId,
            assignmentId: source.assignment_id,
            attemptId: source.attempt_id,
            inventoryIssueId: source.inventory_issue_id,
            inventoryIssueLineId: source.inventory_issue_line_id,
          },
        })),
      },
    });
    if (!movement.ok) {
      await client.query('ROLLBACK');
      return movement;
    }
    if (movement.lines.length !== receiptLines.length) {
      await client.query('ROLLBACK');
      return failure('INVENTORY_MOVEMENT_LINE_MISMATCH', 'Return movement line count is invalid');
    }
    for (let index = 0; index < receiptLines.length; index += 1) {
      const linked = await repository.attachMovementLine(client, {
        installationId: requestContext.installationId,
        receiptLineId: receiptLines[index].receiptLine.id,
        movementLineId: movement.lines[index].id,
      });
      if (!linked) {
        await client.query('ROLLBACK');
        return failure('INVENTORY_MOVEMENT_LINE_MISMATCH', 'Return movement line could not be linked');
      }
    }
    const finalized = await repository.finalizeReturnReceipt(client, {
      installationId: requestContext.installationId,
      receiptId,
      movementId: movement.movement.id,
    });
    if (!finalized) {
      await client.query('ROLLBACK');
      return failure('RETURN_RECEIPT_CONFLICT', 'Return receipt changed concurrently', true);
    }

    await repository.insertTripEvent(client, {
      id: randomUUID(),
      installationId: requestContext.installationId,
      tripId,
      eventType: 'RETURN_RECEIPT_POSTED',
      idempotencyKey: eventKey('trip-return-receipt', idempotencyKey),
      payloadHash: hash,
      actorId: requestContext.actorId,
      requestId: requestContext.requestId,
      sourceApp: requestContext.sourceApp,
      reason: normalized.value.note,
      metadata: {
        receiptId,
        inventoryMovementId: movement.movement.id,
        lineCount: receiptLines.length,
      },
      occurredAt: operationalTime.value,
    });
    const detailAfter = await loadDetail(client, { requestContext, tripId });
    const receiptSnapshot = detailAfter.trip.receipts.find((item) => item.id === receiptId);
    await insertAuditRecord(client, buildAuditRecord({
      requestContext,
      action: 'logistics.delivery_trip.return_receive',
      resourceType: 'trip_return_receipt',
      resourceId: receiptId,
      afterData: receiptSnapshot,
      metadata: {
        tripId,
        warehouseId: detailBefore.trip.warehouseId,
        inventoryMovementId: movement.movement.id,
      },
      occurredAt: operationalTime.value,
    }));
    await insertOutboxEvent(client, buildOutboxEvent({
      requestContext,
      aggregateType: 'logistics.delivery_trip',
      aggregateId: tripId,
      eventType: 'core.delivery_trip.return_received',
      eventVersion: Number(detailAfter.trip.revision),
      payload: {
        tripId,
        tripNumber: detailBefore.trip.number,
        receiptId,
        inventoryMovementId: movement.movement.id,
        lines: receiptLines.map(({ source, quantity }) => ({
          assignmentId: source.assignment_id,
          inventoryIssueLineId: source.inventory_issue_line_id,
          returnedBaseQuantity: quantity,
        })),
      },
      metadata: { warehouseId: detailBefore.trip.warehouseId },
    }));
    await client.query('COMMIT');
    return Object.freeze({ ok: true, trip: detailAfter.trip, receiptId, replayed: false });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    logTransactionError(error, requestContext.requestId, 'logistics_trip_return_receive_failed');
    return knownDatabaseFailure(error)
      ?? failure('TRIP_RETURN_RECEIPT_TRANSACTION_FAILED', 'Trip return receipt transaction failed', true);
  } finally {
    if (typeof client.release === 'function') await client.release();
  }
}

export async function closeReconciledTrip({
  adapter,
  requestContext,
  tripId,
  idempotencyKey,
  payload,
}) {
  if (!UUID_PATTERN.test(String(tripId ?? ''))) return failure('INVALID_TRIP_ID', 'Trip id is invalid');
  if (!IDEMPOTENCY_PATTERN.test(String(idempotencyKey ?? ''))) {
    return failure('INVALID_IDEMPOTENCY_KEY', 'Idempotency key must use 1-128 safe characters');
  }
  if (!permissions(requestContext).has('core.delivery-trip.close')) {
    return failure('PERMISSION_DENIED', 'Permission core.delivery-trip.close is required');
  }
  const closedAt = strictTimestamp(payload?.closedAt);
  const note = text(payload?.note, 2000);
  if (!closedAt) return failure('INVALID_CLOSED_AT', 'closedAt must be a valid timestamp');
  const normalized = Object.freeze({ tripId, closedAt, note });
  const hash = payloadHash(normalized);
  const client = await adapter.connect();
  try {
    await client.query('BEGIN');
    await repository.setTripReconciliationWriteContext(client);
    await repository.lockReconciliationKey(client, {
      installationId: requestContext.installationId,
      tripId,
      operation: 'close',
      idempotencyKey,
    });
    const before = await loadDetail(client, { requestContext, tripId, lock: true });
    if (!before.ok) {
      await client.query('ROLLBACK');
      return before;
    }
    if (before.trip.status === 'closed') {
      const raw = await repository.getTripForReconciliationRead(client, {
        installationId: requestContext.installationId,
        tripId,
      });
      if (raw.close_idempotency_key !== idempotencyKey || raw.close_payload_hash !== hash) {
        await client.query('ROLLBACK');
        return failure('IDEMPOTENCY_PAYLOAD_MISMATCH', 'Close key was used with another payload');
      }
      await client.query('COMMIT');
      return Object.freeze({ ok: true, trip: before.trip, replayed: true });
    }
    if (before.trip.status !== 'dispatched') {
      await client.query('ROLLBACK');
      return failure('INVALID_TRIP_STATUS_TRANSITION', 'Only a dispatched trip can be closed');
    }
    const operationalTime = validateOperationalTimestamp({
      value: closedAt,
      requestReceivedAt: requestContext.receivedAt,
      dispatchedAt: before.trip.dispatchedAt,
      code: 'INVALID_CLOSED_AT',
      label: 'closedAt',
    });
    if (!operationalTime.ok) {
      await client.query('ROLLBACK');
      return operationalTime;
    }
    if (!before.trip.canClose) {
      await client.query('ROLLBACK');
      return failure('TRIP_CLOSE_UNRECONCILED_STOCK', 'Trip still has missing attempts or outstanding stock');
    }
    const closed = await repository.closeTrip(client, {
      installationId: requestContext.installationId,
      tripId,
      closedAt: operationalTime.value,
      actorId: requestContext.actorId,
      note,
      idempotencyKey,
      payloadHash: hash,
    });
    if (!closed) {
      await client.query('ROLLBACK');
      return failure('TRIP_CLOSE_CONFLICT', 'Trip status changed concurrently', true);
    }
    await repository.insertTripEvent(client, {
      id: randomUUID(),
      installationId: requestContext.installationId,
      tripId,
      eventType: 'CLOSED',
      idempotencyKey: eventKey('trip-close', idempotencyKey),
      payloadHash: hash,
      actorId: requestContext.actorId,
      requestId: requestContext.requestId,
      sourceApp: requestContext.sourceApp,
      reason: note,
      metadata: { closedAt: operationalTime.value },
      occurredAt: operationalTime.value,
    });
    const after = await loadDetail(client, { requestContext, tripId });
    await insertAuditRecord(client, buildAuditRecord({
      requestContext,
      action: 'logistics.delivery_trip.close',
      resourceType: 'delivery_trip',
      resourceId: tripId,
      beforeData: before.trip,
      afterData: after.trip,
      metadata: { warehouseId: before.trip.warehouseId },
      occurredAt: operationalTime.value,
    }));
    await insertOutboxEvent(client, buildOutboxEvent({
      requestContext,
      aggregateType: 'logistics.delivery_trip',
      aggregateId: tripId,
      eventType: 'core.delivery_trip.closed',
      eventVersion: Number(after.trip.revision),
      payload: {
        tripId,
        tripNumber: after.trip.number,
        warehouseId: after.trip.warehouseId,
        closedAt: operationalTime.value,
      },
      metadata: { warehouseId: after.trip.warehouseId },
    }));
    await client.query('COMMIT');
    return Object.freeze({ ok: true, trip: after.trip, replayed: false });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    logTransactionError(error, requestContext.requestId, 'logistics_trip_close_failed');
    return knownDatabaseFailure(error)
      ?? failure('TRIP_CLOSE_TRANSACTION_FAILED', 'Trip close transaction failed', true);
  } finally {
    if (typeof client.release === 'function') await client.release();
  }
}

export const logisticsTripReconciliationInternals = Object.freeze({
  canonicalize,
  payloadHash,
  parseQuantity,
  formatQuantity,
  strictTimestamp,
  validateOperationalTimestamp,
  normalizeReceiptPayload,
});

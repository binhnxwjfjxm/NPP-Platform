import { randomUUID } from 'node:crypto';
import * as repository from '../db/repositories/cod-settlement.js';
import { createCustomerPayment } from './customer-payment.js';
import {
  IDEMPOTENCY_PATTERN,
  dateInHoChiMinh,
  decimalToScaled,
  failure,
  isUuid,
  mapAssignment,
  mapCollection,
  mapHandover,
  normalizeCollectionPayload,
  payloadHash,
  resolveDriver,
  scaledToDecimal,
  text,
  timestamp,
} from './cod-settlement-shared.js';

export async function getDriverCodOverview(client, { requestContext, tripId }) {
  if (!isUuid(tripId)) return failure('INVALID_TRIP_ID', 'Trip id is invalid');
  const identity = await resolveDriver(client, requestContext, 'core.cod-collection.read');
  if (!identity.ok) return identity;
  const trip = await repository.getDriverTrip(client, {
    installationId: requestContext.installationId,
    tripId,
    driverProfileId: identity.driver.id,
    warehouseIds: identity.warehouseIds,
  });
  if (!trip) return failure('DELIVERY_TRIP_NOT_FOUND', 'Delivery trip was not found');
  const [assignments, handovers] = await Promise.all([
    repository.listDriverCodAssignments(client, {
      installationId: requestContext.installationId,
      tripId,
      driverProfileId: identity.driver.id,
      warehouseIds: identity.warehouseIds,
    }),
    repository.listDriverHandovers(client, {
      installationId: requestContext.installationId,
      tripId,
      driverProfileId: identity.driver.id,
    }),
  ]);
  const mappedAssignments = assignments.map(mapAssignment);
  const custodyTotal = mappedAssignments.reduce((total, assignment) => (
    total + (decimalToScaled(assignment.collection?.custodyRemainingAmount ?? '0', { allowZero: true }) ?? 0n)
  ), 0n);
  return Object.freeze({
    ok: true,
    trip: Object.freeze({
      id: trip.id,
      number: trip.trip_number,
      warehouseId: trip.warehouse_id,
      warehouseCode: trip.warehouse_code,
      warehouseName: trip.warehouse_name,
      driverProfileId: identity.driver.id,
      driverCode: identity.driver.code,
      driverName: identity.driver.name,
      custodyTotal: scaledToDecimal(custodyTotal),
    }),
    assignments: Object.freeze(mappedAssignments),
    handovers: Object.freeze(handovers.map(mapHandover)),
  });
}

export async function recordCodCollection(client, {
  requestContext,
  tripId,
  assignmentId,
  payload,
  idempotencyKey,
}) {
  if (!isUuid(tripId)) return failure('INVALID_TRIP_ID', 'Trip id is invalid');
  if (!isUuid(assignmentId)) return failure('INVALID_ASSIGNMENT_ID', 'Assignment id is invalid');
  if (!IDEMPOTENCY_PATTERN.test(String(idempotencyKey ?? ''))) {
    return failure('INVALID_IDEMPOTENCY_KEY', 'Idempotency key must use 1-128 safe characters');
  }
  const parsed = normalizeCollectionPayload(payload, requestContext.receivedAt);
  if (!parsed.ok) return parsed;
  const canonicalPayload = Object.freeze({ tripId, assignmentId, ...parsed.normalized });
  const hash = payloadHash(canonicalPayload);
  const identity = await resolveDriver(client, requestContext, 'core.cod-collection.record');
  if (!identity.ok) return identity;

  await repository.setCodWriteContext(client);
  await repository.lockCodKey(client, `cod-collection:${requestContext.installationId}:${assignmentId}`);
  const lineage = await repository.getCollectionLineageForDriver(client, {
    installationId: requestContext.installationId,
    tripId,
    assignmentId,
    driverProfileId: identity.driver.id,
    warehouseIds: identity.warehouseIds,
  });
  if (!lineage) return failure('COD_ASSIGNMENT_NOT_FOUND', 'COD assignment was not found');
  if (lineage.collection_policy !== 'COLLECT_ON_DELIVERY') {
    return failure('COD_COLLECTION_POLICY_MISMATCH', 'Delivery order is not collect-on-delivery');
  }
  if (!['delivered_full', 'delivered_partial'].includes(lineage.delivery_attempt_result)) {
    return failure('COD_DELIVERY_NOT_ACCEPTED', 'COD may only be recorded after an accepted delivery');
  }

  const keyed = await repository.getCollectionByIdempotencyKey(client, {
    installationId: requestContext.installationId,
    idempotencyKey,
  });
  if (keyed) {
    if (keyed.assignment_id !== assignmentId || keyed.payload_hash !== hash) {
      return failure('IDEMPOTENCY_PAYLOAD_MISMATCH', 'Idempotency key was used with another COD payload');
    }
    const replay = await repository.getCollectionByAssignment(client, {
      installationId: requestContext.installationId,
      assignmentId,
    });
    return Object.freeze({ ok: true, collection: mapCollection(replay), payment: null, replayed: true });
  }
  const existing = await repository.getCollectionByAssignment(client, {
    installationId: requestContext.installationId,
    assignmentId,
  });
  if (existing) return failure('COD_COLLECTION_ALREADY_RECORDED', 'COD collection was already recorded');

  const expected = decimalToScaled(lineage.remaining_amount, { allowZero: true });
  if (expected === null) return failure('COD_RECEIVABLE_AMOUNT_INVALID', 'Receivable amount is invalid');
  const received = parsed.normalized.receivedAmount;
  let status = 'not_collected';
  if (parsed.normalized.collectionMethod !== 'NONE') {
    if (received === expected) status = 'collected_full';
    else if (received < expected) status = 'collected_partial';
    else status = 'collected_excess';
    if (received !== expected && !parsed.normalized.reasonCode) {
      return failure('COD_DIFFERENCE_REASON_REQUIRED', 'A reasonCode is required for partial or excess collection');
    }
  }

  let payment = null;
  if (parsed.normalized.collectionMethod !== 'NONE') {
    const allocationAmount = received < expected ? received : expected;
    const paymentResult = await createCustomerPayment(client, {
      requestContext,
      idempotencyKey: `codpay:${hash.slice(0, 48)}`,
      payload: {
        customerId: lineage.customer_id,
        warehouseId: lineage.warehouse_id,
        paymentDate: dateInHoChiMinh(parsed.normalized.collectedAt),
        currencyCode: lineage.currency_code,
        paymentMethod: parsed.normalized.collectionMethod,
        amount: scaledToDecimal(received),
        externalReference: parsed.normalized.externalReference,
        note: `COD chuyến ${lineage.trip_number}, phiếu ${lineage.delivery_order_number}`,
        allocations: allocationAmount > 0n ? [{
          receivableDocumentId: lineage.receivable_document_id,
          amount: scaledToDecimal(allocationAmount),
        }] : [],
      },
    });
    if (!paymentResult.ok) return paymentResult;
    payment = paymentResult.customerPayment;
  }

  const inserted = await repository.insertCollection(client, {
    id: randomUUID(),
    installationId: requestContext.installationId,
    warehouseId: lineage.warehouse_id,
    tripId: lineage.trip_id,
    tripStopId: lineage.trip_stop_id,
    assignmentId: lineage.assignment_id,
    deliveryAttemptId: lineage.delivery_attempt_id,
    deliveryOrderId: lineage.delivery_order_id,
    customerId: lineage.customer_id,
    sourceReceivableDocumentId: lineage.receivable_document_id,
    paymentDocumentId: payment?.id ?? null,
    collectionMethod: parsed.normalized.collectionMethod,
    collectionStatus: status,
    currencyCode: lineage.currency_code,
    expectedAmount: scaledToDecimal(expected),
    receivedAmount: scaledToDecimal(received),
    externalReference: parsed.normalized.externalReference,
    reasonCode: parsed.normalized.reasonCode,
    promisedBy: parsed.normalized.promisedBy,
    dueAt: parsed.normalized.dueAt,
    note: parsed.normalized.note,
    collectedAt: parsed.normalized.collectedAt,
    driverProfileId: identity.driver.id,
    idempotencyKey,
    payloadHash: hash,
    actorId: requestContext.actorId,
    requestId: requestContext.requestId,
    sourceApp: requestContext.sourceApp,
  });
  const hydrated = await repository.getCollectionByAssignment(client, {
    installationId: requestContext.installationId,
    assignmentId,
  });
  return Object.freeze({
    ok: true,
    collection: mapCollection(hydrated ?? inserted),
    payment,
    replayed: false,
  });
}

export function normalizeHandoverPayload(payload, fallbackTime) {
  if (!Array.isArray(payload?.lines) || payload.lines.length < 1 || payload.lines.length > 200) {
    return failure('INVALID_COD_HANDOVER_LINES', 'lines must contain between 1 and 200 collections');
  }
  const ids = new Set();
  const lines = [];
  for (const candidate of payload.lines) {
    const collectionId = text(candidate?.collectionId, 64);
    const amount = decimalToScaled(candidate?.amount);
    if (!isUuid(collectionId) || amount === null || ids.has(collectionId)) {
      return failure('INVALID_COD_HANDOVER_LINE', 'Each handover line requires a unique collectionId and positive amount');
    }
    ids.add(collectionId);
    lines.push(Object.freeze({ collectionId, amount }));
  }
  lines.sort((left, right) => left.collectionId.localeCompare(right.collectionId));
  const excessAmount = payload?.unattributedExcessAmount == null || payload.unattributedExcessAmount === ''
    ? 0n : decimalToScaled(payload.unattributedExcessAmount, { allowZero: true });
  if (excessAmount === null) {
    return failure('INVALID_COD_HANDOVER_EXCESS', 'unattributedExcessAmount is invalid');
  }
  const reason = payload?.reason == null || payload.reason === '' ? null : text(payload.reason, 2000);
  const note = payload?.note == null || payload.note === '' ? null : text(payload.note, 2000);
  const handedOverAt = timestamp(payload?.handedOverAt, fallbackTime);
  if (!handedOverAt) return failure('INVALID_COD_HANDOVER_TIME', 'handedOverAt must be a valid timestamp');
  if (payload?.reason && !reason) return failure('INVALID_COD_HANDOVER_REASON', 'reason must not exceed 2000 characters');
  if (payload?.note && !note) return failure('INVALID_COD_HANDOVER_NOTE', 'note must not exceed 2000 characters');
  return Object.freeze({ ok: true, normalized: Object.freeze({ lines: Object.freeze(lines), excessAmount, reason, note, handedOverAt }) });
}

export async function createCodHandover(client, {
  requestContext,
  tripId,
  payload,
  idempotencyKey,
}) {
  if (!isUuid(tripId)) return failure('INVALID_TRIP_ID', 'Trip id is invalid');
  if (!IDEMPOTENCY_PATTERN.test(String(idempotencyKey ?? ''))) {
    return failure('INVALID_IDEMPOTENCY_KEY', 'Idempotency key must use 1-128 safe characters');
  }
  const parsed = normalizeHandoverPayload(payload, requestContext.receivedAt);
  if (!parsed.ok) return parsed;
  const canonicalPayload = Object.freeze({ tripId, ...parsed.normalized });
  const hash = payloadHash(canonicalPayload);
  const identity = await resolveDriver(client, requestContext, 'core.cod-handover.create');
  if (!identity.ok) return identity;
  await repository.setCodWriteContext(client);
  await repository.lockCodKey(client, `cod-handover:${requestContext.installationId}:${tripId}`);
  const trip = await repository.getDriverTrip(client, {
    installationId: requestContext.installationId,
    tripId,
    driverProfileId: identity.driver.id,
    warehouseIds: identity.warehouseIds,
    forUpdate: true,
  });
  if (!trip) return failure('DELIVERY_TRIP_NOT_FOUND', 'Delivery trip was not found');

  const keyed = await repository.getHandoverByIdempotencyKey(client, {
    installationId: requestContext.installationId,
    idempotencyKey,
  });
  if (keyed) {
    if (keyed.trip_id !== tripId || keyed.payload_hash !== hash) {
      return failure('IDEMPOTENCY_PAYLOAD_MISMATCH', 'Idempotency key was used with another handover payload');
    }
    const rows = await repository.listDriverHandovers(client, {
      installationId: requestContext.installationId,
      tripId,
      driverProfileId: identity.driver.id,
    });
    return Object.freeze({ ok: true, handover: mapHandover(rows.find((row) => row.id === keyed.id) ?? keyed), replayed: true });
  }

  const sourceRows = await repository.getCashCollectionsForHandover(client, {
    installationId: requestContext.installationId,
    tripId,
    driverProfileId: identity.driver.id,
    collectionIds: parsed.normalized.lines.map((line) => line.collectionId),
  });
  if (sourceRows.length !== parsed.normalized.lines.length) {
    return failure('COD_HANDOVER_COLLECTION_NOT_FOUND', 'A cash collection was not found in this trip');
  }
  const sourceMap = new Map(sourceRows.map((row) => [row.id, row]));
  let expectedTotal = 0n;
  let handedTotal = 0n;
  const lineValues = [];
  for (const line of parsed.normalized.lines) {
    const source = sourceMap.get(line.collectionId);
    if (!source || source.reversal_id) return failure('COD_HANDOVER_COLLECTION_REVERSED', 'A collection is reversed');
    const available = decimalToScaled(source.custody_remaining_amount, { allowZero: true });
    if (available === null || available <= 0n) {
      return failure('COD_CUSTODY_EMPTY', 'A collection has no cash remaining with the driver');
    }
    if (line.amount > available) {
      return failure('COD_HANDOVER_EXCEEDS_CUSTODY', 'Handover amount exceeds driver cash custody');
    }
    expectedTotal += available;
    handedTotal += line.amount;
    lineValues.push(Object.freeze({ collectionId: line.collectionId, expectedAmount: available, handedOverAmount: line.amount }));
  }
  const difference = handedTotal + parsed.normalized.excessAmount - expectedTotal;
  if (difference !== 0n && !parsed.normalized.reason) {
    return failure('COD_HANDOVER_DIFFERENCE_REASON_REQUIRED', 'A reason is required for short, partial or excess handover');
  }
  const handoverId = randomUUID();
  const inserted = await repository.insertHandover(client, {
    id: handoverId,
    installationId: requestContext.installationId,
    warehouseId: trip.warehouse_id,
    tripId,
    driverProfileId: identity.driver.id,
    expectedTotal: scaledToDecimal(expectedTotal),
    handedOverTotal: scaledToDecimal(handedTotal),
    unattributedExcessAmount: scaledToDecimal(parsed.normalized.excessAmount),
    differenceAmount: scaledToDecimal(difference),
    reason: parsed.normalized.reason,
    note: parsed.normalized.note,
    handedOverAt: parsed.normalized.handedOverAt,
    idempotencyKey,
    payloadHash: hash,
    actorId: requestContext.actorId,
    requestId: requestContext.requestId,
    sourceApp: requestContext.sourceApp,
  });
  for (const line of lineValues) {
    await repository.insertHandoverLine(client, {
      id: randomUUID(),
      installationId: requestContext.installationId,
      handoverId,
      collectionId: line.collectionId,
      expectedAmount: scaledToDecimal(line.expectedAmount),
      handedOverAmount: scaledToDecimal(line.handedOverAmount),
      actorId: requestContext.actorId,
    });
  }
  const rows = await repository.listDriverHandovers(client, {
    installationId: requestContext.installationId,
    tripId,
    driverProfileId: identity.driver.id,
  });
  return Object.freeze({ ok: true, handover: mapHandover(rows.find((row) => row.id === handoverId) ?? inserted), replayed: false });
}

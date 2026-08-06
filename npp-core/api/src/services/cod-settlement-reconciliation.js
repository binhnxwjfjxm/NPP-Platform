import { randomUUID } from 'node:crypto';
import * as repository from '../db/repositories/cod-settlement.js';
import {
  getCustomerPayment,
  reverseCustomerPayment,
  reverseReceivableAllocation,
} from './customer-payment.js';
import {
  HANDOVER_STATUSES,
  IDEMPOTENCY_PATTERN,
  decimalToScaled,
  failure,
  isUuid,
  mapCollection,
  mapHandover,
  payloadHash,
  scaledToDecimal,
  text,
  timestamp,
  warehouseIds,
} from './cod-settlement-shared.js';

export async function listCodHandovers(client, input) {
  const scopes = warehouseIds(input.requestContext);
  if (!scopes.length) return failure('WAREHOUSE_SCOPE_DENIED', 'At least one authorized warehouse is required');
  const limit = Number(input.limit ?? 100);
  const offset = Number(input.offset ?? 0);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) return failure('INVALID_LIMIT', 'limit must be between 1 and 1000');
  if (!Number.isInteger(offset) || offset < 0 || offset > 100000) return failure('INVALID_OFFSET', 'offset is invalid');
  const status = input.status ? String(input.status).trim() : null;
  if (status && !HANDOVER_STATUSES.has(status)) return failure('INVALID_COD_HANDOVER_STATUS', 'status is invalid');
  const rows = await repository.listHandovers(client, {
    installationId: input.requestContext.installationId,
    warehouseIds: scopes,
    status,
    limit,
    offset,
  });
  return Object.freeze({ ok: true, handovers: Object.freeze(rows.map(mapHandover)) });
}

export async function getCodHandover(client, { requestContext, handoverId }) {
  if (!isUuid(handoverId)) return failure('COD_HANDOVER_NOT_FOUND', 'COD handover was not found');
  const scopes = warehouseIds(requestContext);
  if (!scopes.length) return failure('WAREHOUSE_SCOPE_DENIED', 'At least one authorized warehouse is required');
  const row = await repository.getHandover(client, {
    installationId: requestContext.installationId,
    handoverId,
    warehouseIds: scopes,
  });
  return row ? Object.freeze({ ok: true, handover: mapHandover(row) }) : failure('COD_HANDOVER_NOT_FOUND', 'COD handover was not found');
}

export async function acceptCodHandover(client, {
  requestContext,
  handoverId,
  payload,
  idempotencyKey,
}) {
  if (!isUuid(handoverId)) return failure('COD_HANDOVER_NOT_FOUND', 'COD handover was not found');
  if (!IDEMPOTENCY_PATTERN.test(String(idempotencyKey ?? ''))) {
    return failure('INVALID_IDEMPOTENCY_KEY', 'Idempotency key must use 1-128 safe characters');
  }
  const acceptedAmount = decimalToScaled(payload?.acceptedAmount, { allowZero: true });
  if (acceptedAmount === null) return failure('INVALID_COD_ACCEPTED_AMOUNT', 'acceptedAmount is invalid');
  const acceptedAt = timestamp(payload?.acceptedAt, requestContext.receivedAt);
  if (!acceptedAt) return failure('INVALID_COD_ACCEPTANCE_TIME', 'acceptedAt must be a valid timestamp');
  const reason = payload?.reason == null || payload.reason === '' ? null : text(payload.reason, 2000);
  const note = payload?.note == null || payload.note === '' ? null : text(payload.note, 2000);
  if (payload?.reason && !reason) return failure('INVALID_COD_ACCEPTANCE_REASON', 'reason must not exceed 2000 characters');
  if (payload?.note && !note) return failure('INVALID_COD_ACCEPTANCE_NOTE', 'note must not exceed 2000 characters');
  const canonicalPayload = Object.freeze({ handoverId, acceptedAmount, acceptedAt, reason, note });
  const hash = payloadHash(canonicalPayload);
  const scopes = warehouseIds(requestContext);
  if (!scopes.length) return failure('WAREHOUSE_SCOPE_DENIED', 'At least one authorized warehouse is required');
  await repository.setCodWriteContext(client);
  await repository.lockCodKey(client, `cod-acceptance:${requestContext.installationId}:${handoverId}`);
  const handover = await repository.getHandover(client, {
    installationId: requestContext.installationId,
    handoverId,
    warehouseIds: scopes,
  });
  if (!handover) return failure('COD_HANDOVER_NOT_FOUND', 'COD handover was not found');
  if (handover.reversal_id) return failure('COD_HANDOVER_REVERSED', 'A reversed handover cannot be accepted');
  const keyed = await repository.getAcceptanceByIdempotencyKey(client, {
    installationId: requestContext.installationId,
    idempotencyKey,
  });
  if (keyed) {
    if (keyed.handover_id !== handoverId || keyed.payload_hash !== hash) {
      return failure('IDEMPOTENCY_PAYLOAD_MISMATCH', 'Idempotency key was used with another acceptance payload');
    }
    const replay = await repository.getHandover(client, {
      installationId: requestContext.installationId,
      handoverId,
      warehouseIds: scopes,
    });
    return Object.freeze({ ok: true, handover: mapHandover(replay), replayed: true });
  }
  if (handover.acceptance_id && !handover.acceptance_reversal_id) {
    return failure('COD_HANDOVER_ALREADY_ACCEPTED', 'COD handover was already accepted');
  }
  if (handover.acceptance_id && handover.acceptance_reversal_id) {
    return failure('COD_ACCEPTANCE_REVERSED', 'Reverse the handover and create a new handover after an acceptance reversal');
  }
  const claimed = decimalToScaled(handover.handed_over_total, { allowZero: true })
    + decimalToScaled(handover.unattributed_excess_amount, { allowZero: true });
  const difference = acceptedAmount - claimed;
  if (difference !== 0n && !reason) return failure('COD_ACCEPTANCE_DIFFERENCE_REASON_REQUIRED', 'A reason is required for acceptance discrepancy');
  const inserted = await repository.insertAcceptance(client, {
    id: randomUUID(),
    installationId: requestContext.installationId,
    handoverId,
    acceptedAmount: scaledToDecimal(acceptedAmount),
    differenceAmount: scaledToDecimal(difference),
    reconciliationStatus: difference === 0n ? 'reconciled' : 'discrepancy',
    reason,
    note,
    acceptedAt,
    idempotencyKey,
    payloadHash: hash,
    actorId: requestContext.actorId,
    requestId: requestContext.requestId,
    sourceApp: requestContext.sourceApp,
  });
  const hydrated = await repository.getHandover(client, {
    installationId: requestContext.installationId,
    handoverId,
    warehouseIds: scopes,
  });
  return Object.freeze({ ok: true, handover: mapHandover(hydrated ?? { ...handover, acceptance_id: inserted.id }), replayed: false });
}

export async function reverseCodCollection(client, { requestContext, collectionId, payload }) {
  if (!isUuid(collectionId)) return failure('COD_COLLECTION_NOT_FOUND', 'COD collection was not found');
  const reason = text(payload?.reason, 2000);
  if (!reason) return failure('COD_REVERSAL_REASON_REQUIRED', 'A reversal reason is required');
  const scopes = warehouseIds(requestContext);
  await repository.setCodWriteContext(client);
  await repository.lockCodKey(client, `cod-collection-reverse:${requestContext.installationId}:${collectionId}`);
  const collection = await repository.getCollectionForReversal(client, {
    installationId: requestContext.installationId,
    collectionId,
    warehouseIds: scopes,
  });
  if (!collection) return failure('COD_COLLECTION_NOT_FOUND', 'COD collection was not found');
  if (collection.reversal_id) return Object.freeze({ ok: true, collection: mapCollection(collection), replayed: true });
  if (await repository.countActiveHandoverLinesForCollection(client, {
    installationId: requestContext.installationId,
    collectionId,
  })) {
    return failure('COD_COLLECTION_HANDOVER_EXISTS', 'Reverse active handovers before reversing this collection');
  }
  const paymentEvents = [];
  if (collection.payment_document_id) {
    const paymentResult = await getCustomerPayment(client, {
      requestContext,
      id: collection.payment_document_id,
    });
    if (!paymentResult.ok) return paymentResult;
    for (const allocation of paymentResult.customerPayment.allocations.filter((item) => !item.reversed)) {
      const reversedAllocation = await reverseReceivableAllocation(client, {
        requestContext,
        id: allocation.id,
        payload: { reason: `Đảo COD: ${reason}` },
      });
      if (!reversedAllocation.ok) return reversedAllocation;
      paymentEvents.push(reversedAllocation.allocation);
    }
    const reversedPayment = await reverseCustomerPayment(client, {
      requestContext,
      id: collection.payment_document_id,
      payload: { reason: `Đảo COD: ${reason}` },
    });
    if (!reversedPayment.ok) return reversedPayment;
    paymentEvents.push(reversedPayment.customerPayment);
  }
  const reversal = await repository.insertCollectionReversal(client, {
    id: randomUUID(),
    installationId: requestContext.installationId,
    collectionId,
    reason,
    actorId: requestContext.actorId,
    requestId: requestContext.requestId,
    sourceApp: requestContext.sourceApp,
    reversedAt: requestContext.receivedAt,
    metadata: { paymentDocumentId: collection.payment_document_id },
  });
  return Object.freeze({ ok: true, collection: Object.freeze({ ...mapCollection(collection), reversed: true, reversalId: reversal.id, reversalReason: reason }), paymentEvents, replayed: false });
}

export async function reverseCodHandover(client, { requestContext, handoverId, payload }) {
  if (!isUuid(handoverId)) return failure('COD_HANDOVER_NOT_FOUND', 'COD handover was not found');
  const reason = text(payload?.reason, 2000);
  if (!reason) return failure('COD_REVERSAL_REASON_REQUIRED', 'A reversal reason is required');
  const scopes = warehouseIds(requestContext);
  await repository.setCodWriteContext(client);
  await repository.lockCodKey(client, `cod-handover-reverse:${requestContext.installationId}:${handoverId}`);
  const handover = await repository.getHandover(client, {
    installationId: requestContext.installationId,
    handoverId,
    warehouseIds: scopes,
  });
  if (!handover) return failure('COD_HANDOVER_NOT_FOUND', 'COD handover was not found');
  if (handover.reversal_id) return Object.freeze({ ok: true, handover: mapHandover(handover), replayed: true });
  if (handover.acceptance_id && !handover.acceptance_reversal_id) {
    return failure('COD_HANDOVER_ACCEPTANCE_EXISTS', 'Reverse the active acceptance before reversing this handover');
  }
  const reversal = await repository.insertHandoverReversal(client, {
    id: randomUUID(),
    installationId: requestContext.installationId,
    handoverId,
    reason,
    actorId: requestContext.actorId,
    requestId: requestContext.requestId,
    sourceApp: requestContext.sourceApp,
    reversedAt: requestContext.receivedAt,
    metadata: { tripId: handover.trip_id },
  });
  return Object.freeze({ ok: true, handover: Object.freeze({ ...mapHandover(handover), status: 'reversed', reversalId: reversal.id, reversalReason: reason }), replayed: false });
}

export async function reverseCodAcceptance(client, { requestContext, acceptanceId, payload }) {
  if (!isUuid(acceptanceId)) return failure('COD_ACCEPTANCE_NOT_FOUND', 'COD acceptance was not found');
  const reason = text(payload?.reason, 2000);
  if (!reason) return failure('COD_REVERSAL_REASON_REQUIRED', 'A reversal reason is required');
  const scopes = warehouseIds(requestContext);
  await repository.setCodWriteContext(client);
  await repository.lockCodKey(client, `cod-acceptance-reverse:${requestContext.installationId}:${acceptanceId}`);
  const acceptance = await repository.getAcceptanceForReversal(client, {
    installationId: requestContext.installationId,
    acceptanceId,
    warehouseIds: scopes,
  });
  if (!acceptance) return failure('COD_ACCEPTANCE_NOT_FOUND', 'COD acceptance was not found');
  if (acceptance.reversal_id) return Object.freeze({ ok: true, acceptance: Object.freeze({ id: acceptance.id, reversed: true, reversalId: acceptance.reversal_id }), replayed: true });
  if (acceptance.handover_reversal_id) return failure('COD_HANDOVER_REVERSED', 'The handover is already reversed');
  const reversal = await repository.insertAcceptanceReversal(client, {
    id: randomUUID(),
    installationId: requestContext.installationId,
    acceptanceId,
    reason,
    actorId: requestContext.actorId,
    requestId: requestContext.requestId,
    sourceApp: requestContext.sourceApp,
    reversedAt: requestContext.receivedAt,
    metadata: { handoverId: acceptance.handover_id, tripId: acceptance.trip_id },
  });
  return Object.freeze({ ok: true, acceptance: Object.freeze({ id: acceptance.id, handoverId: acceptance.handover_id, reversed: true, reversalId: reversal.id, reversalReason: reason }), replayed: false });
}

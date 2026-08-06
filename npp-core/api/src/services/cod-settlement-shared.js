import { createHash } from 'node:crypto';
import * as repository from '../db/repositories/cod-settlement.js';
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
export const DECIMAL_PATTERN = /^(0|[1-9]\d{0,13})(?:\.(\d{1,6}))?$/;
export const REASON_CODE_PATTERN = /^[A-Z0-9][A-Z0-9._-]{0,63}$/;
export const SCALE = 1_000_000n;
export const COLLECTION_METHODS = new Set(['CASH', 'BANK_TRANSFER', 'NONE']);
export const HANDOVER_STATUSES = new Set(['submitted', 'reconciled', 'discrepancy', 'reversed', 'acceptance_reversed']);

export function failure(code, message, retryable = false, details = {}) {
  return Object.freeze({ ok: false, code, message, retryable, details });
}

export function isUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value.trim());
}

export function text(value, max) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized && normalized.length <= max ? normalized : null;
}

export function timestamp(value, fallback = null) {
  const normalized = text(value, 64);
  if (!normalized) return fallback;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function decimalToScaled(value, { allowZero = false } = {}) {
  const match = DECIMAL_PATTERN.exec(String(value ?? '').trim());
  if (!match) return null;
  const scaled = BigInt(match[1]) * SCALE + BigInt((match[2] ?? '').padEnd(6, '0'));
  if (scaled < 0n || (!allowZero && scaled <= 0n)) return null;
  return scaled;
}

export function scaledToDecimal(value) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / SCALE;
  const fraction = String(absolute % SCALE).padStart(6, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

export function canonicalize(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

export function payloadHash(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

export function warehouseIds(requestContext) {
  return Array.isArray(requestContext?.scopes?.warehouseIds)
    ? [...new Set(requestContext.scopes.warehouseIds.filter(isUuid).map((value) => value.trim()))]
    : [];
}

export function hasPermission(requestContext, permission) {
  return Array.isArray(requestContext?.permissions) && requestContext.permissions.includes(permission);
}

export function dateInHoChiMinh(isoTimestamp) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(isoTimestamp));
}

export function mapCollection(row) {
  if (!row) return null;
  return Object.freeze({
    id: row.id,
    warehouseId: row.warehouse_id,
    tripId: row.trip_id,
    stopId: row.trip_stop_id,
    assignmentId: row.assignment_id,
    deliveryAttemptId: row.delivery_attempt_id,
    deliveryOrderId: row.delivery_order_id,
    customerId: row.customer_id,
    sourceReceivableDocumentId: row.source_receivable_document_id,
    paymentDocumentId: row.payment_document_id ?? null,
    paymentDocumentNumber: row.payment_document_number ?? null,
    collectionMethod: row.collection_method,
    collectionStatus: row.collection_status,
    currencyCode: row.currency_code,
    expectedAmount: String(row.expected_amount),
    receivedAmount: String(row.received_amount),
    handedOverAmount: String(row.handed_over_amount ?? '0'),
    custodyRemainingAmount: String(row.custody_remaining_amount ?? '0'),
    externalReference: row.external_reference ?? null,
    reasonCode: row.reason_code ?? null,
    promisedBy: row.promised_by ?? null,
    dueAt: row.due_at ?? null,
    note: row.note ?? null,
    collectedAt: row.collected_at,
    driverProfileId: row.driver_profile_id,
    reversed: Boolean(row.reversal_id),
    reversalId: row.reversal_id ?? null,
    reversalReason: row.reversal_reason ?? null,
    reversedAt: row.reversed_at ?? null,
  });
}

export function mapAssignment(row) {
  return Object.freeze({
    assignmentId: row.assignment_id,
    stopId: row.trip_stop_id,
    stopSequence: Number(row.stop_sequence),
    deliveryOrderId: row.delivery_order_id,
    deliveryOrderNumber: row.delivery_order_number,
    customerId: row.customer_id,
    customerCode: row.customer_code_snapshot,
    customerName: row.customer_name_snapshot,
    collectionPolicy: row.collection_policy,
    deliveryAttemptId: row.delivery_attempt_id ?? null,
    deliveryAttemptResult: row.delivery_attempt_result ?? null,
    receivableDocumentId: row.receivable_document_id ?? null,
    receivableDocumentNumber: row.receivable_document_number ?? null,
    currencyCode: row.currency_code ?? null,
    amountDue: row.current_receivable_remaining_amount == null
      ? null
      : String(row.current_receivable_remaining_amount),
    collection: row.collection_id ? mapCollection({
      id: row.collection_id,
      warehouse_id: undefined,
      trip_id: undefined,
      trip_stop_id: row.trip_stop_id,
      assignment_id: row.assignment_id,
      delivery_attempt_id: row.delivery_attempt_id,
      delivery_order_id: row.delivery_order_id,
      customer_id: row.customer_id,
      source_receivable_document_id: row.receivable_document_id,
      payment_document_id: row.payment_document_id,
      payment_document_number: row.payment_document_number,
      collection_method: row.collection_method,
      collection_status: row.collection_status,
      currency_code: row.currency_code,
      expected_amount: row.expected_amount,
      received_amount: row.received_amount,
      handed_over_amount: row.handed_over_amount,
      custody_remaining_amount: row.custody_remaining_amount,
      external_reference: row.external_reference,
      reason_code: row.reason_code,
      promised_by: row.promised_by,
      due_at: row.due_at,
      note: row.note,
      collected_at: row.collected_at,
      driver_profile_id: undefined,
      reversal_id: row.collection_reversal_id,
      reversal_reason: row.collection_reversal_reason,
      reversed_at: row.collection_reversed_at,
    }) : null,
  });
}

export function mapHandover(row) {
  return Object.freeze({
    id: row.id,
    warehouseId: row.warehouse_id,
    warehouseCode: row.warehouse_code ?? null,
    warehouseName: row.warehouse_name ?? null,
    tripId: row.trip_id,
    tripNumber: row.trip_number ?? null,
    driverProfileId: row.driver_profile_id,
    driverCode: row.driver_code ?? null,
    driverName: row.driver_name ?? null,
    expectedTotal: String(row.expected_total),
    handedOverTotal: String(row.handed_over_total),
    unattributedExcessAmount: String(row.unattributed_excess_amount),
    differenceAmount: String(row.difference_amount),
    reason: row.reason ?? null,
    note: row.note ?? null,
    handedOverAt: row.handed_over_at,
    status: row.projection_status ?? 'submitted',
    reversalId: row.reversal_id ?? null,
    reversalReason: row.reversal_reason ?? null,
    reversedAt: row.reversed_at ?? null,
    acceptance: row.acceptance_id ? Object.freeze({
      id: row.acceptance_id,
      acceptedAmount: String(row.accepted_amount),
      differenceAmount: String(row.acceptance_difference_amount),
      reconciliationStatus: row.reconciliation_status,
      reason: row.acceptance_reason ?? null,
      note: row.acceptance_note ?? null,
      acceptedAt: row.accepted_at,
      reversalId: row.acceptance_reversal_id ?? null,
    }) : null,
    lines: Object.freeze((row.lines ?? []).map((line) => Object.freeze({
      id: line.id,
      collectionId: line.collectionId,
      expectedAmount: String(line.expectedAmount),
      handedOverAmount: String(line.handedOverAmount),
      customerId: line.customerId ?? null,
      customerCode: line.customerCode ?? null,
      customerName: line.customerName ?? null,
      deliveryOrderId: line.deliveryOrderId ?? null,
      deliveryOrderNumber: line.deliveryOrderNumber ?? null,
      paymentDocumentId: line.paymentDocumentId ?? null,
    }))),
  });
}

export async function resolveDriver(client, requestContext, permission) {
  if (!hasPermission(requestContext, 'core.delivery-trip.driver-read')) {
    return failure('PERMISSION_DENIED', 'Permission core.delivery-trip.driver-read is required');
  }
  if (!hasPermission(requestContext, permission)) {
    return failure('PERMISSION_DENIED', `Permission ${permission} is required`);
  }
  if (!isUuid(requestContext?.employeeId)) {
    return failure('DELIVERY_DRIVER_IDENTITY_REQUIRED', 'A trusted employee identity is required');
  }
  const scopes = warehouseIds(requestContext);
  if (!scopes.length) return failure('WAREHOUSE_SCOPE_DENIED', 'Driver has no authorized warehouse scope');
  const driver = await repository.getActiveDriverByEmployee(client, {
    installationId: requestContext.installationId,
    employeeId: requestContext.employeeId,
  });
  return driver
    ? Object.freeze({ ok: true, driver, warehouseIds: Object.freeze(scopes) })
    : failure('DELIVERY_DRIVER_PROFILE_NOT_FOUND', 'Active driver profile was not found');
}

export function normalizeCollectionPayload(payload, fallbackTime) {
  const method = String(payload?.collectionMethod ?? '').trim().toUpperCase();
  if (!COLLECTION_METHODS.has(method)) {
    return failure('INVALID_COD_COLLECTION_METHOD', 'collectionMethod must be CASH, BANK_TRANSFER or NONE');
  }
  const collectedAt = timestamp(payload?.collectedAt, fallbackTime);
  if (!collectedAt) return failure('INVALID_COD_COLLECTION_TIME', 'collectedAt must be a valid timestamp');
  const note = payload?.note == null || payload.note === '' ? null : text(payload.note, 2000);
  if (payload?.note && !note) return failure('INVALID_COD_NOTE', 'note must not exceed 2000 characters');
  const rawReason = payload?.reasonCode == null ? null : String(payload.reasonCode).trim().toUpperCase();
  const reasonCode = rawReason && REASON_CODE_PATTERN.test(rawReason) ? rawReason : null;
  if (rawReason && !reasonCode) return failure('INVALID_COD_REASON_CODE', 'reasonCode is invalid');
  const externalReference = payload?.externalReference == null || payload.externalReference === ''
    ? null : text(payload.externalReference, 256);
  if (payload?.externalReference && !externalReference) {
    return failure('INVALID_COD_EXTERNAL_REFERENCE', 'externalReference must not exceed 256 characters');
  }
  const promisedBy = payload?.promisedBy == null || payload.promisedBy === ''
    ? null : text(payload.promisedBy, 256);
  const dueAt = payload?.dueAt == null || payload.dueAt === '' ? null : timestamp(payload.dueAt);
  const receivedAmount = method === 'NONE'
    ? 0n
    : decimalToScaled(payload?.receivedAmount);
  if (receivedAmount === null) {
    return failure('INVALID_COD_RECEIVED_AMOUNT', 'receivedAmount must be a positive decimal with at most six fractional digits');
  }
  if (method === 'BANK_TRANSFER' && !externalReference) {
    return failure('COD_BANK_REFERENCE_REQUIRED', 'Bank transfer reference is required');
  }
  if (method === 'NONE' && (!reasonCode || !promisedBy || !dueAt)) {
    return failure('COD_PROMISE_DETAILS_REQUIRED', 'Not-collected COD requires reasonCode, promisedBy and dueAt');
  }
  if (method !== 'NONE' && (promisedBy || dueAt)) {
    return failure('COD_COLLECTION_SHAPE_INVALID', 'Collected COD cannot include promise fields');
  }
  return Object.freeze({
    ok: true,
    normalized: Object.freeze({
      collectionMethod: method,
      receivedAmount,
      externalReference,
      reasonCode,
      promisedBy,
      dueAt,
      note,
      collectedAt,
    }),
  });
}

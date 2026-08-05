import { createHash, randomUUID } from 'node:crypto';
import * as repository from '../db/repositories/customer-return-credit.js';
import * as documentNumberRepository from '../db/repositories/document-numbering.js';
import { allocateDocumentNumber } from './document-numbering.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL_PATTERN = /^(0|[1-9]\d{0,13})(?:\.(\d{1,6}))?$/;
const CODE_PATTERN = /^[A-Z0-9_.-]{1,64}$/;
const SCALE = 1_000_000n;
const REFUND_SERIES_CODE = 'CUSTOMER_REFUND';
const CREDIT_STATUSES = new Set(['open', 'partially_allocated', 'settled', 'reversed']);

function failure(code, message, retryable = false, details = {}) {
  return Object.freeze({ ok: false, code, message, retryable, details });
}

function text(value, max = 0) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  if (!normalized || (max > 0 && normalized.length > max)) return null;
  return normalized;
}

function isUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value.trim());
}

function dateOnly(value) {
  const normalized = text(value, 10);
  if (!normalized || !DATE_PATTERN.test(normalized)) return null;
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized
    ? null
    : normalized;
}

function timestamp(value, fallback = new Date().toISOString()) {
  const parsed = new Date(String(value ?? ''));
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function decimalToScaled(value, { allowZero = false } = {}) {
  const match = DECIMAL_PATTERN.exec(String(value ?? '').trim());
  if (!match) return null;
  const scaled = BigInt(match[1]) * SCALE + BigInt((match[2] ?? '').padEnd(6, '0'));
  if ((!allowZero && scaled <= 0n) || scaled < 0n) return null;
  return scaled;
}

function scaledToDecimal(value) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return `${negative ? '-' : ''}${absolute / SCALE}.${String(absolute % SCALE).padStart(6, '0')}`;
}

function warehouseScopeIds(requestContext) {
  return Array.isArray(requestContext?.scopes?.warehouseIds)
    ? [...new Set(requestContext.scopes.warehouseIds.filter(isUuid).map((value) => value.trim()))]
    : [];
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function payloadHash(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function normalizePagination(limit, offset) {
  const parsedLimit = Number(limit ?? 100);
  const parsedOffset = Number(offset ?? 0);
  if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 1000) {
    return failure('INVALID_LIMIT', 'limit must be between 1 and 1000');
  }
  if (!Number.isInteger(parsedOffset) || parsedOffset < 0 || parsedOffset > 100000) {
    return failure('INVALID_OFFSET', 'offset must be between 0 and 100000');
  }
  return { ok: true, limit: parsedLimit, offset: parsedOffset };
}

function mapLedger(row) {
  return Object.freeze({
    id: row.id,
    entryType: row.entry_type,
    amount: String(row.amount),
    actorId: row.actor_id,
    requestId: row.request_id,
    sourceApp: row.source_app,
    occurredAt: timestamp(row.occurred_at),
    metadata: row.metadata ?? {},
  });
}

function mapAllocation(row) {
  return Object.freeze({
    id: row.id,
    sourceReceivableDocumentId: row.source_receivable_document_id,
    sourceDocumentNumber: row.source_document_number ?? null,
    sourceDocumentType: row.source_document_type ?? null,
    sourceWarehouseId: row.source_warehouse_id ?? null,
    targetReceivableDocumentId: row.target_receivable_document_id,
    targetDocumentNumber: row.target_document_number ?? null,
    targetDocumentType: row.target_document_type ?? null,
    targetWarehouseId: row.target_warehouse_id ?? null,
    amount: String(row.amount),
    allocationDate: String(row.allocation_date).slice(0, 10),
    createdAt: timestamp(row.created_at),
    reversed: Boolean(row.reversal_id),
    reversalId: row.reversal_id ?? null,
    reversalReason: row.reversal_reason ?? null,
    reversedAt: row.reversed_at ? timestamp(row.reversed_at) : null,
    metadata: row.metadata ?? {},
  });
}

function mapAdjustmentLine(row) {
  return Object.freeze({
    id: row.id,
    lineNumber: Number(row.line_number),
    customerReturnLineId: row.customer_return_line_id,
    customerReturnReceiptLineId: row.customer_return_receipt_line_id,
    sourceReceivableDocumentId: row.source_receivable_document_id,
    sourceReceivableLineId: row.source_receivable_line_id,
    sourceDocumentNumber: row.source_document_number ?? null,
    sourceDocumentType: row.source_document_type ?? null,
    sku: row.sku ?? null,
    itemName: row.item_name ?? null,
    unitCode: row.unit_code ?? null,
    acceptedBaseQuantity: String(row.accepted_base_quantity),
    adjustmentAmount: String(row.adjustment_amount),
    currencyCode: row.currency_code,
    metadata: row.metadata ?? {},
  });
}

function mapRefund(row) {
  return Object.freeze({
    id: row.id,
    receivableDocumentId: row.receivable_document_id,
    sourceCreditDocumentId: row.source_credit_document_id,
    sourceCreditNumber: row.source_credit_number ?? null,
    sourceCreditType: row.source_credit_type ?? null,
    refundNumber: row.refund_number ?? null,
    customerId: row.customer_id,
    customerCode: row.customer_code ?? null,
    customerName: row.customer_name ?? null,
    warehouseId: row.warehouse_id,
    warehouseCode: row.warehouse_code ?? null,
    warehouseName: row.warehouse_name ?? null,
    currencyCode: row.currency_code,
    amount: String(row.amount),
    refundMethod: row.refund_method,
    destinationReference: row.destination_reference,
    externalReference: row.external_reference ?? null,
    reason: row.reason,
    postedAt: timestamp(row.posted_at),
    status: row.refund_status ?? (row.reversal_id ? 'reversed' : 'posted'),
    reversalId: row.reversal_id ?? null,
    reversalReason: row.reversal_reason ?? null,
    reversedAt: row.reversed_at ? timestamp(row.reversed_at) : null,
    metadata: row.metadata ?? {},
  });
}

function mapCredit(row) {
  return Object.freeze({
    id: row.id,
    customerReturnId: row.customer_return_id,
    returnNumber: row.return_number ?? row.source_document_number,
    customerReturnReceivedAt: row.customer_return_received_at
      ? timestamp(row.customer_return_received_at)
      : null,
    customerId: row.customer_id,
    customerCode: row.customer_code ?? row.customer_code_snapshot ?? null,
    customerName: row.customer_name ?? row.customer_name_snapshot ?? null,
    warehouseId: row.warehouse_id,
    warehouseCode: row.warehouse_code ?? row.warehouse_code_snapshot ?? null,
    warehouseName: row.warehouse_name ?? row.warehouse_name_snapshot ?? null,
    documentNumber: row.source_document_number,
    currencyCode: row.currency_code,
    originalAmount: String(row.original_amount),
    allocatedAmount: String(row.allocated_amount),
    remainingAmount: String(row.remaining_amount),
    status: row.status,
    revision: String(row.revision),
    postedAt: timestamp(row.posted_at),
    postedBy: row.posted_by,
    reversedAt: row.reversed_at ? timestamp(row.reversed_at) : null,
    reversedBy: row.reversed_by ?? null,
    reversalReason: row.reversal_reason ?? null,
    lines: Object.freeze((row.adjustment_lines ?? []).map(mapAdjustmentLine)),
    ledgerEntries: Object.freeze((row.ledger_entries ?? []).map(mapLedger)),
    allocations: Object.freeze((row.allocations ?? []).map(mapAllocation)),
    refunds: Object.freeze((row.refunds ?? []).map(mapRefund)),
  });
}

function mapDatabaseError(error) {
  const message = String(error?.message ?? '');
  const mappings = new Map([
    ['customer_return_credit_not_found', ['CUSTOMER_RETURN_CREDIT_NOT_FOUND', 'Customer Return credit was not found']],
    ['customer_credit_not_found', ['CUSTOMER_CREDIT_NOT_FOUND', 'Customer credit was not found']],
    ['invalid_credit_allocation_source', ['INVALID_CREDIT_ALLOCATION_SOURCE', 'Allocation source must be an active customer credit']],
    ['invalid_credit_allocation_target', ['INVALID_CREDIT_ALLOCATION_TARGET', 'Allocation target must be an open receivable']],
    ['allocation_customer_mismatch', ['ALLOCATION_CUSTOMER_MISMATCH', 'Credit and receivable customer do not match']],
    ['allocation_currency_mismatch', ['ALLOCATION_CURRENCY_MISMATCH', 'Credit and receivable currency do not match']],
    ['allocation_exceeds_source_remaining', ['ALLOCATION_EXCEEDS_SOURCE', 'Allocation exceeds available customer credit']],
    ['allocation_exceeds_target_remaining', ['ALLOCATION_EXCEEDS_TARGET', 'Allocation exceeds receivable remaining amount']],
    ['invalid_refund_source_credit', ['INVALID_REFUND_SOURCE_CREDIT', 'Refund source must be active unapplied customer credit']],
    ['refund_exceeds_available_credit', ['REFUND_EXCEEDS_AVAILABLE_CREDIT', 'Refund exceeds available customer credit']],
    ['customer_refund_not_found', ['CUSTOMER_REFUND_NOT_FOUND', 'Customer refund was not found']],
    ['customer_refund_idempotency_payload_mismatch', ['IDEMPOTENCY_PAYLOAD_MISMATCH', 'Refund key was used with another payload']],
    ['customer_return_credit_has_active_refund', ['CUSTOMER_RETURN_CREDIT_HAS_ACTIVE_REFUND', 'Reverse active refunds before reversing the return credit']],
    ['customer_refund_allocation_not_found', ['CUSTOMER_REFUND_ALLOCATION_NOT_FOUND', 'Refund allocation was not found']],
  ]);
  for (const [needle, [code, messageText]] of mappings) {
    if (message.includes(needle)) return failure(code, messageText, code.includes('EXCEEDS'));
  }
  return null;
}

function normalizeAllocationItems(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    return failure('INVALID_ALLOCATIONS', 'allocations must contain between 1 and 100 rows');
  }
  const seen = new Set();
  const items = [];
  for (const candidate of value) {
    const targetDocumentId = text(candidate?.receivableDocumentId, 64);
    const amount = decimalToScaled(candidate?.amount);
    if (!isUuid(targetDocumentId)) {
      return failure('INVALID_TARGET_DOCUMENT_ID', 'Each receivableDocumentId must be a valid UUID');
    }
    if (seen.has(targetDocumentId)) {
      return failure('DUPLICATE_ALLOCATION_TARGET', 'A receivable target may only appear once');
    }
    if (amount === null) {
      return failure('INVALID_ALLOCATION_AMOUNT', 'Each allocation amount must be a positive decimal with at most six fractional digits');
    }
    seen.add(targetDocumentId);
    items.push({ targetDocumentId, amount });
  }
  items.sort((left, right) => left.targetDocumentId.localeCompare(right.targetDocumentId));
  return { ok: true, items };
}

export async function listCustomerReturnCredits(client, {
  requestContext,
  customerId = null,
  warehouseId = null,
  status = null,
  currencyCode = null,
  search = null,
  limit = 100,
  offset = 0,
}) {
  const pagination = normalizePagination(limit, offset);
  if (!pagination.ok) return pagination;
  const scopes = warehouseScopeIds(requestContext);
  if (scopes.length === 0) return failure('WAREHOUSE_SCOPE_DENIED', 'At least one warehouse scope is required');
  if (customerId && !isUuid(customerId)) return failure('INVALID_CUSTOMER_ID', 'customerId is invalid');
  if (warehouseId && (!isUuid(warehouseId) || !scopes.includes(warehouseId))) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Warehouse is outside the authorized scope');
  }
  if (status && !CREDIT_STATUSES.has(status)) return failure('INVALID_STATUS', 'status is invalid');
  const currency = currencyCode ? text(currencyCode, 3)?.toUpperCase() : null;
  if (currencyCode && !/^[A-Z]{3}$/.test(currency ?? '')) return failure('INVALID_CURRENCY_CODE', 'currencyCode is invalid');
  const normalizedSearch = search ? text(search, 256) : null;
  const rows = await repository.listCustomerReturnCredits(client, {
    installationId: requestContext.installationId,
    warehouseIds: scopes,
    customerId: customerId || null,
    warehouseId: warehouseId || null,
    status: status || null,
    currencyCode: currency,
    search: normalizedSearch,
    limit: pagination.limit,
    offset: pagination.offset,
  });
  return Object.freeze({ ok: true, customerReturnCredits: Object.freeze(rows.map(mapCredit)) });
}

export async function getCustomerReturnCredit(client, { requestContext, id }) {
  if (!isUuid(id)) return failure('INVALID_CUSTOMER_RETURN_CREDIT_ID', 'Customer Return credit id is invalid');
  const credit = await repository.getCustomerReturnCreditById(client, {
    installationId: requestContext.installationId,
    id,
    warehouseIds: warehouseScopeIds(requestContext),
  });
  return credit
    ? Object.freeze({ ok: true, customerReturnCredit: mapCredit(credit) })
    : failure('CUSTOMER_RETURN_CREDIT_NOT_FOUND', 'Customer Return credit was not found');
}

export async function allocateCustomerReturnCredit(client, {
  requestContext,
  id,
  payload,
}) {
  if (!isUuid(id)) return failure('INVALID_CUSTOMER_RETURN_CREDIT_ID', 'Customer Return credit id is invalid');
  const allocationDate = dateOnly(payload?.allocationDate);
  if (!allocationDate) return failure('INVALID_ALLOCATION_DATE', 'allocationDate must be a valid YYYY-MM-DD date');
  const normalized = normalizeAllocationItems(payload?.allocations);
  if (!normalized.ok) return normalized;
  const scopes = warehouseScopeIds(requestContext);
  const source = await repository.getCustomerReturnCreditById(client, {
    installationId: requestContext.installationId,
    id,
    warehouseIds: scopes,
    forUpdate: true,
  });
  if (!source) return failure('CUSTOMER_RETURN_CREDIT_NOT_FOUND', 'Customer Return credit was not found');
  if (!['open', 'partially_allocated'].includes(source.status)) {
    return failure('INVALID_CREDIT_ALLOCATION_SOURCE', 'Customer Return credit is not available for allocation');
  }
  let total = 0n;
  const targets = new Map();
  for (const item of normalized.items) {
    const target = await repository.getAllocatableDocument(client, {
      installationId: requestContext.installationId,
      id: item.targetDocumentId,
      warehouseIds: scopes,
      forUpdate: true,
    });
    if (!target) return failure('RECEIVABLE_DOCUMENT_NOT_FOUND', 'An allocation target was not found in the authorized scope');
    if (target.direction !== 'DEBIT'
        || !['SALE_DELIVERY', 'SALE_PICKUP'].includes(target.document_type)
        || !['open', 'partially_allocated'].includes(target.status)) {
      return failure('INVALID_CREDIT_ALLOCATION_TARGET', 'Allocation target must be an open customer receivable');
    }
    if (target.customer_id !== source.customer_id) return failure('ALLOCATION_CUSTOMER_MISMATCH', 'Credit and receivable customer do not match');
    if (target.currency_code !== source.currency_code) return failure('ALLOCATION_CURRENCY_MISMATCH', 'Credit and receivable currency do not match');
    const targetRemaining = decimalToScaled(target.remaining_amount, { allowZero: true });
    if (targetRemaining === null || item.amount > targetRemaining) return failure('ALLOCATION_EXCEEDS_TARGET', 'Allocation exceeds receivable remaining amount');
    total += item.amount;
    targets.set(item.targetDocumentId, target);
  }
  const sourceRemaining = decimalToScaled(source.remaining_amount, { allowZero: true });
  if (sourceRemaining === null || total > sourceRemaining) return failure('ALLOCATION_EXCEEDS_SOURCE', 'Allocation exceeds available customer credit');

  try {
    for (const item of normalized.items) {
      const target = targets.get(item.targetDocumentId);
      await repository.createCreditAllocation(client, {
        installationId: requestContext.installationId,
        sourceDocumentId: id,
        targetDocumentId: item.targetDocumentId,
        amount: scaledToDecimal(item.amount),
        allocationDate,
        actorId: requestContext.actorId,
        requestId: requestContext.requestId,
        sourceApp: requestContext.sourceApp,
        metadata: {
          customerReturnId: source.customer_return_id,
          sourceWarehouseId: source.warehouse_id,
          targetWarehouseId: target.warehouse_id,
          manual: true,
        },
      });
    }
    const refreshed = await repository.getCustomerReturnCreditById(client, {
      installationId: requestContext.installationId,
      id,
      warehouseIds: scopes,
    });
    return Object.freeze({ ok: true, customerReturnCredit: mapCredit(refreshed) });
  } catch (error) {
    return mapDatabaseError(error) ?? failure('CUSTOMER_RETURN_CREDIT_ALLOCATION_FAILED', 'Customer Return credit allocation failed', true);
  }
}

export async function createCustomerRefund(client, {
  requestContext,
  payload,
  idempotencyKey,
}) {
  const sourceCreditDocumentId = text(payload?.sourceCreditDocumentId, 64);
  const amount = decimalToScaled(payload?.amount);
  const refundMethod = text(payload?.refundMethod, 64)?.toUpperCase() ?? null;
  const destinationReference = text(payload?.destinationReference, 512);
  const externalReference = payload?.externalReference == null || payload.externalReference === ''
    ? null
    : text(payload.externalReference, 256);
  const reason = text(payload?.reason, 2000);
  const refundDate = dateOnly(payload?.refundDate);
  if (!isUuid(sourceCreditDocumentId)) return failure('INVALID_SOURCE_CREDIT_ID', 'sourceCreditDocumentId is invalid');
  if (amount === null) return failure('INVALID_REFUND_AMOUNT', 'amount must be a positive decimal with at most six fractional digits');
  if (!refundMethod || !CODE_PATTERN.test(refundMethod)) return failure('INVALID_REFUND_METHOD', 'refundMethod is invalid');
  if (!destinationReference) return failure('INVALID_DESTINATION_REFERENCE', 'destinationReference is required and must not exceed 512 characters');
  if (payload?.externalReference && !externalReference) return failure('INVALID_EXTERNAL_REFERENCE', 'externalReference must not exceed 256 characters');
  if (!reason) return failure('REFUND_REASON_REQUIRED', 'reason is required and must not exceed 2000 characters');
  if (!refundDate) return failure('INVALID_REFUND_DATE', 'refundDate must be a valid YYYY-MM-DD date');
  const scopes = warehouseScopeIds(requestContext);
  const source = await repository.getCreditOrPaymentById(client, {
    installationId: requestContext.installationId,
    id: sourceCreditDocumentId,
    warehouseIds: scopes,
    forUpdate: true,
  });
  if (!source) return failure('CUSTOMER_CREDIT_NOT_FOUND', 'Customer credit was not found');
  if (!['open', 'partially_allocated'].includes(source.status)) return failure('INVALID_REFUND_SOURCE_CREDIT', 'Customer credit is not available for refund');
  const available = decimalToScaled(source.remaining_amount, { allowZero: true });
  if (available === null || amount > available) return failure('REFUND_EXCEEDS_AVAILABLE_CREDIT', 'Refund exceeds available customer credit');

  const canonical = {
    sourceCreditDocumentId,
    amount: scaledToDecimal(amount),
    refundMethod,
    destinationReference,
    externalReference,
    reason,
    refundDate,
  };
  try {
    const series = await documentNumberRepository.getDocumentNumberSeriesByCode(client, {
      installationId: requestContext.installationId,
      code: REFUND_SERIES_CODE,
    });
    if (!series || !series.is_active) return failure('DOCUMENT_NUMBER_SERIES_UNAVAILABLE', 'Customer refund number series is unavailable', true);
    const numberResult = await allocateDocumentNumber(client, {
      installationId: requestContext.installationId,
      seriesId: series.id,
      idempotencyKey: `customer-refund:${idempotencyKey}`.slice(0, 128),
      payload: { documentDate: refundDate, metadata: { sourceCreditDocumentId } },
      actorId: requestContext.actorId,
      requestId: requestContext.requestId,
      sourceApp: requestContext.sourceApp,
    });
    if (!numberResult.ok) return numberResult;
    const refundId = randomUUID();
    const postedAt = `${refundDate}T00:00:00.000Z`;
    const created = await repository.createCustomerRefund(client, {
      id: refundId,
      installationId: requestContext.installationId,
      sourceCreditDocumentId,
      documentNumber: numberResult.allocation.document_number,
      documentNumberAllocationId: numberResult.allocation.id,
      amount: scaledToDecimal(amount),
      refundMethod,
      destinationReference,
      externalReference,
      reason,
      idempotencyKey,
      payloadHash: payloadHash(canonical),
      actorId: requestContext.actorId,
      requestId: requestContext.requestId,
      sourceApp: requestContext.sourceApp,
      postedAt,
      metadata: { sourceCreditNumber: source.source_document_number },
    });
    const refund = await repository.getCustomerRefundById(client, {
      installationId: requestContext.installationId,
      id: created.id,
      warehouseIds: scopes,
    });
    return Object.freeze({ ok: true, refund: mapRefund(refund) });
  } catch (error) {
    return mapDatabaseError(error) ?? failure('CUSTOMER_REFUND_CREATE_FAILED', 'Customer refund creation failed', true);
  }
}

export async function reverseCustomerRefund(client, { requestContext, id, payload }) {
  if (!isUuid(id)) return failure('INVALID_CUSTOMER_REFUND_ID', 'Customer refund id is invalid');
  const reason = text(payload?.reason, 2000);
  if (!reason) return failure('REFUND_REVERSAL_REASON_REQUIRED', 'reason is required and must not exceed 2000 characters');
  const reversedAt = timestamp(payload?.reversedAt, requestContext.receivedAt ?? new Date().toISOString());
  const scopes = warehouseScopeIds(requestContext);
  const existing = await repository.getCustomerRefundById(client, {
    installationId: requestContext.installationId,
    id,
    warehouseIds: scopes,
    forUpdate: true,
  });
  if (!existing) return failure('CUSTOMER_REFUND_NOT_FOUND', 'Customer refund was not found');
  try {
    await repository.reverseCustomerRefund(client, {
      installationId: requestContext.installationId,
      refundId: id,
      reason,
      actorId: requestContext.actorId,
      requestId: requestContext.requestId,
      sourceApp: requestContext.sourceApp,
      reversedAt,
      metadata: { refundNumber: existing.refund_number },
    });
    const refund = await repository.getCustomerRefundById(client, {
      installationId: requestContext.installationId,
      id,
      warehouseIds: scopes,
    });
    return Object.freeze({ ok: true, refund: mapRefund(refund) });
  } catch (error) {
    return mapDatabaseError(error) ?? failure('CUSTOMER_REFUND_REVERSE_FAILED', 'Customer refund reversal failed', true);
  }
}

export async function reverseCustomerReturnCredit(client, { requestContext, id, payload }) {
  if (!isUuid(id)) return failure('INVALID_CUSTOMER_RETURN_CREDIT_ID', 'Customer Return credit id is invalid');
  const reason = text(payload?.reason, 2000);
  if (!reason) return failure('CREDIT_REVERSAL_REASON_REQUIRED', 'reason is required and must not exceed 2000 characters');
  const reversedAt = timestamp(payload?.reversedAt, requestContext.receivedAt ?? new Date().toISOString());
  const scopes = warehouseScopeIds(requestContext);
  const existing = await repository.getCustomerReturnCreditById(client, {
    installationId: requestContext.installationId,
    id,
    warehouseIds: scopes,
    forUpdate: true,
  });
  if (!existing) return failure('CUSTOMER_RETURN_CREDIT_NOT_FOUND', 'Customer Return credit was not found');
  try {
    await repository.reverseCustomerReturnCredit(client, {
      installationId: requestContext.installationId,
      creditDocumentId: id,
      reason,
      actorId: requestContext.actorId,
      requestId: requestContext.requestId,
      sourceApp: requestContext.sourceApp,
      reversedAt,
      metadata: { customerReturnId: existing.customer_return_id },
    });
    const credit = await repository.getCustomerReturnCreditById(client, {
      installationId: requestContext.installationId,
      id,
      warehouseIds: scopes,
    });
    return Object.freeze({ ok: true, customerReturnCredit: mapCredit(credit) });
  } catch (error) {
    return mapDatabaseError(error) ?? failure('CUSTOMER_RETURN_CREDIT_REVERSE_FAILED', 'Customer Return credit reversal failed', true);
  }
}

export const customerReturnCreditInternals = Object.freeze({
  decimalToScaled,
  scaledToDecimal,
  dateOnly,
  payloadHash,
});

import { randomUUID } from 'node:crypto';
import * as repository from '../db/repositories/supplier-payment.js';
import * as payableRepository from '../db/repositories/payable.js';
import * as documentNumberRepository from '../db/repositories/document-numbering.js';
import { allocateDocumentNumber } from './document-numbering.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL_PATTERN = /^(0|[1-9]\d{0,13})(?:\.(\d{1,6}))?$/;
const CODE_PATTERN = /^[A-Z0-9_.-]{1,64}$/;
const SCALE = 1_000_000n;
const PAYMENT_SERIES_CODE = 'SUPPLIER_PAYMENT';

function failure(code, message, retryable = false, details = {}) {
  return Object.freeze({ ok: false, code, message, retryable, details });
}

function isUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value.trim());
}

function text(value, max = 0) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  if (!normalized || (max > 0 && normalized.length > max)) return null;
  return normalized;
}

function dateOnly(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const normalized = value.slice(0, 10);
    return DATE_PATTERN.test(normalized) ? normalized : null;
  }
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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
  const whole = absolute / SCALE;
  const fraction = String(absolute % SCALE).padStart(6, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

function warehouseScopeIds(requestContext) {
  return Array.isArray(requestContext?.scopes?.warehouseIds)
    ? [...new Set(requestContext.scopes.warehouseIds.filter(isUuid).map((value) => value.trim()))]
    : [];
}

function warehouseAllowed(requestContext, warehouseId) {
  return warehouseScopeIds(requestContext).includes(warehouseId);
}

function mapLedger(row) {
  return Object.freeze({
    id: row.id,
    entryType: row.entry_type,
    amount: String(row.amount),
    requestId: row.request_id,
    sourceApp: row.source_app,
    actorId: row.actor_id,
    occurredAt: timestamp(row.occurred_at),
    metadata: row.metadata ?? {},
  });
}

function mapAllocation(row) {
  return Object.freeze({
    id: row.id,
    sourcePayableDocumentId: row.source_payable_document_id,
    sourceDocumentNumber: row.source_document_number ?? null,
    sourceDocumentType: row.source_document_type ?? null,
    targetPayableDocumentId: row.target_payable_document_id,
    targetDocumentNumber: row.target_document_number ?? null,
    targetDocumentType: row.target_document_type ?? null,
    amount: String(row.amount),
    allocationDate: dateOnly(row.allocation_date),
    sourceRevisionBefore: String(row.source_revision_before),
    targetRevisionBefore: String(row.target_revision_before),
    actorId: row.actor_id,
    requestId: row.request_id,
    sourceApp: row.source_app,
    createdAt: timestamp(row.created_at),
    metadata: row.metadata ?? {},
    reversed: Boolean(row.reversal_id),
    reversalId: row.reversal_id ?? null,
    reversalReason: row.reversal_reason ?? null,
    reversedAt: row.reversed_at ? timestamp(row.reversed_at) : null,
  });
}

function mapDocument(row) {
  return Object.freeze({
    id: row.id,
    supplierId: row.supplier_id,
    supplierCode: row.supplier_code ?? null,
    supplierName: row.supplier_name ?? null,
    warehouseId: row.warehouse_id,
    warehouseCode: row.warehouse_code ?? null,
    warehouseName: row.warehouse_name ?? null,
    direction: row.direction,
    documentType: row.document_type,
    documentNumber: row.source_document_number,
    paymentDate: dateOnly(row.source_document_date),
    currencyCode: row.currency_code,
    paymentMethod: row.payment_method_snapshot,
    externalReference: row.external_reference ?? null,
    note: row.note ?? null,
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
    ledgerEntries: Object.freeze((row.ledger_entries ?? []).map(mapLedger)),
    allocations: Object.freeze((row.allocations ?? []).map(mapAllocation)),
  });
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

function mapDatabaseError(error) {
  const message = String(error?.message ?? '');
  const mappings = new Map([
    ['payable_document_not_found', ['PAYABLE_DOCUMENT_NOT_FOUND', 'Payable document was not found']],
    ['invalid_allocation_source', ['INVALID_ALLOCATION_SOURCE', 'Allocation source must be an open supplier payment or supplier return credit']],
    ['invalid_allocation_target', ['INVALID_ALLOCATION_TARGET', 'Allocation target must be an open Goods Receipt payable debit']],
    ['allocation_supplier_mismatch', ['ALLOCATION_SUPPLIER_MISMATCH', 'Allocation supplier does not match']],
    ['allocation_warehouse_mismatch', ['ALLOCATION_WAREHOUSE_MISMATCH', 'Allocation warehouse does not match']],
    ['allocation_currency_mismatch', ['ALLOCATION_CURRENCY_MISMATCH', 'Allocation currency does not match']],
    ['allocation_exceeds_source_remaining', ['ALLOCATION_EXCEEDS_SOURCE', 'Allocation exceeds the source remaining amount']],
    ['allocation_exceeds_target_remaining', ['ALLOCATION_EXCEEDS_TARGET', 'Allocation exceeds the target remaining amount']],
    ['payable_allocation_not_found', ['PAYABLE_ALLOCATION_NOT_FOUND', 'Payable allocation was not found']],
    ['payable_allocation_already_reversed', ['PAYABLE_ALLOCATION_ALREADY_REVERSED', 'Payable allocation was already reversed']],
    ['allocated_document_reversed', ['ALLOCATED_DOCUMENT_REVERSED', 'An allocated document is already reversed']],
  ]);
  for (const [needle, [code, publicMessage]] of mappings) {
    if (message.includes(needle)) return failure(code, publicMessage, code.includes('EXCEEDS'));
  }
  return null;
}

export async function createSupplierPayment(client, { requestContext, payload, idempotencyKey }) {
  const supplierId = text(payload?.supplierId, 64);
  const warehouseId = text(payload?.warehouseId, 64);
  const paymentDate = dateOnly(payload?.paymentDate);
  const currencyCode = text(payload?.currencyCode, 3)?.toUpperCase() ?? null;
  const paymentMethod = text(payload?.paymentMethod, 64)?.toUpperCase() ?? null;
  const amount = decimalToScaled(payload?.amount);
  const externalReference = payload?.externalReference == null || payload.externalReference === ''
    ? null
    : text(payload.externalReference, 256);
  const note = payload?.note == null || payload.note === '' ? null : text(payload.note, 4000);

  if (!isUuid(supplierId)) return failure('INVALID_SUPPLIER_ID', 'supplierId must be a valid UUID');
  if (!isUuid(warehouseId)) return failure('INVALID_WAREHOUSE_ID', 'warehouseId must be a valid UUID');
  if (!warehouseAllowed(requestContext, warehouseId)) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Warehouse is outside the authorized scope');
  }
  if (!paymentDate) return failure('INVALID_PAYMENT_DATE', 'paymentDate must be a valid YYYY-MM-DD date');
  if (!currencyCode || !/^[A-Z]{3}$/.test(currencyCode)) {
    return failure('INVALID_CURRENCY_CODE', 'currencyCode must be a three-letter uppercase code');
  }
  if (!paymentMethod || !CODE_PATTERN.test(paymentMethod)) {
    return failure('INVALID_PAYMENT_METHOD', 'paymentMethod is invalid');
  }
  if (amount === null) {
    return failure('INVALID_PAYMENT_AMOUNT', 'amount must be a positive decimal with at most six fractional digits');
  }
  if (payload?.externalReference && !externalReference) {
    return failure('INVALID_EXTERNAL_REFERENCE', 'externalReference must not exceed 256 characters');
  }
  if (payload?.note && !note) return failure('INVALID_NOTE', 'note must not exceed 4000 characters');

  const context = await repository.getSupplierAndWarehouse(client, {
    installationId: requestContext.installationId,
    supplierId,
    warehouseId,
  });
  if (!context || !context.supplier_active) {
    return failure('SUPPLIER_NOT_FOUND', 'Active supplier was not found');
  }
  if (!context.warehouse_active) return failure('WAREHOUSE_NOT_FOUND', 'Active warehouse was not found');

  const series = await documentNumberRepository.getDocumentNumberSeriesByCode(client, {
    installationId: requestContext.installationId,
    code: PAYMENT_SERIES_CODE,
  });
  if (!series || !series.is_active) {
    return failure('SUPPLIER_PAYMENT_SERIES_UNAVAILABLE', 'Supplier payment document number series is unavailable');
  }

  const paymentId = randomUUID();
  const numberResult = await allocateDocumentNumber(client, {
    installationId: requestContext.installationId,
    seriesId: series.id,
    idempotencyKey: `supplier-payment:${idempotencyKey}`,
    payload: {
      documentDate: paymentDate,
      metadata: { paymentId, supplierId, warehouseId, currencyCode, amount: scaledToDecimal(amount) },
    },
    actorId: requestContext.actorId,
    requestId: requestContext.requestId,
    sourceApp: requestContext.sourceApp,
  });
  if (!numberResult.ok) return numberResult;

  const postedAt = timestamp(requestContext.receivedAt);
  const payment = await repository.insertSupplierPayment(client, {
    id: paymentId,
    installationId: requestContext.installationId,
    supplierId,
    warehouseId,
    documentNumber: numberResult.allocation.document_number,
    documentNumberAllocationId: numberResult.allocation.id,
    paymentDate,
    currencyCode,
    paymentMethod,
    amount: scaledToDecimal(amount),
    externalReference,
    note,
    postedAt,
    actorId: requestContext.actorId,
  });
  await payableRepository.insertPayableLedgerEntry(client, {
    installationId: requestContext.installationId,
    payableDocumentId: payment.id,
    supplierId,
    currencyCode,
    entryType: 'SUPPLIER_PAYMENT_POST',
    amount: scaledToDecimal(-amount),
    sourceDocumentType: 'SUPPLIER_PAYMENT',
    sourceDocumentId: payment.id,
    sourceDocumentNumber: payment.source_document_number,
    sourceRevision: '1',
    documentStatusAfter: 'open',
    actorId: requestContext.actorId,
    requestId: requestContext.requestId,
    sourceApp: requestContext.sourceApp,
    occurredAt: postedAt,
    metadata: { warehouseId, paymentMethod, externalReference, postingOrigin: 'runtime' },
  });
  const hydrated = await repository.getSupplierPaymentById(client, {
    installationId: requestContext.installationId,
    id: payment.id,
    warehouseIds: [warehouseId],
  });
  return Object.freeze({
    ok: true,
    supplierPayment: mapDocument(hydrated ?? payment),
    action: 'create',
  });
}

export async function listSupplierPayments(client, input) {
  const scopes = warehouseScopeIds(input.requestContext);
  if (!scopes.length) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'At least one authorized warehouse is required');
  }
  const pagination = normalizePagination(input.limit, input.offset);
  if (!pagination.ok) return pagination;
  const supplierId = input.supplierId ? String(input.supplierId).trim() : null;
  const warehouseId = input.warehouseId ? String(input.warehouseId).trim() : null;
  if (supplierId && !isUuid(supplierId)) {
    return failure('INVALID_SUPPLIER_ID', 'supplierId must be a valid UUID');
  }
  if (warehouseId && (!isUuid(warehouseId) || !warehouseAllowed(input.requestContext, warehouseId))) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Warehouse is outside the authorized scope');
  }
  const status = input.status ? String(input.status).trim() : null;
  if (status && !new Set(['open', 'partially_allocated', 'settled', 'reversed']).has(status)) {
    return failure('INVALID_STATUS', 'Invalid supplier payment status');
  }
  const currencyCode = input.currencyCode
    ? String(input.currencyCode).trim().toUpperCase()
    : null;
  if (currencyCode && !/^[A-Z]{3}$/.test(currencyCode)) {
    return failure('INVALID_CURRENCY_CODE', 'Invalid currency code');
  }
  const search = input.search ? text(input.search, 256) : null;
  if (input.search && !search) return failure('INVALID_SEARCH', 'Search must not exceed 256 characters');
  const rows = await repository.listSupplierPayments(client, {
    installationId: input.requestContext.installationId,
    warehouseIds: scopes,
    supplierId,
    warehouseId,
    status,
    currencyCode,
    search,
    limit: pagination.limit,
    offset: pagination.offset,
  });
  return Object.freeze({
    ok: true,
    supplierPayments: Object.freeze(rows.map(mapDocument)),
  });
}

export async function getSupplierPayment(client, { requestContext, id }) {
  if (!isUuid(id)) return failure('SUPPLIER_PAYMENT_NOT_FOUND', 'Supplier payment was not found');
  const scopes = warehouseScopeIds(requestContext);
  if (!scopes.length) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'At least one authorized warehouse is required');
  }
  const row = await repository.getSupplierPaymentById(client, {
    installationId: requestContext.installationId,
    id: id.trim(),
    warehouseIds: scopes,
  });
  return row
    ? Object.freeze({ ok: true, supplierPayment: mapDocument(row) })
    : failure('SUPPLIER_PAYMENT_NOT_FOUND', 'Supplier payment was not found');
}

export async function reverseSupplierPayment(client, { requestContext, id, payload }) {
  if (!isUuid(id)) return failure('SUPPLIER_PAYMENT_NOT_FOUND', 'Supplier payment was not found');
  const scopes = warehouseScopeIds(requestContext);
  const payment = await repository.getSupplierPaymentById(client, {
    installationId: requestContext.installationId,
    id: id.trim(),
    warehouseIds: scopes,
    forUpdate: true,
  });
  if (!payment) return failure('SUPPLIER_PAYMENT_NOT_FOUND', 'Supplier payment was not found');
  if (payment.status === 'reversed') {
    return Object.freeze({ ok: true, supplierPayment: mapDocument(payment), replayed: true });
  }
  if (decimalToScaled(payment.allocated_amount, { allowZero: true }) !== 0n) {
    return failure(
      'PAYMENT_ALLOCATION_EXISTS',
      'Reverse active allocations before reversing the supplier payment',
    );
  }
  const reason = text(payload?.reason, 2000);
  if (!reason) return failure('PAYMENT_REVERSAL_REASON_REQUIRED', 'A reversal reason is required');
  const reversedAt = timestamp(requestContext.receivedAt);
  const reversed = await payableRepository.reversePayableDocument(client, {
    installationId: requestContext.installationId,
    id: payment.id,
    actorId: requestContext.actorId,
    reversedAt,
    reversalReason: reason,
  });
  if (!reversed) {
    return failure('SUPPLIER_PAYMENT_CONFLICT', 'Supplier payment changed concurrently', true);
  }
  const amount = decimalToScaled(payment.original_amount);
  await payableRepository.insertPayableLedgerEntry(client, {
    installationId: requestContext.installationId,
    payableDocumentId: payment.id,
    supplierId: payment.supplier_id,
    currencyCode: payment.currency_code,
    entryType: 'SUPPLIER_PAYMENT_REVERSE',
    amount: scaledToDecimal(amount),
    sourceDocumentType: 'SUPPLIER_PAYMENT',
    sourceDocumentId: payment.id,
    sourceDocumentNumber: payment.source_document_number,
    sourceRevision: String(Number(payment.revision) + 1),
    documentStatusAfter: 'reversed',
    actorId: requestContext.actorId,
    requestId: requestContext.requestId,
    sourceApp: requestContext.sourceApp,
    occurredAt: reversedAt,
    metadata: { reason, postingOrigin: 'runtime' },
  });
  const hydrated = await repository.getSupplierPaymentById(client, {
    installationId: requestContext.installationId,
    id: payment.id,
    warehouseIds: scopes,
  });
  return Object.freeze({
    ok: true,
    supplierPayment: mapDocument(hydrated ?? reversed),
    action: 'reverse',
  });
}

export async function listOpenAllocationTargets(client, input) {
  const scopes = warehouseScopeIds(input.requestContext);
  if (!scopes.length) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'At least one authorized warehouse is required');
  }
  const supplierId = input.supplierId ? String(input.supplierId).trim() : null;
  const warehouseId = input.warehouseId ? String(input.warehouseId).trim() : null;
  const currencyCode = input.currencyCode
    ? String(input.currencyCode).trim().toUpperCase()
    : null;
  if (supplierId && !isUuid(supplierId)) {
    return failure('INVALID_SUPPLIER_ID', 'supplierId must be a valid UUID');
  }
  if (warehouseId && (!isUuid(warehouseId) || !warehouseAllowed(input.requestContext, warehouseId))) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Warehouse is outside the authorized scope');
  }
  if (currencyCode && !/^[A-Z]{3}$/.test(currencyCode)) {
    return failure('INVALID_CURRENCY_CODE', 'Invalid currency code');
  }
  const rows = await repository.listOpenAllocationTargets(client, {
    installationId: input.requestContext.installationId,
    warehouseIds: scopes,
    supplierId,
    warehouseId,
    currencyCode,
  });
  return Object.freeze({
    ok: true,
    payableDocuments: Object.freeze(rows.map((row) => ({
      id: row.id,
      documentNumber: row.source_document_number,
      supplierId: row.supplier_id,
      supplierCode: row.supplier_code,
      supplierName: row.supplier_name,
      warehouseId: row.warehouse_id,
      warehouseCode: row.warehouse_code,
      currencyCode: row.currency_code,
      dueDate: dateOnly(row.due_date),
      originalAmount: String(row.original_amount),
      allocatedAmount: String(row.allocated_amount),
      remainingAmount: String(row.remaining_amount),
      status: row.status,
    }))),
  });
}

export async function createPayableAllocation(client, { requestContext, payload }) {
  const sourceDocumentId = text(payload?.sourcePayableDocumentId, 64);
  const targetDocumentId = text(payload?.targetPayableDocumentId, 64);
  const amount = decimalToScaled(payload?.amount);
  const allocationDate = dateOnly(payload?.allocationDate);
  if (!isUuid(sourceDocumentId)) {
    return failure('INVALID_SOURCE_DOCUMENT_ID', 'sourcePayableDocumentId must be a valid UUID');
  }
  if (!isUuid(targetDocumentId)) {
    return failure('INVALID_TARGET_DOCUMENT_ID', 'targetPayableDocumentId must be a valid UUID');
  }
  if (sourceDocumentId === targetDocumentId) {
    return failure('INVALID_ALLOCATION_DOCUMENTS', 'Allocation source and target must be different');
  }
  if (amount === null) {
    return failure('INVALID_ALLOCATION_AMOUNT', 'amount must be a positive decimal with at most six fractional digits');
  }
  if (!allocationDate) {
    return failure('INVALID_ALLOCATION_DATE', 'allocationDate must be a valid YYYY-MM-DD date');
  }
  const scopes = warehouseScopeIds(requestContext);
  const [source, target] = await Promise.all([
    repository.getAllocatableDocument(client, {
      installationId: requestContext.installationId,
      id: sourceDocumentId,
      warehouseIds: scopes,
    }),
    repository.getAllocatableDocument(client, {
      installationId: requestContext.installationId,
      id: targetDocumentId,
      warehouseIds: scopes,
    }),
  ]);
  if (!source || !target) {
    return failure(
      'PAYABLE_DOCUMENT_NOT_FOUND',
      'An allocation document was not found in the authorized warehouse scope',
    );
  }
  try {
    const created = await repository.createAllocation(client, {
      installationId: requestContext.installationId,
      sourceDocumentId,
      targetDocumentId,
      amount: scaledToDecimal(amount),
      allocationDate,
      actorId: requestContext.actorId,
      requestId: requestContext.requestId,
      sourceApp: requestContext.sourceApp,
      metadata: {
        sourceDocumentType: source.document_type,
        targetDocumentType: target.document_type,
      },
    });
    const allocation = await repository.getAllocationById(client, {
      installationId: requestContext.installationId,
      id: created.id,
      warehouseIds: scopes,
    });
    return Object.freeze({
      ok: true,
      allocation: mapAllocation(allocation ?? created),
      action: 'create',
    });
  } catch (error) {
    const mapped = mapDatabaseError(error);
    if (mapped) return mapped;
    throw error;
  }
}

export async function reversePayableAllocation(client, { requestContext, id, payload }) {
  if (!isUuid(id)) {
    return failure('PAYABLE_ALLOCATION_NOT_FOUND', 'Payable allocation was not found');
  }
  const reason = text(payload?.reason, 2000);
  if (!reason) {
    return failure('ALLOCATION_REVERSAL_REASON_REQUIRED', 'An allocation reversal reason is required');
  }
  const scopes = warehouseScopeIds(requestContext);
  const allocation = await repository.getAllocationById(client, {
    installationId: requestContext.installationId,
    id: id.trim(),
    warehouseIds: scopes,
    forUpdate: true,
  });
  if (!allocation) {
    return failure('PAYABLE_ALLOCATION_NOT_FOUND', 'Payable allocation was not found');
  }
  if (allocation.reversal_id) {
    return Object.freeze({ ok: true, allocation: mapAllocation(allocation), replayed: true });
  }
  try {
    await repository.reverseAllocation(client, {
      installationId: requestContext.installationId,
      allocationId: allocation.id,
      reason,
      actorId: requestContext.actorId,
      requestId: requestContext.requestId,
      sourceApp: requestContext.sourceApp,
      reversedAt: timestamp(requestContext.receivedAt),
      metadata: {
        sourceDocumentNumber: allocation.source_document_number,
        targetDocumentNumber: allocation.target_document_number,
      },
    });
    const hydrated = await repository.getAllocationById(client, {
      installationId: requestContext.installationId,
      id: allocation.id,
      warehouseIds: scopes,
    });
    return Object.freeze({
      ok: true,
      allocation: mapAllocation(hydrated),
      action: 'reverse',
    });
  } catch (error) {
    const mapped = mapDatabaseError(error);
    if (mapped) return mapped;
    throw error;
  }
}

export const supplierPaymentInternals = Object.freeze({
  decimalToScaled,
  scaledToDecimal,
  mapDatabaseError,
});

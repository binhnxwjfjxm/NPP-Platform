import { randomUUID } from 'node:crypto';
import { deriveIdempotencyKey } from '../idempotency-derived.js';
import * as repository from '../db/repositories/customer-payment.js';
import * as documentNumberRepository from '../db/repositories/document-numbering.js';
import { allocateDocumentNumber } from './document-numbering.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL_PATTERN = /^(0|[1-9]\d{0,13})(?:\.(\d{1,6}))?$/;
const CODE_PATTERN = /^[A-Z0-9_.-]{1,64}$/;
const SCALE = 1_000_000n;
const PAYMENT_SERIES_CODE = 'CUSTOMER_PAYMENT';
const PAYMENT_STATUSES = new Set(['open', 'partially_allocated', 'settled', 'reversed']);

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
    sourceReceivableDocumentId: row.source_receivable_document_id,
    sourceDocumentNumber: row.source_document_number ?? null,
    sourceDocumentType: row.source_document_type ?? null,
    sourceWarehouseId: row.source_warehouse_id ?? null,
    targetReceivableDocumentId: row.target_receivable_document_id,
    targetDocumentNumber: row.target_document_number ?? null,
    targetDocumentType: row.target_document_type ?? null,
    targetWarehouseId: row.target_warehouse_id ?? null,
    salesOrderId: row.sales_order_id ?? null,
    deliveryOrderId: row.delivery_order_id ?? null,
    amount: String(row.amount),
    allocationDate: typeof row.allocation_date === 'string'
      ? row.allocation_date.slice(0, 10)
      : row.allocation_date?.toISOString?.().slice(0, 10),
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

function mapPayment(row) {
  return Object.freeze({
    id: row.id,
    customerId: row.customer_id,
    customerCode: row.customer_code ?? row.customer_code_snapshot ?? null,
    customerName: row.customer_name ?? row.customer_name_snapshot ?? null,
    warehouseId: row.warehouse_id,
    warehouseCode: row.warehouse_code ?? row.warehouse_code_snapshot ?? null,
    warehouseName: row.warehouse_name ?? row.warehouse_name_snapshot ?? null,
    direction: row.direction,
    documentType: row.document_type,
    documentNumber: row.source_document_number,
    paymentDate: typeof row.source_document_date === 'string'
      ? row.source_document_date.slice(0, 10)
      : row.source_document_date?.toISOString?.().slice(0, 10),
    currencyCode: row.currency_code,
    paymentMethod: row.payment_method,
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

function mapTarget(row) {
  return Object.freeze({
    id: row.id,
    documentNumber: row.source_document_number,
    sourceDocumentType: row.source_document_type,
    sourceDocumentDate: typeof row.source_document_date === 'string'
      ? row.source_document_date.slice(0, 10)
      : row.source_document_date?.toISOString?.().slice(0, 10),
    customerId: row.customer_id,
    customerCode: row.customer_code,
    customerName: row.customer_name,
    warehouseId: row.warehouse_id,
    warehouseCode: row.warehouse_code,
    warehouseName: row.warehouse_name,
    salesOrderId: row.sales_order_id,
    salesOrderNumber: row.sales_order_number,
    deliveryOrderId: row.delivery_order_id,
    deliveryOrderNumber: row.delivery_order_number,
    currencyCode: row.currency_code,
    originalAmount: String(row.original_amount),
    allocatedAmount: String(row.allocated_amount),
    remainingAmount: String(row.remaining_amount),
    status: row.status,
  });
}

function normalizeAllocationItems(value) {
  if (value === undefined || value === null) return { ok: true, items: [] };
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    return failure('INVALID_ALLOCATIONS', 'allocations must contain between 1 and 100 rows');
  }
  const ids = new Set();
  const items = [];
  for (const candidate of value) {
    const targetDocumentId = text(candidate?.receivableDocumentId, 64);
    const amount = decimalToScaled(candidate?.amount);
    if (!isUuid(targetDocumentId)) {
      return failure(
        'INVALID_TARGET_DOCUMENT_ID',
        'Each receivableDocumentId must be a valid UUID',
      );
    }
    if (ids.has(targetDocumentId)) {
      return failure('DUPLICATE_ALLOCATION_TARGET', 'A receivable target may only appear once');
    }
    if (amount === null) {
      return failure(
        'INVALID_ALLOCATION_AMOUNT',
        'Each allocation amount must be a positive decimal with at most six fractional digits',
      );
    }
    ids.add(targetDocumentId);
    items.push({ targetDocumentId, amount });
  }
  items.sort((left, right) => left.targetDocumentId.localeCompare(right.targetDocumentId));
  return { ok: true, items };
}

function mapDatabaseError(error) {
  const message = String(error?.message ?? '');
  const mappings = new Map([
    ['receivable_document_not_found', ['RECEIVABLE_DOCUMENT_NOT_FOUND', 'A receivable document was not found']],
    ['invalid_allocation_source', ['INVALID_ALLOCATION_SOURCE', 'Allocation source must be an active customer payment']],
    ['invalid_allocation_target', ['INVALID_ALLOCATION_TARGET', 'Allocation target must be an open customer receivable']],
    ['allocation_customer_mismatch', ['ALLOCATION_CUSTOMER_MISMATCH', 'Payment and receivable customer do not match']],
    ['allocation_currency_mismatch', ['ALLOCATION_CURRENCY_MISMATCH', 'Payment and receivable currency do not match']],
    ['allocation_exceeds_source_remaining', ['ALLOCATION_EXCEEDS_SOURCE', 'Allocation exceeds unapplied payment amount']],
    ['allocation_exceeds_target_remaining', ['ALLOCATION_EXCEEDS_TARGET', 'Allocation exceeds receivable remaining amount']],
    ['receivable_allocation_not_found', ['RECEIVABLE_ALLOCATION_NOT_FOUND', 'Receivable allocation was not found']],
    ['receivable_allocation_already_reversed', ['RECEIVABLE_ALLOCATION_ALREADY_REVERSED', 'Receivable allocation was already reversed']],
    ['allocated_document_reversed', ['ALLOCATED_DOCUMENT_REVERSED', 'An allocated document is already reversed']],
    ['payment_allocation_exists', ['PAYMENT_ALLOCATION_EXISTS', 'Reverse active allocations before reversing the customer payment']],
    ['customer_payment_not_found', ['CUSTOMER_PAYMENT_NOT_FOUND', 'Customer payment was not found']],
  ]);
  for (const [needle, [code, publicMessage]] of mappings) {
    if (message.includes(needle)) {
      return failure(code, publicMessage, code.includes('EXCEEDS'));
    }
  }
  return null;
}

async function validateAllocationTargets(client, {
  requestContext,
  sourcePayment,
  items,
}) {
  const scopes = warehouseScopeIds(requestContext);
  let total = 0n;
  const targets = new Map();
  for (const item of items) {
    const target = await repository.getAllocatableDocument(client, {
      installationId: requestContext.installationId,
      id: item.targetDocumentId,
      warehouseIds: scopes,
    });
    if (!target) {
      return failure(
        'RECEIVABLE_DOCUMENT_NOT_FOUND',
        'An allocation target was not found in the authorized warehouse scope',
      );
    }
    if (target.direction !== 'DEBIT'
        || !['SALE_DELIVERY', 'SALE_PICKUP'].includes(target.document_type)
        || !['open', 'partially_allocated'].includes(target.status)) {
      return failure('INVALID_ALLOCATION_TARGET', 'Allocation target must be an open customer receivable');
    }
    if (target.customer_id !== sourcePayment.customer_id) {
      return failure('ALLOCATION_CUSTOMER_MISMATCH', 'Payment and receivable customer do not match');
    }
    if (target.currency_code !== sourcePayment.currency_code) {
      return failure('ALLOCATION_CURRENCY_MISMATCH', 'Payment and receivable currency do not match');
    }
    const targetRemaining = decimalToScaled(target.remaining_amount, { allowZero: true });
    if (targetRemaining === null || item.amount > targetRemaining) {
      return failure('ALLOCATION_EXCEEDS_TARGET', 'Allocation exceeds receivable remaining amount');
    }
    total += item.amount;
    targets.set(item.targetDocumentId, target);
  }
  const sourceRemaining = decimalToScaled(sourcePayment.remaining_amount, { allowZero: true });
  if (sourceRemaining === null || total > sourceRemaining) {
    return failure('ALLOCATION_EXCEEDS_SOURCE', 'Allocation exceeds unapplied payment amount');
  }
  return { ok: true, targets };
}

async function applyAllocations(client, {
  requestContext,
  sourcePayment,
  items,
  allocationDate,
  targets,
}) {
  const allocations = [];
  for (const item of items) {
    const target = targets.get(item.targetDocumentId);
    const created = await repository.createAllocation(client, {
      installationId: requestContext.installationId,
      sourceDocumentId: sourcePayment.id,
      targetDocumentId: item.targetDocumentId,
      amount: scaledToDecimal(item.amount),
      allocationDate,
      actorId: requestContext.actorId,
      requestId: requestContext.requestId,
      sourceApp: requestContext.sourceApp,
      metadata: {
        customerId: sourcePayment.customer_id,
        sourceWarehouseId: sourcePayment.warehouse_id,
        targetWarehouseId: target.warehouse_id,
        sourceDocumentNumber: sourcePayment.source_document_number,
        targetDocumentNumber: target.source_document_number,
      },
    });
    allocations.push(created);
  }
  return allocations;
}

export async function createCustomerPayment(client, {
  requestContext,
  payload,
  idempotencyKey,
}) {
  const customerId = text(payload?.customerId, 64);
  const warehouseId = text(payload?.warehouseId, 64);
  const paymentDate = dateOnly(payload?.paymentDate);
  const currencyCode = text(payload?.currencyCode, 3)?.toUpperCase() ?? null;
  const paymentMethod = text(payload?.paymentMethod, 64)?.toUpperCase() ?? null;
  const amount = decimalToScaled(payload?.amount);
  const externalReference = payload?.externalReference == null || payload.externalReference === ''
    ? null
    : text(payload.externalReference, 256);
  const note = payload?.note == null || payload.note === '' ? null : text(payload.note, 4000);
  const normalizedAllocations = normalizeAllocationItems(payload?.allocations);

  if (!isUuid(customerId)) return failure('INVALID_CUSTOMER_ID', 'customerId must be a valid UUID');
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
  if (!normalizedAllocations.ok) return normalizedAllocations;

  const context = await repository.getCustomerAndWarehouse(client, {
    installationId: requestContext.installationId,
    customerId,
    warehouseId,
  });
  if (!context || !context.customer_active) {
    return failure('CUSTOMER_NOT_FOUND', 'Active customer was not found');
  }
  if (!context.warehouse_active) return failure('WAREHOUSE_NOT_FOUND', 'Active warehouse was not found');

  const series = await documentNumberRepository.getDocumentNumberSeriesByCode(client, {
    installationId: requestContext.installationId,
    code: PAYMENT_SERIES_CODE,
  });
  if (!series || !series.is_active) {
    return failure('CUSTOMER_PAYMENT_SERIES_UNAVAILABLE', 'Customer payment document number series is unavailable');
  }

  const paymentId = randomUUID();
  const numberResult = await allocateDocumentNumber(client, {
    installationId: requestContext.installationId,
    seriesId: series.id,
    idempotencyKey: deriveIdempotencyKey('customer-payment-number', idempotencyKey),
    payload: {
      documentDate: paymentDate,
      metadata: {
        paymentId,
        customerId,
        warehouseId,
        currencyCode,
        amount: scaledToDecimal(amount),
      },
    },
    actorId: requestContext.actorId,
    requestId: requestContext.requestId,
    sourceApp: requestContext.sourceApp,
  });
  if (!numberResult.ok) return numberResult;

  const postedAt = timestamp(requestContext.receivedAt);
  await repository.setReceivableWriteContext(client);
  const payment = await repository.insertCustomerPayment(client, {
    id: paymentId,
    installationId: requestContext.installationId,
    customerId,
    warehouseId,
    documentNumber: numberResult.allocation.document_number,
    documentNumberAllocationId: numberResult.allocation.id,
    paymentDate,
    customerCodeSnapshot: context.customer_code,
    customerNameSnapshot: context.customer_name,
    warehouseCodeSnapshot: context.warehouse_code,
    warehouseNameSnapshot: context.warehouse_name,
    currencyCode,
    paymentMethod,
    amount: scaledToDecimal(amount),
    externalReference,
    note,
    postedAt,
    actorId: requestContext.actorId,
  });
  await repository.insertCustomerPaymentLedgerEntry(client, {
    installationId: requestContext.installationId,
    paymentId: payment.id,
    customerId,
    currencyCode,
    entryType: 'CUSTOMER_PAYMENT_POST',
    amount: scaledToDecimal(-amount),
    documentNumber: payment.source_document_number,
    sourceRevision: '1',
    documentStatusAfter: 'open',
    actorId: requestContext.actorId,
    requestId: requestContext.requestId,
    sourceApp: requestContext.sourceApp,
    occurredAt: postedAt,
    metadata: {
      warehouseId,
      paymentMethod,
      externalReference,
      postingOrigin: 'runtime',
    },
  });

  if (normalizedAllocations.items.length) {
    const validation = await validateAllocationTargets(client, {
      requestContext,
      sourcePayment: payment,
      items: normalizedAllocations.items,
    });
    if (!validation.ok) return validation;
    try {
      await applyAllocations(client, {
        requestContext,
        sourcePayment: payment,
        items: normalizedAllocations.items,
        allocationDate: paymentDate,
        targets: validation.targets,
      });
    } catch (error) {
      const mapped = mapDatabaseError(error);
      if (mapped) return mapped;
      throw error;
    }
  }

  const hydrated = await repository.getCustomerPaymentById(client, {
    installationId: requestContext.installationId,
    id: payment.id,
    warehouseIds: warehouseScopeIds(requestContext),
  });
  return Object.freeze({
    ok: true,
    customerPayment: mapPayment(hydrated ?? payment),
    action: 'create',
  });
}

export async function listCustomerPayments(client, input) {
  const scopes = warehouseScopeIds(input.requestContext);
  if (!scopes.length) return failure('WAREHOUSE_SCOPE_DENIED', 'At least one authorized warehouse is required');
  const pagination = normalizePagination(input.limit, input.offset);
  if (!pagination.ok) return pagination;
  const customerId = input.customerId ? String(input.customerId).trim() : null;
  const warehouseId = input.warehouseId ? String(input.warehouseId).trim() : null;
  if (customerId && !isUuid(customerId)) return failure('INVALID_CUSTOMER_ID', 'customerId must be a valid UUID');
  if (warehouseId && (!isUuid(warehouseId) || !warehouseAllowed(input.requestContext, warehouseId))) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Warehouse is outside the authorized scope');
  }
  const status = input.status ? String(input.status).trim() : null;
  if (status && !PAYMENT_STATUSES.has(status)) return failure('INVALID_STATUS', 'Invalid customer payment status');
  const currencyCode = input.currencyCode ? String(input.currencyCode).trim().toUpperCase() : null;
  if (currencyCode && !/^[A-Z]{3}$/.test(currencyCode)) {
    return failure('INVALID_CURRENCY_CODE', 'Invalid currency code');
  }
  const search = input.search ? text(input.search, 256) : null;
  if (input.search && !search) return failure('INVALID_SEARCH', 'Search must not exceed 256 characters');
  const rows = await repository.listCustomerPayments(client, {
    installationId: input.requestContext.installationId,
    warehouseIds: scopes,
    customerId,
    warehouseId,
    status,
    currencyCode,
    search,
    limit: pagination.limit,
    offset: pagination.offset,
  });
  return Object.freeze({
    ok: true,
    customerPayments: Object.freeze(rows.map(mapPayment)),
  });
}

export async function getCustomerPayment(client, { requestContext, id }) {
  if (!isUuid(id)) return failure('CUSTOMER_PAYMENT_NOT_FOUND', 'Customer payment was not found');
  const scopes = warehouseScopeIds(requestContext);
  if (!scopes.length) return failure('WAREHOUSE_SCOPE_DENIED', 'At least one authorized warehouse is required');
  const row = await repository.getCustomerPaymentById(client, {
    installationId: requestContext.installationId,
    id: id.trim(),
    warehouseIds: scopes,
  });
  return row
    ? Object.freeze({ ok: true, customerPayment: mapPayment(row) })
    : failure('CUSTOMER_PAYMENT_NOT_FOUND', 'Customer payment was not found');
}

export async function listOpenAllocationTargets(client, input) {
  const scopes = warehouseScopeIds(input.requestContext);
  if (!scopes.length) return failure('WAREHOUSE_SCOPE_DENIED', 'At least one authorized warehouse is required');
  const customerId = input.customerId ? String(input.customerId).trim() : null;
  const warehouseId = input.warehouseId ? String(input.warehouseId).trim() : null;
  const currencyCode = input.currencyCode ? String(input.currencyCode).trim().toUpperCase() : null;
  if (customerId && !isUuid(customerId)) return failure('INVALID_CUSTOMER_ID', 'customerId must be a valid UUID');
  if (warehouseId && (!isUuid(warehouseId) || !warehouseAllowed(input.requestContext, warehouseId))) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Warehouse is outside the authorized scope');
  }
  if (currencyCode && !/^[A-Z]{3}$/.test(currencyCode)) {
    return failure('INVALID_CURRENCY_CODE', 'Invalid currency code');
  }
  const rows = await repository.listOpenAllocationTargets(client, {
    installationId: input.requestContext.installationId,
    warehouseIds: scopes,
    customerId,
    warehouseId,
    currencyCode,
  });
  return Object.freeze({
    ok: true,
    receivableDocuments: Object.freeze(rows.map(mapTarget)),
  });
}

export async function allocateCustomerPayment(client, {
  requestContext,
  id,
  payload,
}) {
  if (!isUuid(id)) return failure('CUSTOMER_PAYMENT_NOT_FOUND', 'Customer payment was not found');
  const allocationDate = dateOnly(payload?.allocationDate);
  if (!allocationDate) {
    return failure('INVALID_ALLOCATION_DATE', 'allocationDate must be a valid YYYY-MM-DD date');
  }
  const normalizedAllocations = normalizeAllocationItems(payload?.allocations);
  if (!normalizedAllocations.ok) return normalizedAllocations;

  const scopes = warehouseScopeIds(requestContext);
  const payment = await repository.getCustomerPaymentById(client, {
    installationId: requestContext.installationId,
    id: id.trim(),
    warehouseIds: scopes,
  });
  if (!payment) return failure('CUSTOMER_PAYMENT_NOT_FOUND', 'Customer payment was not found');
  if (payment.status === 'reversed') {
    return failure('CUSTOMER_PAYMENT_REVERSED', 'A reversed payment cannot be allocated');
  }

  const validation = await validateAllocationTargets(client, {
    requestContext,
    sourcePayment: payment,
    items: normalizedAllocations.items,
  });
  if (!validation.ok) return validation;

  try {
    await repository.setReceivableWriteContext(client);
    await applyAllocations(client, {
      requestContext,
      sourcePayment: payment,
      items: normalizedAllocations.items,
      allocationDate,
      targets: validation.targets,
    });
    const hydrated = await repository.getCustomerPaymentById(client, {
      installationId: requestContext.installationId,
      id: payment.id,
      warehouseIds: scopes,
    });
    return Object.freeze({
      ok: true,
      customerPayment: mapPayment(hydrated),
      action: 'allocate',
    });
  } catch (error) {
    const mapped = mapDatabaseError(error);
    if (mapped) return mapped;
    throw error;
  }
}

export async function reverseReceivableAllocation(client, {
  requestContext,
  id,
  payload,
}) {
  if (!isUuid(id)) {
    return failure('RECEIVABLE_ALLOCATION_NOT_FOUND', 'Receivable allocation was not found');
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
    return failure('RECEIVABLE_ALLOCATION_NOT_FOUND', 'Receivable allocation was not found');
  }
  if (allocation.reversal_id) {
    return Object.freeze({ ok: true, allocation: mapAllocation(allocation), replayed: true });
  }
  try {
    await repository.setReceivableWriteContext(client);
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
      action: 'reverse-allocation',
    });
  } catch (error) {
    const mapped = mapDatabaseError(error);
    if (mapped) return mapped;
    throw error;
  }
}

export async function reverseCustomerPayment(client, {
  requestContext,
  id,
  payload,
}) {
  if (!isUuid(id)) return failure('CUSTOMER_PAYMENT_NOT_FOUND', 'Customer payment was not found');
  const reason = text(payload?.reason, 2000);
  if (!reason) return failure('PAYMENT_REVERSAL_REASON_REQUIRED', 'A payment reversal reason is required');
  const scopes = warehouseScopeIds(requestContext);
  const payment = await repository.getCustomerPaymentById(client, {
    installationId: requestContext.installationId,
    id: id.trim(),
    warehouseIds: scopes,
    forUpdate: true,
  });
  if (!payment) return failure('CUSTOMER_PAYMENT_NOT_FOUND', 'Customer payment was not found');
  if (payment.status === 'reversed') {
    return Object.freeze({ ok: true, customerPayment: mapPayment(payment), replayed: true });
  }
  if (decimalToScaled(payment.allocated_amount, { allowZero: true }) !== 0n) {
    return failure('PAYMENT_ALLOCATION_EXISTS', 'Reverse active allocations before reversing the customer payment');
  }

  try {
    await repository.setReceivableWriteContext(client);
    const reversedAt = timestamp(requestContext.receivedAt);
    const reversed = await repository.reverseCustomerPayment(client, {
      installationId: requestContext.installationId,
      paymentId: payment.id,
      actorId: requestContext.actorId,
      reversedAt,
      reason,
    });
    const amount = decimalToScaled(payment.original_amount);
    await repository.insertCustomerPaymentLedgerEntry(client, {
      installationId: requestContext.installationId,
      paymentId: payment.id,
      customerId: payment.customer_id,
      currencyCode: payment.currency_code,
      entryType: 'CUSTOMER_PAYMENT_REVERSE',
      amount: scaledToDecimal(amount),
      documentNumber: payment.source_document_number,
      sourceRevision: String(Number(payment.revision) + 1),
      documentStatusAfter: 'reversed',
      actorId: requestContext.actorId,
      requestId: requestContext.requestId,
      sourceApp: requestContext.sourceApp,
      occurredAt: reversedAt,
      metadata: { reason, postingOrigin: 'runtime' },
    });
    const hydrated = await repository.getCustomerPaymentById(client, {
      installationId: requestContext.installationId,
      id: payment.id,
      warehouseIds: scopes,
    });
    return Object.freeze({
      ok: true,
      customerPayment: mapPayment(hydrated ?? reversed),
      action: 'reverse',
    });
  } catch (error) {
    const mapped = mapDatabaseError(error);
    if (mapped) return mapped;
    throw error;
  }
}

export const customerPaymentInternals = Object.freeze({
  decimalToScaled,
  scaledToDecimal,
  mapDatabaseError,
  normalizeAllocationItems,
});

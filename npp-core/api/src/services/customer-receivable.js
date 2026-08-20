import { randomUUID } from 'node:crypto';
import {
  buildAuditRecord,
  buildOutboxEvent,
  insertAuditRecord,
  insertOutboxEvent,
} from '../audit-outbox.js';
import * as repository from '../db/repositories/customer-receivable.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AMOUNT_SCALE = 1_000_000n;
const QUANTITY_SCALE = 1_000_000_000_000n;
const AMOUNT_PATTERN = /^-?(0|[1-9]\d*)(?:\.(\d{1,6}))?$/;
const QUANTITY_PATTERN = /^(0|[1-9]\d*)(?:\.(\d{1,12}))?$/;

function failure(code, message, retryable = false, details = {}) {
  return Object.freeze({ ok: false, code, message, retryable, details });
}

function isUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value.trim());
}

function text(value, max = 256) {
  if (value == null || value === '') return null;
  const normalized = String(value).trim();
  return normalized && normalized.length <= max ? normalized : null;
}

function parseScaled(value, pattern, scale, decimals) {
  const match = pattern.exec(String(value ?? '').trim());
  if (!match) return null;
  const negative = String(value).trim().startsWith('-');
  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? '').padEnd(decimals, '0'));
  const result = whole * scale + fraction;
  return negative ? -result : result;
}

function parseAmount(value) {
  return parseScaled(value, AMOUNT_PATTERN, AMOUNT_SCALE, 6);
}

function parseQuantity(value) {
  return parseScaled(value, QUANTITY_PATTERN, QUANTITY_SCALE, 12);
}

function formatScaled(value, scale, decimals) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return `${negative ? '-' : ''}${absolute / scale}.${String(absolute % scale).padStart(decimals, '0')}`;
}

function formatAmount(value) {
  return formatScaled(value, AMOUNT_SCALE, 6);
}

function formatQuantity(value) {
  return formatScaled(value, QUANTITY_SCALE, 12);
}

function roundPositiveDivision(numerator, denominator) {
  if (numerator < 0n || denominator <= 0n) throw new Error('invalid_receivable_proration');
  return (numerator + denominator / 2n) / denominator;
}

function prorateAmount(amount, acceptedQuantity, totalQuantity) {
  return roundPositiveDivision(amount * acceptedQuantity, totalQuantity);
}

function dateOnlyInVietnam(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(parsed);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return year && month && day ? `${year}-${month}-${day}` : null;
}

function timestamp(value, fallback = new Date().toISOString()) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const parsed = new Date(String(value ?? ''));
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function warehouseScopeIds(requestContext) {
  return Array.isArray(requestContext?.scopes?.warehouseIds)
    ? [...new Set(requestContext.scopes.warehouseIds.filter(isUuid).map((value) => value.trim()))]
    : [];
}

function warehouseAllowed(requestContext, warehouseId) {
  return warehouseScopeIds(requestContext).includes(warehouseId);
}

function mapLine(row) {
  return Object.freeze({
    id: row.id,
    lineNumber: Number(row.line_number),
    salesOrderLineId: row.sales_order_line_id,
    deliveryOrderLineId: row.delivery_order_line_id,
    deliveryAttemptLineId: row.delivery_attempt_line_id ?? null,
    inventoryIssueLineId: row.inventory_issue_line_id,
    acceptedBaseQuantity: String(row.accepted_base_quantity),
    salesLineBaseQuantitySnapshot: String(row.sales_line_base_quantity_snapshot),
    sku: row.sku_snapshot,
    itemName: row.item_name_snapshot,
    unitCode: row.unit_code_snapshot,
    grossAmount: String(row.gross_amount),
    discountAmount: String(row.discount_amount),
    taxAmount: String(row.tax_amount),
    lineAmount: String(row.line_amount),
  });
}

function mapLedgerEntry(row) {
  return Object.freeze({
    id: row.id,
    entryType: row.entry_type,
    amount: String(row.amount),
    sourceDocumentType: row.source_document_type,
    sourceDocumentId: row.source_document_id,
    sourceDocumentNumber: row.source_document_number,
    sourceRevision: String(row.source_revision),
    documentStatusAfter: row.document_status_after,
    actorId: row.actor_id,
    requestId: row.request_id,
    sourceApp: row.source_app,
    occurredAt: timestamp(row.occurred_at),
    metadata: row.metadata ?? {},
  });
}

function mapDocument(row) {
  return Object.freeze({
    id: row.id,
    customerId: row.customer_id,
    customerCode: row.customer_code ?? row.customer_code_snapshot,
    customerName: row.customer_name ?? row.customer_name_snapshot,
    customerAddressId: row.customer_address_id ?? null,
    warehouseId: row.warehouse_id,
    warehouseCode: row.warehouse_code ?? row.warehouse_code_snapshot,
    warehouseName: row.warehouse_name ?? row.warehouse_name_snapshot,
    salesOrderId: row.sales_order_id,
    salesOrderNumber: row.sales_order_number ?? null,
    salesOrderVersionId: row.sales_order_version_id,
    deliveryOrderId: row.delivery_order_id,
    deliveryOrderNumber: row.delivery_order_number ?? null,
    direction: row.direction,
    documentType: row.document_type,
    sourceDocumentType: row.source_document_type,
    sourceDocumentId: row.source_document_id,
    sourceDocumentNumber: row.source_document_number,
    sourceDocumentDate: String(row.source_document_date).slice(0, 10),
    collectionPolicy: row.collection_policy,
    currencyCode: row.currency_code,
    originalAmount: String(row.original_amount),
    allocatedAmount: String(row.allocated_amount),
    remainingAmount: String(row.remaining_amount),
    status: row.status,
    sourceRevision: String(row.source_revision),
    postingOrigin: row.posting_origin,
    postedAt: timestamp(row.posted_at),
    postedBy: row.posted_by,
    reversedAt: row.reversed_at ? timestamp(row.reversed_at) : null,
    reversedBy: row.reversed_by ?? null,
    reversalReason: row.reversal_reason ?? null,
    revision: String(row.revision),
    lines: Object.freeze((row.lines ?? []).map(mapLine)),
    ledgerEntries: Object.freeze((row.ledger_entries ?? []).map(mapLedgerEntry)),
  });
}

function mapBalance(row) {
  return Object.freeze({
    customerId: row.customer_id,
    customerCode: row.customer_code,
    customerName: row.customer_name,
    currencyCode: row.currency_code,
    balance: String(row.balance),
    openAmount: String(row.open_amount),
    openDocumentCount: Number(row.open_document_count),
    updatedAt: timestamp(row.updated_at),
  });
}

function normalizePagination(limit, offset) {
  const parsedLimit = Number(limit ?? 100);
  const parsedOffset = Number(offset ?? 0);
  if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 1000) {
    return failure('INVALID_LIMIT', 'limit must be an integer between 1 and 1000');
  }
  if (!Number.isInteger(parsedOffset) || parsedOffset < 0 || parsedOffset > 100000) {
    return failure('INVALID_OFFSET', 'offset must be an integer between 0 and 100000');
  }
  return Object.freeze({ ok: true, limit: parsedLimit, offset: parsedOffset });
}

function previousTotalsMap(rows) {
  return new Map(rows.map((row) => [row.sales_order_line_id, {
    quantity: parseQuantity(row.accepted_base_quantity) ?? 0n,
    gross: parseAmount(row.gross_amount) ?? 0n,
    discount: parseAmount(row.discount_amount) ?? 0n,
    tax: parseAmount(row.tax_amount) ?? 0n,
    total: parseAmount(row.line_amount) ?? 0n,
  }]));
}

function buildPostingLines(sourceLines, previousRows) {
  const running = previousTotalsMap(previousRows);
  const lines = [];
  let documentTotal = 0n;

  for (const row of sourceLines) {
    const accepted = parseQuantity(row.accepted_base_quantity);
    const totalQuantity = parseQuantity(row.sales_line_base_quantity);
    const originalGross = parseAmount(row.line_subtotal);
    const originalDiscount = parseAmount(row.discount_amount);
    const originalTax = parseAmount(row.tax_amount);
    const originalTotal = parseAmount(row.line_total);
    if ([accepted, totalQuantity, originalGross, originalDiscount, originalTax, originalTotal].some((value) => value === null)) {
      return failure('RECEIVABLE_SOURCE_SNAPSHOT_INVALID', 'Stored sales amount or quantity snapshot is invalid');
    }
    if (accepted <= 0n || totalQuantity <= 0n) {
      return failure('RECEIVABLE_SOURCE_QUANTITY_INVALID', 'Accepted quantity must be positive');
    }

    const previous = running.get(row.sales_order_line_id) ?? {
      quantity: 0n,
      gross: 0n,
      discount: 0n,
      tax: 0n,
      total: 0n,
    };
    const nextQuantity = previous.quantity + accepted;
    if (nextQuantity > totalQuantity) {
      return failure(
        'RECEIVABLE_QUANTITY_EXCEEDS_SALES_LINE',
        'Cumulative accepted quantity exceeds the confirmed Sales Order line',
        true,
        { salesOrderLineId: row.sales_order_line_id },
      );
    }

    const completesLine = nextQuantity === totalQuantity;
    const gross = completesLine
      ? originalGross - previous.gross
      : prorateAmount(originalGross, accepted, totalQuantity);
    const discount = completesLine
      ? originalDiscount - previous.discount
      : prorateAmount(originalDiscount, accepted, totalQuantity);
    const tax = completesLine
      ? originalTax - previous.tax
      : prorateAmount(originalTax, accepted, totalQuantity);
    const lineAmount = gross - discount + tax;

    if (gross < 0n || discount < 0n || tax < 0n || lineAmount < 0n) {
      return failure('RECEIVABLE_RESIDUAL_INVALID', 'Stored sales rounding residual is invalid');
    }
    if (completesLine && lineAmount !== originalTotal - previous.total) {
      return failure('RECEIVABLE_SOURCE_TOTAL_MISMATCH', 'Stored sales total does not reconcile with line components');
    }

    lines.push(Object.freeze({
      id: randomUUID(),
      lineNumber: Number(row.line_number),
      salesOrderLineId: row.sales_order_line_id,
      deliveryOrderLineId: row.delivery_order_line_id,
      deliveryAttemptLineId: row.delivery_attempt_line_id ?? null,
      inventoryIssueLineId: row.inventory_issue_line_id,
      acceptedBaseQuantity: formatQuantity(accepted),
      salesLineBaseQuantitySnapshot: formatQuantity(totalQuantity),
      skuSnapshot: row.sku_snapshot,
      itemNameSnapshot: row.item_name_snapshot,
      unitCodeSnapshot: row.unit_code_snapshot,
      grossAmount: formatAmount(gross),
      discountAmount: formatAmount(discount),
      taxAmount: formatAmount(tax),
      lineAmount: formatAmount(lineAmount),
    }));
    documentTotal += lineAmount;
    running.set(row.sales_order_line_id, {
      quantity: nextQuantity,
      gross: previous.gross + gross,
      discount: previous.discount + discount,
      tax: previous.tax + tax,
      total: previous.total + lineAmount,
    });
  }

  return Object.freeze({ ok: true, lines: Object.freeze(lines), documentTotal });
}

async function postFromSource(client, {
  requestContext,
  sourceDocumentType,
  sourceDocumentId,
  documentType,
  loadSource,
}) {
  if (!isUuid(sourceDocumentId)) {
    return failure('RECEIVABLE_SOURCE_NOT_FOUND', 'Receivable source was not found');
  }
  await repository.setReceivableWriteContext(client);
  await repository.lockReceivableSource(client, {
    installationId: requestContext.installationId,
    sourceDocumentType,
    sourceDocumentId,
  });

  const existing = await repository.getReceivableDocumentBySource(client, {
    installationId: requestContext.installationId,
    sourceDocumentType,
    sourceDocumentId,
  });
  if (existing) {
    const hydrated = await repository.getReceivableDocumentById(client, {
      installationId: requestContext.installationId,
      id: existing.id,
      warehouseIds: warehouseScopeIds(requestContext),
    });
    return Object.freeze({
      ok: true,
      receivableDocument: hydrated ? mapDocument(hydrated) : null,
      replayed: true,
      skipped: false,
    });
  }

  const source = await loadSource(client, {
    installationId: requestContext.installationId,
    sourceId: sourceDocumentId,
  });
  if (!source) return failure('RECEIVABLE_SOURCE_NOT_FOUND', 'Accepted delivery or pickup source was not found');
  if (!warehouseAllowed(requestContext, source.warehouse_id)) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Receivable source is outside the authorized warehouse scope');
  }
  if (!Array.isArray(source.lines) || source.lines.length === 0) {
    return failure('RECEIVABLE_SOURCE_LINES_REQUIRED', 'Accepted source has no positive delivered quantity');
  }

  const salesOrderLineIds = [...new Set(source.lines.map((line) => line.sales_order_line_id))].sort();
  await repository.lockSalesOrderLines(client, {
    installationId: requestContext.installationId,
    salesOrderLineIds,
  });
  const previousRows = await repository.getPreviouslyPostedLineTotals(client, {
    installationId: requestContext.installationId,
    salesOrderLineIds,
  });
  const posting = buildPostingLines(source.lines, previousRows);
  if (!posting.ok) return posting;
  if (posting.documentTotal === 0n) {
    return Object.freeze({ ok: true, receivableDocument: null, replayed: false, skipped: true });
  }

  const postedAt = timestamp(source.occurred_at, requestContext.receivedAt);
  const sourceDocumentDate = dateOnlyInVietnam(postedAt);
  if (!sourceDocumentDate) return failure('RECEIVABLE_SOURCE_DATE_INVALID', 'Accepted source time is invalid');
  const receivableDocumentId = randomUUID();
  await repository.insertReceivableDocument(client, {
    id: receivableDocumentId,
    installationId: requestContext.installationId,
    customerId: source.customer_id,
    customerAddressId: source.customer_address_id,
    warehouseId: source.warehouse_id,
    salesOrderId: source.sales_order_id,
    salesOrderVersionId: source.sales_order_version_id,
    deliveryOrderId: source.delivery_order_id,
    documentType,
    sourceDocumentType,
    sourceDocumentId,
    sourceDocumentNumber: source.delivery_order_number,
    sourceDocumentDate,
    customerCodeSnapshot: source.customer_code_snapshot,
    customerNameSnapshot: source.customer_name_snapshot,
    warehouseCodeSnapshot: source.warehouse_code_snapshot,
    warehouseNameSnapshot: source.warehouse_name_snapshot,
    collectionPolicy: source.collection_policy,
    currencyCode: source.currency_code,
    originalAmount: formatAmount(posting.documentTotal),
    sourceRevision: String(source.source_revision ?? 1),
    postedAt,
    actorId: requestContext.actorId,
  });
  for (const line of posting.lines) {
    await repository.insertReceivableLine(client, {
      ...line,
      installationId: requestContext.installationId,
      receivableDocumentId,
      createdAt: postedAt,
      actorId: requestContext.actorId,
    });
  }
  await repository.insertReceivableLedgerEntry(client, {
    id: randomUUID(),
    installationId: requestContext.installationId,
    receivableDocumentId,
    customerId: source.customer_id,
    currencyCode: source.currency_code,
    amount: formatAmount(posting.documentTotal),
    sourceDocumentType,
    sourceDocumentId,
    sourceDocumentNumber: source.delivery_order_number,
    sourceRevision: String(source.source_revision ?? 1),
    actorId: requestContext.actorId,
    requestId: requestContext.requestId,
    sourceApp: requestContext.sourceApp,
    occurredAt: postedAt,
    metadata: {
      salesOrderId: source.sales_order_id,
      deliveryOrderId: source.delivery_order_id,
      warehouseId: source.warehouse_id,
      collectionPolicy: source.collection_policy,
      postingOrigin: 'runtime',
    },
  });

  const hydrated = await repository.getReceivableDocumentById(client, {
    installationId: requestContext.installationId,
    id: receivableDocumentId,
    warehouseIds: [source.warehouse_id],
  });
  if (!hydrated) return failure('RECEIVABLE_POSTING_READBACK_FAILED', 'Posted receivable could not be read back', true);
  const mapped = mapDocument(hydrated);
  const audit = buildAuditRecord({
    requestContext,
    action: 'accounting.receivable.post',
    resourceType: 'receivable_document',
    resourceId: receivableDocumentId,
    afterData: mapped,
    metadata: {
      sourceDocumentType,
      sourceDocumentId,
      salesOrderId: source.sales_order_id,
      deliveryOrderId: source.delivery_order_id,
      warehouseId: source.warehouse_id,
    },
    occurredAt: postedAt,
  });
  const outbox = buildOutboxEvent({
    requestContext,
    aggregateType: 'accounting.receivable_document',
    aggregateId: receivableDocumentId,
    eventType: 'core.receivable.posted',
    eventVersion: 1,
    payload: mapped,
    metadata: {
      sourceDocumentType,
      sourceDocumentId,
      customerId: source.customer_id,
      warehouseId: source.warehouse_id,
    },
    createdAt: postedAt,
    availableAt: postedAt,
  });
  await insertAuditRecord(client, audit);
  await insertOutboxEvent(client, outbox);
  return Object.freeze({
    ok: true,
    receivableDocument: mapped,
    replayed: false,
    skipped: false,
    auditId: audit.auditId,
    eventId: outbox.eventId,
  });
}

export function postReceivableFromDeliveryAttempt(client, {
  requestContext,
  attemptId,
}) {
  return postFromSource(client, {
    requestContext,
    sourceDocumentType: 'DELIVERY_ATTEMPT',
    sourceDocumentId: attemptId,
    documentType: 'SALE_DELIVERY',
    loadSource: (adapter, { installationId, sourceId }) => repository.getDeliveryAttemptSource(adapter, {
      installationId,
      attemptId: sourceId,
    }),
  });
}

export function postReceivableFromPickupHandover(client, {
  requestContext,
  issueId,
}) {
  return postFromSource(client, {
    requestContext,
    sourceDocumentType: 'PICKUP_HANDOVER',
    sourceDocumentId: issueId,
    documentType: 'SALE_PICKUP',
    loadSource: (adapter, { installationId, sourceId }) => repository.getPickupHandoverSource(adapter, {
      installationId,
      issueId: sourceId,
    }),
  });
}

export async function listReceivableDocuments(client, input) {
  const scopes = warehouseScopeIds(input.requestContext);
  if (!scopes.length) return failure('WAREHOUSE_SCOPE_DENIED', 'At least one authorized warehouse is required');
  const pagination = normalizePagination(input.limit, input.offset);
  if (!pagination.ok) return pagination;
  const customerId = input.customerId == null || input.customerId === '' ? null : String(input.customerId).trim();
  if (customerId && !isUuid(customerId)) return failure('INVALID_CUSTOMER_ID', 'Customer ID must be a valid UUID');
  const warehouseId = input.warehouseId == null || input.warehouseId === '' ? null : String(input.warehouseId).trim();
  if (warehouseId && (!isUuid(warehouseId) || !warehouseAllowed(input.requestContext, warehouseId))) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Warehouse is outside the authorized scope');
  }
  const status = input.status == null || input.status === '' ? null : String(input.status).trim();
  if (status && !new Set(['open', 'partially_allocated', 'settled', 'reversed']).has(status)) {
    return failure('INVALID_STATUS', 'Invalid receivable status');
  }
  const sourceDocumentType = input.sourceDocumentType == null || input.sourceDocumentType === ''
    ? null
    : String(input.sourceDocumentType).trim().toUpperCase();
  if (sourceDocumentType && !new Set([
    'DELIVERY_ATTEMPT',
    'PICKUP_HANDOVER',
    'MANUAL_SALES_ORDER',
    'DIRECT_PICKUP_SALES_ORDER',
  ]).has(sourceDocumentType)) {
    return failure('INVALID_SOURCE_DOCUMENT_TYPE', 'Invalid receivable source type');
  }
  const search = text(input.search, 256);
  if (input.search && !search) return failure('INVALID_SEARCH', 'Search must not exceed 256 characters');
  const rows = await repository.listReceivableDocuments(client, {
    installationId: input.requestContext.installationId,
    warehouseIds: scopes,
    customerId,
    warehouseId,
    status,
    sourceDocumentType,
    search,
    limit: pagination.limit,
    offset: pagination.offset,
  });
  return Object.freeze({ ok: true, receivableDocuments: Object.freeze(rows.map(mapDocument)) });
}

export async function getReceivableDocument(client, { requestContext, id }) {
  if (!isUuid(id)) return failure('RECEIVABLE_DOCUMENT_NOT_FOUND', 'Receivable document was not found');
  const scopes = warehouseScopeIds(requestContext);
  if (!scopes.length) return failure('WAREHOUSE_SCOPE_DENIED', 'At least one authorized warehouse is required');
  const row = await repository.getReceivableDocumentById(client, {
    installationId: requestContext.installationId,
    id: id.trim(),
    warehouseIds: scopes,
  });
  return row
    ? Object.freeze({ ok: true, receivableDocument: mapDocument(row) })
    : failure('RECEIVABLE_DOCUMENT_NOT_FOUND', 'Receivable document was not found');
}

export async function listCustomerReceivableBalances(client, input) {
  const scopes = warehouseScopeIds(input.requestContext);
  if (!scopes.length) return failure('WAREHOUSE_SCOPE_DENIED', 'At least one authorized warehouse is required');
  const pagination = normalizePagination(input.limit, input.offset);
  if (!pagination.ok) return pagination;
  const customerId = input.customerId == null || input.customerId === '' ? null : String(input.customerId).trim();
  if (customerId && !isUuid(customerId)) return failure('INVALID_CUSTOMER_ID', 'Customer ID must be a valid UUID');
  const search = text(input.search, 256);
  if (input.search && !search) return failure('INVALID_SEARCH', 'Search must not exceed 256 characters');
  const rows = await repository.listCustomerReceivableBalances(client, {
    installationId: input.requestContext.installationId,
    warehouseIds: scopes,
    customerId,
    search,
    limit: pagination.limit,
    offset: pagination.offset,
  });
  return Object.freeze({ ok: true, balances: Object.freeze(rows.map(mapBalance)) });
}

export const customerReceivableInternals = Object.freeze({
  parseAmount,
  parseQuantity,
  formatAmount,
  formatQuantity,
  prorateAmount,
  buildPostingLines,
  dateOnlyInVietnam,
});

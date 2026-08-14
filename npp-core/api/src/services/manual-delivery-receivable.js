import { randomUUID } from 'node:crypto';
import {
  buildAuditRecord,
  buildOutboxEvent,
  insertAuditRecord,
  insertOutboxEvent,
} from '../audit-outbox.js';
import * as repository from '../db/repositories/customer-receivable.js';
import * as manualRepository from '../db/repositories/sales-manual-delivery.js';
import { customerReceivableInternals } from './customer-receivable.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function failure(code, message, retryable = false, details = {}) {
  return Object.freeze({ ok: false, code, message, retryable, details });
}

function warehouseIds(requestContext) {
  return Array.isArray(requestContext?.scopes?.warehouseIds)
    ? [...new Set(requestContext.scopes.warehouseIds.filter((value) => UUID_PATTERN.test(String(value))))]
    : [];
}

function mapLine(row) {
  return Object.freeze({
    id: row.id,
    lineNumber: Number(row.line_number),
    salesOrderLineId: row.sales_order_line_id,
    deliveryOrderLineId: row.delivery_order_line_id,
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
    occurredAt: row.occurred_at,
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
    postedAt: row.posted_at,
    postedBy: row.posted_by,
    revision: String(row.revision),
    lines: Object.freeze((row.lines ?? []).map(mapLine)),
    ledgerEntries: Object.freeze((row.ledger_entries ?? []).map(mapLedgerEntry)),
  });
}

export async function postReceivableFromManualHandover(client, {
  requestContext,
  issueId,
}) {
  if (!UUID_PATTERN.test(String(issueId ?? ''))) {
    return failure('RECEIVABLE_SOURCE_NOT_FOUND', 'Manual handover source was not found');
  }

  const sourceDocumentType = 'MANUAL_HANDOVER';
  await repository.setReceivableWriteContext(client);
  await repository.lockReceivableSource(client, {
    installationId: requestContext.installationId,
    sourceDocumentType,
    sourceDocumentId: issueId,
  });

  const existing = await repository.getReceivableDocumentBySource(client, {
    installationId: requestContext.installationId,
    sourceDocumentType,
    sourceDocumentId: issueId,
  });
  if (existing) {
    const hydrated = await repository.getReceivableDocumentById(client, {
      installationId: requestContext.installationId,
      id: existing.id,
      warehouseIds: warehouseIds(requestContext),
    });
    return Object.freeze({
      ok: true,
      receivableDocument: hydrated ? mapDocument(hydrated) : null,
      replayed: true,
      skipped: false,
    });
  }

  const source = await manualRepository.getManualHandoverReceivableSource(client, {
    installationId: requestContext.installationId,
    issueId,
  });
  if (!source) return failure('RECEIVABLE_SOURCE_NOT_FOUND', 'Manual handover source was not found');
  if (!warehouseIds(requestContext).includes(source.warehouse_id)) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Manual handover is outside the authorized warehouse scope');
  }
  if (!Array.isArray(source.lines) || source.lines.length === 0) {
    return failure('RECEIVABLE_SOURCE_LINES_REQUIRED', 'Manual handover has no positive delivered quantity');
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
  const posting = customerReceivableInternals.buildPostingLines(source.lines, previousRows);
  if (!posting.ok) return posting;
  if (posting.documentTotal === 0n) {
    return Object.freeze({ ok: true, receivableDocument: null, replayed: false, skipped: true });
  }

  const postedAt = new Date(source.occurred_at).toISOString();
  const sourceDocumentDate = customerReceivableInternals.dateOnlyInVietnam(postedAt);
  if (!sourceDocumentDate) return failure('RECEIVABLE_SOURCE_DATE_INVALID', 'Manual handover time is invalid');
  const receivableDocumentId = randomUUID();
  const amount = customerReceivableInternals.formatAmount(posting.documentTotal);

  await repository.insertReceivableDocument(client, {
    id: receivableDocumentId,
    installationId: requestContext.installationId,
    customerId: source.customer_id,
    customerAddressId: source.customer_address_id,
    warehouseId: source.warehouse_id,
    salesOrderId: source.sales_order_id,
    salesOrderVersionId: source.sales_order_version_id,
    deliveryOrderId: source.delivery_order_id,
    documentType: 'SALE_DELIVERY',
    sourceDocumentType,
    sourceDocumentId: issueId,
    sourceDocumentNumber: source.delivery_order_number,
    sourceDocumentDate,
    customerCodeSnapshot: source.customer_code_snapshot,
    customerNameSnapshot: source.customer_name_snapshot,
    warehouseCodeSnapshot: source.warehouse_code_snapshot,
    warehouseNameSnapshot: source.warehouse_name_snapshot,
    collectionPolicy: source.collection_policy,
    currencyCode: source.currency_code,
    originalAmount: amount,
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
    amount,
    sourceDocumentType,
    sourceDocumentId: issueId,
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
      handoverMode: 'MANUAL',
    },
  });

  const hydrated = await repository.getReceivableDocumentById(client, {
    installationId: requestContext.installationId,
    id: receivableDocumentId,
    warehouseIds: [source.warehouse_id],
  });
  if (!hydrated) return failure('RECEIVABLE_POSTING_READBACK_FAILED', 'Manual handover receivable could not be read back', true);
  const mapped = mapDocument(hydrated);
  const audit = buildAuditRecord({
    requestContext,
    action: 'accounting.receivable.post',
    resourceType: 'receivable_document',
    resourceId: receivableDocumentId,
    afterData: mapped,
    metadata: {
      sourceDocumentType,
      sourceDocumentId: issueId,
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
      sourceDocumentId: issueId,
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

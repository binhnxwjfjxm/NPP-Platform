import { randomUUID } from 'node:crypto';
import { IDEMPOTENCY_KEY_PATTERN } from '@npp/contracts';
import { deriveIdempotencyKey } from '../idempotency-derived.js';
import {
  buildAuditRecord,
  buildOutboxEvent,
  insertAuditRecord,
  insertOutboxEvent,
} from '../audit-outbox.js';
import { auditOutboxEffect } from '../audit-outbox-effects.js';
import * as receivableRepository from '../db/repositories/customer-receivable.js';
import * as customerPaymentService from './customer-payment.js';

function failure(code, message, retryable = false, details = {}) {
  return Object.freeze({ ok: false, code, message, retryable, details });
}

function warehouseAllowed(requestContext, warehouseId) {
  return Array.isArray(requestContext?.scopes?.warehouseIds)
    && requestContext.scopes.warehouseIds.includes(warehouseId);
}

function vietnamDate(value) {
  const parsed = new Date(String(value ?? ''));
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  return new Date(date.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function lockSource(client, { installationId, salesOrderId }) {
  const result = await client.query(
    `SELECT orders.id,
            orders.order_number,
            orders.status,
            orders.fulfillment_status,
            orders.delivery_status,
            orders.settlement_status,
            orders.revision,
            version.id AS sales_order_version_id,
            version.version_number,
            version.customer_id,
            version.customer_address_id,
            version.warehouse_id,
            version.customer_code_snapshot,
            version.customer_name_snapshot,
            version.warehouse_code_snapshot,
            version.warehouse_name_snapshot,
            version.delivery_mode,
            version.delivery_execution_mode,
            version.collection_policy,
            version.currency_code,
            version.total
       FROM sales.sales_orders orders
       JOIN sales.sales_order_versions version
         ON version.installation_id = orders.installation_id
        AND version.sales_order_id = orders.id
        AND version.version_number = orders.current_version_number
      WHERE orders.installation_id = $1
        AND orders.id = $2::uuid
      FOR UPDATE OF orders, version`,
    [installationId, salesOrderId],
  );
  return result.rows?.[0] ?? null;
}

async function loadLines(client, { installationId, salesOrderVersionId }) {
  const result = await client.query(
    `SELECT id,
            line_number,
            base_quantity,
            sku_snapshot,
            item_name_snapshot,
            unit_code_snapshot,
            line_subtotal,
            discount_amount,
            tax_amount,
            line_total
       FROM sales.sales_order_version_lines
      WHERE installation_id = $1
        AND sales_order_version_id = $2::uuid
      ORDER BY line_number, id`,
    [installationId, salesOrderVersionId],
  );
  return result.rows ?? [];
}

async function loadManualReceivable(client, { installationId, salesOrderId }) {
  const result = await client.query(
    `SELECT id,
            source_document_date,
            original_amount,
            allocated_amount,
            remaining_amount,
            status,
            revision
       FROM accounting.receivable_documents
      WHERE installation_id = $1
        AND source_document_type = 'MANUAL_SALES_ORDER'
        AND source_document_id = $2::uuid
      FOR UPDATE`,
    [installationId, salesOrderId],
  );
  return result.rows?.[0] ?? null;
}

function validateManualIssued(source, requestContext) {
  if (!source) return failure('SALES_ORDER_NOT_FOUND', 'Không tìm thấy đơn bán hàng');
  if (source.delivery_mode !== 'DELIVERY' || source.delivery_execution_mode !== 'MANUAL') {
    return failure('MANUAL_ORDER_ACTION_NOT_AVAILABLE', 'Thao tác này chỉ áp dụng cho đơn Giao thủ công');
  }
  if (!warehouseAllowed(requestContext, source.warehouse_id)) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Đơn nằm ngoài phạm vi kho được cấp quyền');
  }
  if (source.fulfillment_status !== 'issued') {
    return failure('MANUAL_ORDER_NOT_ISSUED', 'Hãy Xuất kho trước khi Hoàn thành đơn');
  }
  return Object.freeze({ ok: true });
}

function checkRevision(source, expectedRevision) {
  if (String(source.revision) === String(expectedRevision ?? '')) return null;
  return failure(
    'MANUAL_ORDER_CONFLICT',
    'Đơn đã thay đổi. Hãy tải lại trước khi tiếp tục',
    false,
    { currentRevision: String(source.revision) },
  );
}

async function writeReceivableAuditOutbox(client, { requestContext, receivable }) {
  await insertAuditRecord(client, buildAuditRecord({
    requestContext,
    action: 'post_manual_sales_order_receivable',
    resourceType: 'accounting.receivable_document',
    resourceId: receivable.id,
    beforeData: null,
    afterData: receivable,
    metadata: {
      sourceDocumentType: 'MANUAL_SALES_ORDER',
      salesOrderId: receivable.sales_order_id,
      postingOrigin: 'manual_sales_order_delivery_complete',
    },
  }));
  await insertOutboxEvent(client, buildOutboxEvent({
    requestContext,
    aggregateType: 'accounting.receivable_document',
    aggregateId: receivable.id,
    eventType: 'accounting.receivable.manual_sales_order.posted',
    eventVersion: Number(receivable.revision ?? 1),
    payload: receivable,
    metadata: {
      salesOrderId: receivable.sales_order_id,
      postingOrigin: 'manual_sales_order_delivery_complete',
    },
  }));
}

async function writePaymentAuditOutbox(client, { requestContext, customerPayment }) {
  await insertAuditRecord(client, buildAuditRecord({
    requestContext,
    action: 'create',
    resourceType: 'accounting.customer_payment',
    resourceId: customerPayment.id,
    beforeData: null,
    afterData: customerPayment,
    metadata: { source: 'manual_sales_order_payment' },
  }));
  await insertOutboxEvent(client, buildOutboxEvent({
    requestContext,
    aggregateType: 'accounting.customer_payment',
    aggregateId: customerPayment.id,
    eventType: 'accounting.customer_payment.posted',
    eventVersion: 1,
    payload: customerPayment,
    metadata: { source: 'manual_sales_order_payment' },
  }));
}

async function postReceivable(client, { requestContext, source }) {
  const sourceDocumentType = 'MANUAL_SALES_ORDER';
  await receivableRepository.lockReceivableSource(client, {
    installationId: requestContext.installationId,
    sourceDocumentType,
    sourceDocumentId: source.id,
  });
  const existing = await loadManualReceivable(client, {
    installationId: requestContext.installationId,
    salesOrderId: source.id,
  });
  if (existing) {
    return Object.freeze({
      ok: true,
      receivable: existing,
      documentDate: String(existing.source_document_date).slice(0, 10),
      replayed: true,
    });
  }

  const lines = await loadLines(client, {
    installationId: requestContext.installationId,
    salesOrderVersionId: source.sales_order_version_id,
  });
  if (!lines.length) return failure('MANUAL_ORDER_NO_LINES', 'Đơn không có dòng hàng để ghi nhận doanh số');

  await receivableRepository.lockSalesOrderLines(client, {
    installationId: requestContext.installationId,
    salesOrderLineIds: lines.map((line) => line.id),
  });
  await receivableRepository.setReceivableWriteContext(client);

  const receivableId = randomUUID();
  const postedAt = new Date(String(requestContext.receivedAt ?? Date.now())).toISOString();
  const documentDate = vietnamDate(requestContext.receivedAt);
  const receivable = await receivableRepository.insertReceivableDocument(client, {
    id: receivableId,
    installationId: requestContext.installationId,
    customerId: source.customer_id,
    customerAddressId: source.customer_address_id,
    warehouseId: source.warehouse_id,
    salesOrderId: source.id,
    salesOrderVersionId: source.sales_order_version_id,
    deliveryOrderId: null,
    documentType: 'SALE_DELIVERY',
    sourceDocumentType,
    sourceDocumentId: source.id,
    sourceDocumentNumber: source.order_number,
    sourceDocumentDate: documentDate,
    customerCodeSnapshot: source.customer_code_snapshot,
    customerNameSnapshot: source.customer_name_snapshot,
    warehouseCodeSnapshot: source.warehouse_code_snapshot,
    warehouseNameSnapshot: source.warehouse_name_snapshot,
    collectionPolicy: source.collection_policy,
    currencyCode: source.currency_code,
    originalAmount: String(source.total),
    sourceRevision: String(source.revision),
    postedAt,
    actorId: requestContext.actorId,
  });

  for (const line of lines) {
    await receivableRepository.insertReceivableLine(client, {
      id: randomUUID(),
      installationId: requestContext.installationId,
      receivableDocumentId: receivable.id,
      lineNumber: line.line_number,
      salesOrderLineId: line.id,
      deliveryOrderLineId: null,
      deliveryAttemptLineId: null,
      inventoryIssueLineId: null,
      acceptedBaseQuantity: String(line.base_quantity),
      salesLineBaseQuantitySnapshot: String(line.base_quantity),
      skuSnapshot: line.sku_snapshot,
      itemNameSnapshot: line.item_name_snapshot,
      unitCodeSnapshot: line.unit_code_snapshot,
      grossAmount: String(line.line_subtotal),
      discountAmount: String(line.discount_amount),
      taxAmount: String(line.tax_amount),
      lineAmount: String(line.line_total),
      createdAt: postedAt,
      actorId: requestContext.actorId,
    });
  }

  await receivableRepository.insertReceivableLedgerEntry(client, {
    id: randomUUID(),
    installationId: requestContext.installationId,
    receivableDocumentId: receivable.id,
    customerId: source.customer_id,
    currencyCode: source.currency_code,
    amount: String(source.total),
    sourceDocumentType,
    sourceDocumentId: source.id,
    sourceDocumentNumber: source.order_number,
    sourceRevision: String(source.revision),
    actorId: requestContext.actorId,
    requestId: requestContext.requestId,
    sourceApp: requestContext.sourceApp,
    occurredAt: postedAt,
    metadata: {
      salesOrderId: source.id,
      salesOrderVersionId: source.sales_order_version_id,
      warehouseId: source.warehouse_id,
      postingOrigin: 'manual_sales_order_delivery_complete',
    },
  });
  await writeReceivableAuditOutbox(client, { requestContext, receivable });
  return Object.freeze({ ok: true, receivable, documentDate, replayed: false });
}

export async function completeManualSalesOrder(client, {
  requestContext,
  id,
  expectedRevision,
}) {
  const source = await lockSource(client, {
    installationId: requestContext.installationId,
    salesOrderId: id,
  });
  const valid = validateManualIssued(source, requestContext);
  if (!valid.ok) return valid;
  if (source.status === 'closed') {
    return failure('MANUAL_ORDER_ALREADY_COMPLETED', 'Đơn đã hoàn thành, không thể hoàn thành lần hai');
  }
  if (source.status !== 'confirmed') {
    return failure('MANUAL_ORDER_COMPLETE_NOT_AVAILABLE', 'Chỉ đơn đã Chốt và Xuất kho mới được Hoàn thành đơn');
  }
  const conflict = checkRevision(source, expectedRevision);
  if (conflict) return conflict;

  const { decimalToScaled } = customerPaymentService.customerPaymentInternals;
  const total = decimalToScaled(source.total, { allowZero: true });
  if (total === null) return failure('MANUAL_ORDER_TOTAL_INVALID', 'Tổng tiền đơn không hợp lệ');

  let receivable = null;
  let accountingEffect = auditOutboxEffect();
  if (total > 0n) {
    const posted = await postReceivable(client, { requestContext, source });
    if (!posted.ok) return posted;
    receivable = posted.receivable;
    if (!posted.replayed) accountingEffect = auditOutboxEffect(1, 1);
  }

  const updated = await client.query(
    `UPDATE sales.sales_orders
        SET status = 'closed',
            delivery_status = 'delivered',
            settlement_status = CASE WHEN $4 THEN 'paid' ELSE settlement_status END,
            revision = revision + 1,
            updated_at = now(),
            updated_by = $3
      WHERE installation_id = $1
        AND id = $2::uuid
        AND status = 'confirmed'
      RETURNING id, revision`,
    [requestContext.installationId, id, requestContext.actorId, total === 0n],
  );
  if (!updated.rows?.length) {
    return failure('MANUAL_ORDER_CONFLICT', 'Đơn đã thay đổi. Hãy tải lại trước khi tiếp tục');
  }
  return Object.freeze({ ok: true, action: 'complete', receivable, auditOutboxEffect: accountingEffect });
}

export async function settleManualSalesOrder(client, {
  requestContext,
  id,
  expectedRevision,
  payload,
  idempotencyKey,
}) {
  if (!IDEMPOTENCY_KEY_PATTERN.test(String(idempotencyKey ?? ''))) {
    return failure('INVALID_IDEMPOTENCY_KEY', 'Khóa chống ghi trùng không hợp lệ');
  }

  const source = await lockSource(client, {
    installationId: requestContext.installationId,
    salesOrderId: id,
  });
  const valid = validateManualIssued(source, requestContext);
  if (!valid.ok) return valid;
  if (source.status !== 'closed') {
    return failure('MANUAL_ORDER_SETTLEMENT_NOT_AVAILABLE', 'Hãy Hoàn thành đơn trước khi ghi nhận tiền thu hoặc nợ');
  }
  if (source.settlement_status === 'paid') {
    return failure('MANUAL_ORDER_ALREADY_SETTLED', 'Đơn đã thanh toán đủ');
  }
  if (!['pending', 'partially_paid'].includes(source.settlement_status)) {
    return failure('MANUAL_ORDER_SETTLEMENT_NOT_AVAILABLE', 'Đơn chưa có khoản phải thu để ghi nhận tiền');
  }
  const conflict = checkRevision(source, expectedRevision);
  if (conflict) return conflict;

  const receivable = await loadManualReceivable(client, {
    installationId: requestContext.installationId,
    salesOrderId: id,
  });
  if (!receivable || !['open', 'partially_allocated'].includes(receivable.status)) {
    return failure('MANUAL_ORDER_RECEIVABLE_NOT_FOUND', 'Không tìm thấy khoản phải thu đang mở của đơn');
  }

  const { decimalToScaled, scaledToDecimal } = customerPaymentService.customerPaymentInternals;
  const remaining = decimalToScaled(receivable.remaining_amount, { allowZero: true });
  const paid = decimalToScaled(payload?.paidAmount, { allowZero: true });
  if (remaining === null || remaining <= 0n) {
    return failure('MANUAL_ORDER_ALREADY_SETTLED', 'Đơn đã thanh toán đủ');
  }
  if (paid === null) {
    return failure('INVALID_PAYMENT_AMOUNT', 'Số tiền thực thu không hợp lệ');
  }
  if (paid > remaining) {
    return failure('PAYMENT_EXCEEDS_ORDER_TOTAL', 'Số tiền thu không được lớn hơn số tiền khách còn nợ');
  }

  if (paid === 0n) {
    return Object.freeze({
      ok: true,
      action: 'settlement',
      receivable,
      customerPayment: null,
      auditOutboxEffect: auditOutboxEffect(),
    });
  }

  const paymentMethod = String(payload?.paymentMethod ?? '').trim().toUpperCase();
  if (!paymentMethod) return failure('PAYMENT_METHOD_REQUIRED', 'Hãy chọn hình thức nhận tiền');
  const paymentDate = vietnamDate(requestContext.receivedAt);
  const paymentResult = await customerPaymentService.createCustomerPayment(client, {
    requestContext,
    idempotencyKey: deriveIdempotencyKey('manual-sales-payment', idempotencyKey),
    payload: {
      customerId: source.customer_id,
      warehouseId: source.warehouse_id,
      paymentDate,
      currencyCode: source.currency_code,
      paymentMethod,
      amount: scaledToDecimal(paid),
      externalReference: payload?.externalReference ?? undefined,
      note: payload?.note ?? undefined,
      remittingEmployeeId: payload?.remittingEmployeeId ?? undefined,
      allocations: [{
        receivableDocumentId: receivable.id,
        amount: scaledToDecimal(paid),
      }],
    },
  });
  if (!paymentResult.ok) return paymentResult;
  const customerPayment = paymentResult.customerPayment;
  await writePaymentAuditOutbox(client, { requestContext, customerPayment });

  return Object.freeze({
    ok: true,
    action: 'settlement',
    receivable,
    customerPayment,
    auditOutboxEffect: auditOutboxEffect(1, 1),
  });
}

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
import * as salesOrderRepository from '../db/repositories/sales-order.js';
import * as customerPaymentService from './customer-payment.js';

const DIRECT_COMPLETION_MODES = Object.freeze({
  MANUAL: Object.freeze({
    key: 'MANUAL',
    label: 'Giao thủ công',
    deliveryMode: 'DELIVERY',
    deliveryExecutionMode: 'MANUAL',
    errorPrefix: 'MANUAL_ORDER',
    sourceDocumentType: 'MANUAL_SALES_ORDER',
    documentType: 'SALE_DELIVERY',
    receivableAuditAction: 'post_manual_sales_order_receivable',
    receivableEventType: 'accounting.receivable.manual_sales_order.posted',
    postingOrigin: 'manual_sales_order_delivery_complete',
    paymentNamespace: 'manual-sales-payment',
    paymentSource: 'manual_sales_order_payment',
  }),
  PICKUP: Object.freeze({
    key: 'PICKUP',
    label: 'Giao tại quầy',
    deliveryMode: 'PICKUP',
    deliveryExecutionMode: null,
    errorPrefix: 'PICKUP_ORDER',
    sourceDocumentType: 'DIRECT_PICKUP_SALES_ORDER',
    documentType: 'SALE_PICKUP',
    receivableAuditAction: 'post_direct_pickup_sales_order_receivable',
    receivableEventType: 'accounting.receivable.direct_pickup_sales_order.posted',
    postingOrigin: 'direct_pickup_sales_order_complete',
    paymentNamespace: 'pickup-sales-payment',
    paymentSource: 'direct_pickup_sales_order_payment',
  }),
});

function directCompletionMode(mode) {
  return DIRECT_COMPLETION_MODES[String(mode ?? '').toUpperCase()] ?? null;
}

function directFailure(contract, suffix, message, retryable = false, details = {}) {
  return failure(`${contract.errorPrefix}_${suffix}`, message, retryable, details);
}

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
            version.customer_mode_snapshot,
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

async function loadDirectReceivable(client, { installationId, salesOrderId, sourceDocumentType }) {
  const result = await client.query(
    `SELECT id,
            customer_id,
            source_document_date,
            original_amount,
            allocated_amount,
            remaining_amount,
            status,
            revision
       FROM accounting.receivable_documents
      WHERE installation_id = $1
        AND source_document_type = $3
        AND source_document_id = $2::uuid
      FOR UPDATE`,
    [installationId, salesOrderId, sourceDocumentType],
  );
  return result.rows?.[0] ?? null;
}

function validateDirectIssued(source, requestContext, contract) {
  if (!source) return failure('SALES_ORDER_NOT_FOUND', 'Không tìm thấy đơn bán hàng');
  if (source.delivery_mode !== contract.deliveryMode
      || source.delivery_execution_mode !== contract.deliveryExecutionMode) {
    return directFailure(contract, 'ACTION_NOT_AVAILABLE', `Thao tác này chỉ áp dụng cho đơn ${contract.label}`);
  }
  if (!warehouseAllowed(requestContext, source.warehouse_id)) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Đơn nằm ngoài phạm vi kho được cấp quyền');
  }
  if (!['issued', 'fulfilled'].includes(source.fulfillment_status)) {
    return directFailure(contract, 'NOT_ISSUED', 'Hãy Xuất kho trước khi Hoàn thành đơn');
  }
  return Object.freeze({ ok: true });
}

function checkRevision(source, expectedRevision, contract) {
  if (String(source.revision) === String(expectedRevision ?? '')) return null;
  return directFailure(
    contract,
    'CONFLICT',
    'Đơn đã thay đổi. Hãy tải lại trước khi tiếp tục',
    false,
    { currentRevision: String(source.revision) },
  );
}

async function resolveAccountingSource(client, { requestContext, source, contract }) {
  if (source.customer_id) return Object.freeze({ ok: true, source });
  if (String(source.customer_mode_snapshot ?? '').toUpperCase() !== 'WALK_IN') {
    return directFailure(
      contract,
      'CUSTOMER_REQUIRED',
      'Đơn thiếu khách hàng hợp lệ để ghi nhận công nợ',
    );
  }

  const customer = await salesOrderRepository.ensureWalkInCustomer(client, {
    installationId: requestContext.installationId,
    actorId: requestContext.actorId,
  });
  if (!customer?.id) {
    return directFailure(
      contract,
      'WALK_IN_CUSTOMER_UNAVAILABLE',
      'Khách vãng lai của Công Ty chưa được cấu hình hợp lệ',
    );
  }

  return Object.freeze({
    ok: true,
    source: Object.freeze({
      ...source,
      customer_id: customer.id,
      customer_address_id: null,
      customer_code_snapshot: String(source.customer_code_snapshot ?? '').trim() || customer.code,
      customer_name_snapshot: String(source.customer_name_snapshot ?? '').trim() || customer.name,
    }),
  });
}

async function writeReceivableAuditOutbox(client, { requestContext, receivable, contract }) {
  await insertAuditRecord(client, buildAuditRecord({
    requestContext,
    action: contract.receivableAuditAction,
    resourceType: 'accounting.receivable_document',
    resourceId: receivable.id,
    beforeData: null,
    afterData: receivable,
    metadata: {
      sourceDocumentType: contract.sourceDocumentType,
      salesOrderId: receivable.sales_order_id,
      postingOrigin: contract.postingOrigin,
    },
  }));
  await insertOutboxEvent(client, buildOutboxEvent({
    requestContext,
    aggregateType: 'accounting.receivable_document',
    aggregateId: receivable.id,
    eventType: contract.receivableEventType,
    eventVersion: Number(receivable.revision ?? 1),
    payload: receivable,
    metadata: {
      salesOrderId: receivable.sales_order_id,
      postingOrigin: contract.postingOrigin,
    },
  }));
}

async function writePaymentAuditOutbox(client, { requestContext, customerPayment, contract }) {
  await insertAuditRecord(client, buildAuditRecord({
    requestContext,
    action: 'create',
    resourceType: 'accounting.customer_payment',
    resourceId: customerPayment.id,
    beforeData: null,
    afterData: customerPayment,
    metadata: { source: contract.paymentSource },
  }));
  await insertOutboxEvent(client, buildOutboxEvent({
    requestContext,
    aggregateType: 'accounting.customer_payment',
    aggregateId: customerPayment.id,
    eventType: 'accounting.customer_payment.posted',
    eventVersion: 1,
    payload: customerPayment,
    metadata: { source: contract.paymentSource },
  }));
}

async function postReceivable(client, { requestContext, source, contract }) {
  const sourceDocumentType = contract.sourceDocumentType;
  await receivableRepository.lockReceivableSource(client, {
    installationId: requestContext.installationId,
    sourceDocumentType,
    sourceDocumentId: source.id,
  });
  const existing = await loadDirectReceivable(client, {
    installationId: requestContext.installationId,
    salesOrderId: source.id,
    sourceDocumentType,
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
  if (!lines.length) return directFailure(contract, 'NO_LINES', 'Đơn không có dòng hàng để ghi nhận doanh số');

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
    documentType: contract.documentType,
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
      postingOrigin: contract.postingOrigin,
    },
  });
  await writeReceivableAuditOutbox(client, { requestContext, receivable, contract });
  return Object.freeze({ ok: true, receivable, documentDate, replayed: false });
}

export async function completeDirectSalesOrder(client, {
  requestContext,
  id,
  expectedRevision,
  mode,
}) {
  const contract = directCompletionMode(mode);
  if (!contract) return failure('DIRECT_SALES_ORDER_MODE_INVALID', 'Hình thức hoàn thành đơn không hợp lệ');
  const source = await lockSource(client, {
    installationId: requestContext.installationId,
    salesOrderId: id,
  });
  const valid = validateDirectIssued(source, requestContext, contract);
  if (!valid.ok) return valid;
  if (source.status === 'closed') {
    return directFailure(contract, 'ALREADY_COMPLETED', 'Đơn đã hoàn thành, không thể hoàn thành lần hai');
  }
  if (source.status !== 'confirmed') {
    return directFailure(contract, 'COMPLETE_NOT_AVAILABLE', 'Chỉ đơn đã Chốt và Xuất kho mới được Hoàn thành đơn');
  }
  const conflict = checkRevision(source, expectedRevision, contract);
  if (conflict) return conflict;

  const { decimalToScaled } = customerPaymentService.customerPaymentInternals;
  const total = decimalToScaled(source.total, { allowZero: true });
  if (total === null) return directFailure(contract, 'TOTAL_INVALID', 'Tổng tiền đơn không hợp lệ');

  let receivable = null;
  let accountingEffect = auditOutboxEffect();
  if (total > 0n) {
    const accountingSource = await resolveAccountingSource(client, { requestContext, source, contract });
    if (!accountingSource.ok) return accountingSource;
    const posted = await postReceivable(client, {
      requestContext,
      source: accountingSource.source,
      contract,
    });
    if (!posted.ok) return posted;
    receivable = posted.receivable;
    if (!posted.replayed) accountingEffect = auditOutboxEffect(1, 1);
  }

  const deliveryStatus = contract.deliveryMode === 'PICKUP' ? 'not_required' : 'delivered';
  const updated = await client.query(
    `UPDATE sales.sales_orders
        SET status = 'closed',
            delivery_status = $5,
            settlement_status = CASE WHEN $4 THEN 'paid' ELSE settlement_status END,
            revision = revision + 1,
            updated_at = now(),
            updated_by = $3
      WHERE installation_id = $1
        AND id = $2::uuid
        AND status = 'confirmed'
      RETURNING id, revision`,
    [requestContext.installationId, id, requestContext.actorId, total === 0n, deliveryStatus],
  );
  if (!updated.rows?.length) {
    return directFailure(contract, 'CONFLICT', 'Đơn đã thay đổi. Hãy tải lại trước khi tiếp tục');
  }
  return Object.freeze({ ok: true, action: 'complete', receivable, auditOutboxEffect: accountingEffect });
}

export async function completeManualSalesOrder(client, args) {
  return completeDirectSalesOrder(client, { ...args, mode: 'MANUAL' });
}

export async function settleDirectSalesOrder(client, {
  requestContext,
  id,
  expectedRevision,
  payload,
  idempotencyKey,
  mode,
}) {
  const contract = directCompletionMode(mode);
  if (!contract) return failure('DIRECT_SALES_ORDER_MODE_INVALID', 'Hình thức ghi nhận tiền không hợp lệ');
  if (!IDEMPOTENCY_KEY_PATTERN.test(String(idempotencyKey ?? ''))) {
    return failure('INVALID_IDEMPOTENCY_KEY', 'Khóa chống ghi trùng không hợp lệ');
  }

  const source = await lockSource(client, {
    installationId: requestContext.installationId,
    salesOrderId: id,
  });
  const valid = validateDirectIssued(source, requestContext, contract);
  if (!valid.ok) return valid;
  if (source.status !== 'closed') {
    return directFailure(contract, 'SETTLEMENT_NOT_AVAILABLE', 'Hãy Hoàn thành đơn trước khi ghi nhận tiền thu hoặc nợ');
  }
  if (source.settlement_status === 'paid') {
    return directFailure(contract, 'ALREADY_SETTLED', 'Đơn đã thanh toán đủ');
  }
  if (!['pending', 'partially_paid'].includes(source.settlement_status)) {
    return directFailure(contract, 'SETTLEMENT_NOT_AVAILABLE', 'Đơn chưa có khoản phải thu để ghi nhận tiền');
  }
  const conflict = checkRevision(source, expectedRevision, contract);
  if (conflict) return conflict;

  const receivable = await loadDirectReceivable(client, {
    installationId: requestContext.installationId,
    salesOrderId: id,
    sourceDocumentType: contract.sourceDocumentType,
  });
  if (!receivable || !['open', 'partially_allocated'].includes(receivable.status)) {
    return directFailure(contract, 'RECEIVABLE_NOT_FOUND', 'Không tìm thấy khoản phải thu đang mở của đơn');
  }

  const { decimalToScaled, scaledToDecimal } = customerPaymentService.customerPaymentInternals;
  const remaining = decimalToScaled(receivable.remaining_amount, { allowZero: true });
  const paid = decimalToScaled(payload?.paidAmount, { allowZero: true });
  if (remaining === null || remaining <= 0n) {
    return directFailure(contract, 'ALREADY_SETTLED', 'Đơn đã thanh toán đủ');
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
    idempotencyKey: deriveIdempotencyKey(contract.paymentNamespace, idempotencyKey),
    payload: {
      customerId: receivable.customer_id,
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
  await writePaymentAuditOutbox(client, { requestContext, customerPayment, contract });

  return Object.freeze({
    ok: true,
    action: 'settlement',
    receivable,
    customerPayment,
    auditOutboxEffect: auditOutboxEffect(1, 1),
  });
}

export async function settleManualSalesOrder(client, args) {
  return settleDirectSalesOrder(client, { ...args, mode: 'MANUAL' });
}

export const directSalesCompletionInternals = Object.freeze({
  directCompletionMode,
  validateDirectIssued,
  resolveAccountingSource,
});
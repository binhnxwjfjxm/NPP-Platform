import * as repository from '../db/repositories/customer-profile-delivery-returns.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_OFFSET = 1_000_000;

function integerValue(value, fallback) {
  if (value === null || value === undefined || String(value).trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function validWarehouseIds(requestContext) {
  return Array.isArray(requestContext?.scopes?.warehouseIds)
    ? [...new Set(requestContext.scopes.warehouseIds
      .filter((value) => UUID_PATTERN.test(String(value)))
      .map((value) => String(value).trim()))]
    : [];
}

function iso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function normalizeCustomerDeliveryReturnsQuery({
  deliveryLimit,
  deliveryOffset,
  returnLimit,
  returnOffset,
} = {}) {
  const normalizedDeliveryLimit = integerValue(deliveryLimit, DEFAULT_LIMIT);
  const normalizedDeliveryOffset = integerValue(deliveryOffset, 0);
  const normalizedReturnLimit = integerValue(returnLimit, DEFAULT_LIMIT);
  const normalizedReturnOffset = integerValue(returnOffset, 0);
  if (normalizedDeliveryLimit === null || normalizedDeliveryLimit < 1 || normalizedDeliveryLimit > MAX_LIMIT) {
    return { ok: false, code: 'INVALID_CUSTOMER_DELIVERY_LIMIT', message: 'Số dòng giao hàng mỗi trang không hợp lệ.' };
  }
  if (normalizedReturnLimit === null || normalizedReturnLimit < 1 || normalizedReturnLimit > MAX_LIMIT) {
    return { ok: false, code: 'INVALID_CUSTOMER_RETURN_LIMIT', message: 'Số dòng trả hàng mỗi trang không hợp lệ.' };
  }
  if (normalizedDeliveryOffset === null || normalizedDeliveryOffset < 0 || normalizedDeliveryOffset > MAX_OFFSET) {
    return { ok: false, code: 'INVALID_CUSTOMER_DELIVERY_OFFSET', message: 'Vị trí trang giao hàng không hợp lệ.' };
  }
  if (normalizedReturnOffset === null || normalizedReturnOffset < 0 || normalizedReturnOffset > MAX_OFFSET) {
    return { ok: false, code: 'INVALID_CUSTOMER_RETURN_OFFSET', message: 'Vị trí trang trả hàng không hợp lệ.' };
  }
  return {
    ok: true,
    query: Object.freeze({
      deliveryLimit: normalizedDeliveryLimit,
      deliveryOffset: normalizedDeliveryOffset,
      returnLimit: normalizedReturnLimit,
      returnOffset: normalizedReturnOffset,
    }),
  };
}

function deliveryItem(row, attempt) {
  return Object.freeze({
    id: String(row.id),
    number: row.delivery_order_number ?? null,
    salesOrderId: String(row.sales_order_id),
    salesOrderNumber: row.order_number ?? null,
    warehouseId: String(row.warehouse_id),
    warehouseCode: row.warehouse_code_snapshot ?? null,
    warehouseName: row.warehouse_name_snapshot ?? null,
    handoverMode: String(row.handover_mode),
    requestedDeliveryDate: row.requested_delivery_date ? String(row.requested_delivery_date).slice(0, 10) : null,
    status: String(row.status),
    lineCount: Number(row.line_count ?? 0),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    attempts: attempt ? Object.freeze({
      count: String(attempt.attempt_count ?? '0'),
      deliveredFullCount: String(attempt.delivered_full_count ?? '0'),
      deliveredPartialCount: String(attempt.delivered_partial_count ?? '0'),
      failedCount: String(attempt.failed_count ?? '0'),
      rescheduledCount: String(attempt.rescheduled_count ?? '0'),
      latestResult: attempt.latest_result ?? null,
      latestAttemptAt: iso(attempt.latest_attempt_at),
      latestNote: attempt.latest_note ?? null,
      latestRescheduledFor: iso(attempt.latest_rescheduled_for),
    }) : null,
  });
}

function returnItem(row) {
  return Object.freeze({
    id: String(row.id),
    number: row.return_number ?? null,
    warehouseId: String(row.warehouse_id),
    warehouseCode: row.warehouse_code ?? null,
    warehouseName: row.warehouse_name ?? null,
    status: String(row.status),
    note: row.note ?? null,
    lineCount: Number(row.line_count ?? 0),
    acceptedLineCount: Number(row.accepted_line_count ?? 0),
    createdAt: iso(row.created_at),
    receivedAt: iso(row.received_at),
    cancelledAt: iso(row.cancelled_at),
    cancellationReason: row.cancellation_reason ?? null,
  });
}

export async function loadCustomerDeliveryReturns(client, {
  requestContext,
  customerId,
  query,
  permissions,
}) {
  const normalizedCustomerId = String(customerId ?? '').trim();
  if (!UUID_PATTERN.test(normalizedCustomerId)) {
    return { ok: false, code: 'INVALID_CUSTOMER_ID', message: 'Mã khách hàng không hợp lệ.' };
  }
  const normalized = normalizeCustomerDeliveryReturnsQuery(query);
  if (!normalized.ok) return normalized;
  const warehouseIds = validWarehouseIds(requestContext);

  const deliveryPromise = permissions.deliveryOrders
    ? repository.getCustomerDeliveryOrders(client, {
      installationId: requestContext.installationId,
      customerId: normalizedCustomerId,
      warehouseIds,
      limit: normalized.query.deliveryLimit + 1,
      offset: normalized.query.deliveryOffset,
    })
    : Promise.resolve([]);
  const returnPromise = permissions.returns
    ? repository.getCustomerReturns(client, {
      installationId: requestContext.installationId,
      customerId: normalizedCustomerId,
      warehouseIds,
      limit: normalized.query.returnLimit + 1,
      offset: normalized.query.returnOffset,
    })
    : Promise.resolve([]);

  const [deliveryRows, returnRows] = await Promise.all([deliveryPromise, returnPromise]);
  const deliveryPage = deliveryRows.slice(0, normalized.query.deliveryLimit);
  const returnPage = returnRows.slice(0, normalized.query.returnLimit);

  let attemptRows = [];
  if (permissions.deliveryAttempts && deliveryPage.length > 0) {
    attemptRows = await repository.getCustomerDeliveryAttemptFacts(client, {
      installationId: requestContext.installationId,
      deliveryOrderIds: deliveryPage.map((row) => row.id),
    });
  }
  const attemptsByDelivery = new Map(attemptRows.map((row) => [String(row.delivery_order_id), row]));

  return {
    ok: true,
    result: Object.freeze({
      permissions: Object.freeze({
        deliveryOrders: Boolean(permissions.deliveryOrders),
        deliveryAttempts: Boolean(permissions.deliveryAttempts),
        returns: Boolean(permissions.returns),
      }),
      deliveries: Object.freeze({
        offset: normalized.query.deliveryOffset,
        limit: normalized.query.deliveryLimit,
        hasPrevious: normalized.query.deliveryOffset > 0,
        hasNext: deliveryRows.length > normalized.query.deliveryLimit,
        items: Object.freeze(deliveryPage.map((row) => deliveryItem(
          row,
          permissions.deliveryAttempts ? attemptsByDelivery.get(String(row.id)) ?? null : null,
        ))),
      }),
      returns: Object.freeze({
        offset: normalized.query.returnOffset,
        limit: normalized.query.returnLimit,
        hasPrevious: normalized.query.returnOffset > 0,
        hasNext: returnRows.length > normalized.query.returnLimit,
        items: Object.freeze(returnPage.map(returnItem)),
      }),
    }),
  };
}

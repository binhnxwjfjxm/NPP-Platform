import 'server-only';
import { createIdempotencyKey, isValidIdempotencyKey, normalizeIdempotencyKey } from '@npp/contracts';
import { InventoryGatewayError } from './inventory-gateway';
import { requireNppWorkforceSessionToken } from './internal-auth-client';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_TIMEOUT_MS = 30_000;
const ALLOWED_QUERY_KEYS = new Set(['status', 'salesOrderId', 'deliveryOrderId', 'limit', 'offset']);
const ALLOWED_DELIVERY_ACTIONS = new Set([
  'confirm',
  'cancel',
  'pickup-handover',
  'manual-handover',
  'reverse-inventory-issue',
]);

type CoreEnvelope<T> = {
  data?: T;
  error?: { code?: string; message?: string; retryable?: boolean; details?: unknown };
};

function baseUrl(): string {
  const raw = process.env.CORE_API_INTERNAL_URL?.trim();
  if (!raw) {
    throw new InventoryGatewayError('DELIVERY_ORDER_GATEWAY_NOT_CONFIGURED', 'Cổng giao nhận chưa được cấu hình', 503, false);
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new InventoryGatewayError('DELIVERY_ORDER_GATEWAY_NOT_CONFIGURED', 'Cổng giao nhận chưa được cấu hình', 503, false);
  }
  if (!['http:', 'https:'].includes(url.protocol)
    || url.username
    || url.password
    || (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')) {
    throw new InventoryGatewayError('DELIVERY_ORDER_GATEWAY_NOT_CONFIGURED', 'Cổng giao nhận chưa được cấu hình', 503, false);
  }
  url.pathname = url.pathname.replace(/\/$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function safeQuery(params: URLSearchParams): string {
  const next = new URLSearchParams();
  for (const [key, value] of params.entries()) {
    if (ALLOWED_QUERY_KEYS.has(key) && value.length <= 128) next.append(key, value);
  }
  const query = next.toString();
  return query ? `?${query}` : '';
}

function assertUuid(value: string, code: string, message: string): void {
  if (!UUID_PATTERN.test(value)) throw new InventoryGatewayError(code, message, 400, false);
}

function requireKey(value: string | null | undefined): string {
  const normalized = normalizeIdempotencyKey(value);
  if (!normalized || !isValidIdempotencyKey(normalized)) {
    throw new InventoryGatewayError('INVALID_IDEMPOTENCY_KEY', 'Khóa chống xử lý trùng không hợp lệ', 400, false);
  }
  return normalized;
}

async function requestCore<T>({
  path,
  method,
  requestId,
  searchParams,
  body,
  idempotencyKey,
}: {
  path: string;
  method: 'GET' | 'POST';
  requestId: string;
  searchParams?: URLSearchParams;
  body?: unknown;
  idempotencyKey?: string;
}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(
      `${baseUrl()}/api/delivery-orders${path}${searchParams ? safeQuery(searchParams) : ''}`,
      {
        method,
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${requireNppWorkforceSessionToken()}`,
          Accept: 'application/json',
          'x-request-id': requestId,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
    let payload: CoreEnvelope<T>;
    try {
      payload = await response.json() as CoreEnvelope<T>;
    } catch {
      throw new InventoryGatewayError('DELIVERY_ORDER_GATEWAY_RESPONSE_INVALID', 'Phản hồi giao nhận không hợp lệ', 502, false);
    }
    if (!response.ok) {
      throw new InventoryGatewayError(
        payload.error?.code || 'DELIVERY_ORDER_REQUEST_FAILED',
        payload.error?.message || 'Yêu cầu giao nhận không thành công',
        response.status,
        payload.error?.retryable === true,
        payload.error?.details ?? {},
      );
    }
    if (!Object.prototype.hasOwnProperty.call(payload, 'data')) {
      throw new InventoryGatewayError('DELIVERY_ORDER_GATEWAY_RESPONSE_INVALID', 'Phản hồi giao nhận không hợp lệ', 502, false);
    }
    return payload.data as T;
  } catch (error) {
    if (error instanceof InventoryGatewayError) throw error;
    throw new InventoryGatewayError('DELIVERY_ORDER_GATEWAY_UNAVAILABLE', 'Cổng giao nhận tạm thời không khả dụng', 503, true);
  } finally {
    clearTimeout(timeout);
  }
}

export function listDeliveryOrderEligibility<T>(requestId: string, searchParams: URLSearchParams): Promise<T> {
  return requestCore<T>({ path: '/eligibility', method: 'GET', requestId, searchParams });
}

export function listDeliveryOrders<T>(requestId: string, searchParams: URLSearchParams): Promise<T> {
  return requestCore<T>({ path: '', method: 'GET', requestId, searchParams });
}

export function getDeliveryOrder<T>(id: string, requestId: string): Promise<T> {
  assertUuid(id, 'INVALID_DELIVERY_ORDER_ID', 'Mã chứng từ giao nhận không hợp lệ');
  return requestCore<T>({ path: `/${id}`, method: 'GET', requestId });
}

export function createDeliveryOrder<T>(requestId: string, body: unknown, idempotencyKey: string | null): Promise<T> {
  return requestCore<T>({ path: '', method: 'POST', requestId, body, idempotencyKey: requireKey(idempotencyKey) });
}

export function transitionDeliveryOrder<T>(
  id: string,
  action: string,
  requestId: string,
  body: unknown,
  idempotencyKey: string | null,
): Promise<T> {
  assertUuid(id, 'INVALID_DELIVERY_ORDER_ID', 'Mã chứng từ giao nhận không hợp lệ');
  if (!ALLOWED_DELIVERY_ACTIONS.has(action)) {
    throw new InventoryGatewayError('INVALID_DELIVERY_ORDER_ACTION', 'Thao tác giao nhận không hợp lệ', 400, false);
  }
  return requestCore<T>({
    path: `/${id}/${action}`,
    method: 'POST',
    requestId,
    body,
    idempotencyKey: requireKey(idempotencyKey),
  });
}

export function listCustomerReturnEligibility<T>(requestId: string, searchParams: URLSearchParams): Promise<T> {
  return requestCore<T>({ path: '/customer-returns/eligibility', method: 'GET', requestId, searchParams });
}

export function listCustomerReturns<T>(requestId: string, searchParams: URLSearchParams): Promise<T> {
  return requestCore<T>({ path: '/customer-returns', method: 'GET', requestId, searchParams });
}

export function getCustomerReturn<T>(id: string, requestId: string): Promise<T> {
  assertUuid(id, 'INVALID_CUSTOMER_RETURN_ID', 'Mã phiếu hàng khách trả không hợp lệ');
  return requestCore<T>({ path: `/customer-returns/${id}`, method: 'GET', requestId });
}

export function createCustomerReturn<T>(requestId: string, body: unknown, idempotencyKey: string | null): Promise<T> {
  return requestCore<T>({ path: '/customer-returns', method: 'POST', requestId, body, idempotencyKey: requireKey(idempotencyKey) });
}

export function transitionCustomerReturn<T>(
  id: string,
  action: string,
  requestId: string,
  body: unknown,
  idempotencyKey: string | null,
): Promise<T> {
  assertUuid(id, 'INVALID_CUSTOMER_RETURN_ID', 'Mã phiếu hàng khách trả không hợp lệ');
  if (!['receive', 'cancel'].includes(action)) {
    throw new InventoryGatewayError('INVALID_CUSTOMER_RETURN_ACTION', 'Thao tác hàng khách trả không hợp lệ', 400, false);
  }
  return requestCore<T>({
    path: `/customer-returns/${id}/${action}`,
    method: 'POST',
    requestId,
    body,
    idempotencyKey: requireKey(idempotencyKey),
  });
}

export function freshDeliveryOrderKey(prefix: string): string {
  return createIdempotencyKey(`web-${prefix}`);
}

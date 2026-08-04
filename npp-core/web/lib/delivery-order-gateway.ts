import 'server-only';

import { randomUUID } from 'node:crypto';
import { InventoryGatewayError } from './inventory-gateway';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_TIMEOUT_MS = 30_000;
const ALLOWED_QUERY_KEYS = new Set(['status', 'salesOrderId', 'limit', 'offset']);

interface CoreEnvelope<T> {
  data?: T;
  error?: {
    code?: string;
    message?: string;
    retryable?: boolean;
    details?: unknown;
  };
}

function requiredServerValue(name: 'CORE_API_INTERNAL_URL' | 'CORE_API_SERVER_TOKEN'): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new InventoryGatewayError('DELIVERY_ORDER_GATEWAY_NOT_CONFIGURED', 'Cổng giao nhận chưa được cấu hình', 503, false);
  }
  return value;
}

function coreApiBaseUrl(): string {
  const raw = requiredServerValue('CORE_API_INTERNAL_URL');
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new InventoryGatewayError('DELIVERY_ORDER_GATEWAY_NOT_CONFIGURED', 'Cổng giao nhận chưa được cấu hình', 503, false);
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new InventoryGatewayError('DELIVERY_ORDER_GATEWAY_NOT_CONFIGURED', 'Cổng giao nhận chưa được cấu hình', 503, false);
  }
  if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    throw new InventoryGatewayError('DELIVERY_ORDER_GATEWAY_NOT_CONFIGURED', 'Cổng giao nhận chưa được cấu hình', 503, false);
  }
  parsed.pathname = parsed.pathname.replace(/\/$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

function safeQuery(searchParams: URLSearchParams): string {
  const next = new URLSearchParams();
  for (const [key, value] of searchParams.entries()) {
    if (!ALLOWED_QUERY_KEYS.has(key) || value.length > 128) continue;
    next.append(key, value);
  }
  const serialized = next.toString();
  return serialized ? `?${serialized}` : '';
}

function assertUuid(value: string, code: string, message: string): void {
  if (!UUID_PATTERN.test(value)) throw new InventoryGatewayError(code, message, 400, false);
}

function requiredIdempotencyKey(value: string | null | undefined): string {
  const key = String(value ?? '').trim();
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(key)) {
    throw new InventoryGatewayError('INVALID_IDEMPOTENCY_KEY', 'Khóa chống xử lý trùng không hợp lệ', 400, false);
  }
  return key;
}

async function requestDeliveryOrder<T>({
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
    const response = await fetch(`${coreApiBaseUrl()}/api/delivery-orders${path}${searchParams ? safeQuery(searchParams) : ''}`, {
      method,
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${requiredServerValue('CORE_API_SERVER_TOKEN')}`,
        Accept: 'application/json',
        'x-request-id': requestId,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    let payload: CoreEnvelope<T>;
    try {
      payload = (await response.json()) as CoreEnvelope<T>;
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
  return requestDeliveryOrder<T>({ path: '/eligibility', method: 'GET', requestId, searchParams });
}

export function listDeliveryOrders<T>(requestId: string, searchParams: URLSearchParams): Promise<T> {
  return requestDeliveryOrder<T>({ path: '', method: 'GET', requestId, searchParams });
}

export function getDeliveryOrder<T>(deliveryOrderId: string, requestId: string): Promise<T> {
  assertUuid(deliveryOrderId, 'INVALID_DELIVERY_ORDER_ID', 'Mã chứng từ giao nhận không hợp lệ');
  return requestDeliveryOrder<T>({ path: `/${deliveryOrderId}`, method: 'GET', requestId });
}

export function createDeliveryOrder<T>(
  requestId: string,
  body: unknown,
  idempotencyKey: string | null,
): Promise<T> {
  return requestDeliveryOrder<T>({
    path: '',
    method: 'POST',
    requestId,
    body,
    idempotencyKey: requiredIdempotencyKey(idempotencyKey),
  });
}

export function transitionDeliveryOrder<T>(
  deliveryOrderId: string,
  action: string,
  requestId: string,
  body: unknown,
  idempotencyKey: string | null,
): Promise<T> {
  assertUuid(deliveryOrderId, 'INVALID_DELIVERY_ORDER_ID', 'Mã chứng từ giao nhận không hợp lệ');
  if (!['confirm', 'cancel'].includes(action)) {
    throw new InventoryGatewayError('INVALID_DELIVERY_ORDER_ACTION', 'Thao tác giao nhận không hợp lệ', 400, false);
  }
  return requestDeliveryOrder<T>({
    path: `/${deliveryOrderId}/${action}`,
    method: 'POST',
    requestId,
    body,
    idempotencyKey: requiredIdempotencyKey(idempotencyKey),
  });
}

export function freshDeliveryOrderKey(prefix: string): string {
  return `web-${prefix}-${randomUUID()}`;
}

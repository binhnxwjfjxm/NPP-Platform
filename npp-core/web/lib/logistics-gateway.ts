import 'server-only';

import { randomUUID } from 'node:crypto';
import { InventoryGatewayError } from './inventory-gateway';

const REQUEST_TIMEOUT_MS = 30_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_RESOURCE_PATTERN = /^(routes|vehicles|drivers|eligible-delivery-orders|trips)$/;
const ALLOWED_QUERY_KEYS = new Set(['active', 'warehouseId', 'status', 'limit', 'offset']);

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
    throw new InventoryGatewayError('LOGISTICS_GATEWAY_NOT_CONFIGURED', 'Cổng điều phối chưa được cấu hình', 503, false);
  }
  return value;
}

function coreApiBaseUrl(): string {
  let parsed: URL;
  try {
    parsed = new URL(requiredServerValue('CORE_API_INTERNAL_URL'));
  } catch {
    throw new InventoryGatewayError('LOGISTICS_GATEWAY_NOT_CONFIGURED', 'Cổng điều phối chưa được cấu hình', 503, false);
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new InventoryGatewayError('LOGISTICS_GATEWAY_NOT_CONFIGURED', 'Cổng điều phối chưa được cấu hình', 503, false);
  }
  if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    throw new InventoryGatewayError('LOGISTICS_GATEWAY_NOT_CONFIGURED', 'Cổng điều phối chưa được cấu hình', 503, false);
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

function assertResource(resource: string): void {
  if (!SAFE_RESOURCE_PATTERN.test(resource)) {
    throw new InventoryGatewayError('INVALID_LOGISTICS_RESOURCE', 'Tài nguyên điều phối không hợp lệ', 400, false);
  }
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

async function requestLogistics<T>({
  path,
  method,
  requestId,
  searchParams,
  body,
  idempotencyKey,
}: {
  path: string;
  method: 'GET' | 'POST' | 'PUT';
  requestId: string;
  searchParams?: URLSearchParams;
  body?: unknown;
  idempotencyKey?: string;
}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(
      `${coreApiBaseUrl()}/api/logistics${path}${searchParams ? safeQuery(searchParams) : ''}`,
      {
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
      },
    );
    let payload: CoreEnvelope<T>;
    try {
      payload = (await response.json()) as CoreEnvelope<T>;
    } catch {
      throw new InventoryGatewayError('LOGISTICS_GATEWAY_RESPONSE_INVALID', 'Phản hồi điều phối không hợp lệ', 502, false);
    }
    if (!response.ok) {
      throw new InventoryGatewayError(
        payload.error?.code || 'LOGISTICS_REQUEST_FAILED',
        payload.error?.message || 'Yêu cầu điều phối không thành công',
        response.status,
        payload.error?.retryable === true,
        payload.error?.details ?? {},
      );
    }
    if (!Object.prototype.hasOwnProperty.call(payload, 'data')) {
      throw new InventoryGatewayError('LOGISTICS_GATEWAY_RESPONSE_INVALID', 'Phản hồi điều phối không hợp lệ', 502, false);
    }
    return payload.data as T;
  } catch (error) {
    if (error instanceof InventoryGatewayError) throw error;
    throw new InventoryGatewayError('LOGISTICS_GATEWAY_UNAVAILABLE', 'Cổng điều phối tạm thời không khả dụng', 503, true);
  } finally {
    clearTimeout(timeout);
  }
}

export function listLogisticsResource<T>(resource: string, requestId: string, searchParams: URLSearchParams): Promise<T> {
  assertResource(resource);
  return requestLogistics<T>({ path: `/${resource}`, method: 'GET', requestId, searchParams });
}

export function createLogisticsResource<T>(
  resource: string,
  requestId: string,
  body: unknown,
  idempotencyKey: string | null,
): Promise<T> {
  assertResource(resource);
  if (resource === 'eligible-delivery-orders') {
    throw new InventoryGatewayError('INVALID_LOGISTICS_RESOURCE', 'Tài nguyên điều phối chỉ cho phép đọc', 400, false);
  }
  return requestLogistics<T>({
    path: `/${resource}`,
    method: 'POST',
    requestId,
    body,
    idempotencyKey: requiredIdempotencyKey(idempotencyKey),
  });
}

export function getDeliveryTrip<T>(tripId: string, requestId: string): Promise<T> {
  assertUuid(tripId, 'INVALID_TRIP_ID', 'Mã chuyến giao không hợp lệ');
  return requestLogistics<T>({ path: `/trips/${tripId}`, method: 'GET', requestId });
}

export function getDeliveryTripAction<T>(tripId: string, action: string, requestId: string): Promise<T> {
  assertUuid(tripId, 'INVALID_TRIP_ID', 'Mã chuyến giao không hợp lệ');
  if (action !== 'dispatch') {
    throw new InventoryGatewayError('INVALID_TRIP_ACTION', 'Thao tác chuyến giao không hợp lệ', 400, false);
  }
  return requestLogistics<T>({ path: `/trips/${tripId}/${action}`, method: 'GET', requestId });
}

export function updateDeliveryTrip<T>(
  tripId: string,
  requestId: string,
  body: unknown,
  idempotencyKey: string | null,
): Promise<T> {
  assertUuid(tripId, 'INVALID_TRIP_ID', 'Mã chuyến giao không hợp lệ');
  return requestLogistics<T>({
    path: `/trips/${tripId}`,
    method: 'PUT',
    requestId,
    body,
    idempotencyKey: requiredIdempotencyKey(idempotencyKey),
  });
}

export function transitionDeliveryTrip<T>(
  tripId: string,
  action: string,
  requestId: string,
  body: unknown,
  idempotencyKey: string | null,
): Promise<T> {
  assertUuid(tripId, 'INVALID_TRIP_ID', 'Mã chuyến giao không hợp lệ');
  if (!['assign', 'unassign', 'reorder', 'plan', 'reopen', 'lock', 'dispatch'].includes(action)) {
    throw new InventoryGatewayError('INVALID_TRIP_ACTION', 'Thao tác chuyến giao không hợp lệ', 400, false);
  }
  return requestLogistics<T>({
    path: `/trips/${tripId}/${action}`,
    method: 'POST',
    requestId,
    body,
    idempotencyKey: requiredIdempotencyKey(idempotencyKey),
  });
}

export function freshLogisticsKey(prefix: string): string {
  return `web-logistics-${prefix}-${randomUUID()}`;
}
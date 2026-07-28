import 'server-only';

import { randomUUID } from 'node:crypto';
import { logGatewayFailure } from './gateway-diagnostics';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_TIMEOUT_MS = 8_000;
const ALLOWED_QUERY_KEYS = new Set(['active', 'limit', 'offset', 'search', 'groupId']);

interface CoreEnvelope<T> {
  data?: T;
  error?: {
    code?: string;
    message?: string;
    retryable?: boolean;
    details?: unknown;
  };
  requestId?: string;
}

export class CustomerGatewayError extends Error {
  constructor(
    public readonly code: string,
    public readonly publicMessage: string,
    public readonly statusCode: number,
    public readonly retryable: boolean,
    public readonly details: unknown = {},
  ) {
    super(publicMessage);
    this.name = 'CustomerGatewayError';
  }
}

export function resolveCustomerRequestId(value: string | null | undefined): string {
  const candidate = String(value ?? '').trim();
  return REQUEST_ID_PATTERN.test(candidate) ? candidate : `web_${randomUUID()}`;
}

export function normalizeCustomerGatewayError(error: unknown): CustomerGatewayError {
  if (error instanceof CustomerGatewayError) return error;
  return new CustomerGatewayError('CUSTOMER_GATEWAY_UNAVAILABLE', 'Dữ liệu khách hàng tạm thời chưa sẵn sàng', 503, true);
}

function requiredServerValue(name: 'CORE_API_INTERNAL_URL' | 'CORE_API_SERVER_TOKEN'): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new CustomerGatewayError('CUSTOMER_GATEWAY_NOT_CONFIGURED', 'Cổng khách hàng chưa được cấu hình', 503, false);
  }
  return value;
}

function coreApiBaseUrl(): string {
  const raw = requiredServerValue('CORE_API_INTERNAL_URL');
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new CustomerGatewayError('CUSTOMER_GATEWAY_NOT_CONFIGURED', 'Cổng khách hàng chưa được cấu hình', 503, false);
  }

  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new CustomerGatewayError('CUSTOMER_GATEWAY_NOT_CONFIGURED', 'Cổng khách hàng chưa được cấu hình', 503, false);
  }
  if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    throw new CustomerGatewayError('CUSTOMER_GATEWAY_NOT_CONFIGURED', 'Cổng khách hàng chưa được cấu hình', 503, false);
  }

  parsed.pathname = parsed.pathname.replace(/\/$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

function safeQuery(searchParams: URLSearchParams): string {
  const next = new URLSearchParams();
  for (const [key, value] of searchParams.entries()) {
    if (!ALLOWED_QUERY_KEYS.has(key) || value.length > 256) continue;
    next.append(key, value);
  }
  const serialized = next.toString();
  return serialized ? `?${serialized}` : '';
}

function assertUuid(value: string, code: string, message: string): string {
  const normalized = value.trim();
  if (!UUID_PATTERN.test(normalized)) {
    throw new CustomerGatewayError(code, message, 400, false);
  }
  return normalized;
}

function customerPath(id?: string): string {
  return `/api/customers${id ? `/${assertUuid(id, 'INVALID_CUSTOMER_ID', 'Mã khách hàng không hợp lệ')}` : ''}`;
}

function groupPath(id?: string): string {
  return `/api/customer-groups${id ? `/${assertUuid(id, 'INVALID_CUSTOMER_GROUP_ID', 'Mã nhóm khách hàng không hợp lệ')}` : ''}`;
}

function addressPath(customerId: string, addressId?: string): string {
  const customer = assertUuid(customerId, 'INVALID_CUSTOMER_ID', 'Mã khách hàng không hợp lệ');
  const address = addressId
    ? `/${assertUuid(addressId, 'INVALID_CUSTOMER_ADDRESS_ID', 'Mã địa chỉ không hợp lệ')}`
    : '';
  return `/api/customers/${customer}/addresses${address}`;
}

async function requestCore<T>({
  method,
  path,
  requestId,
  searchParams,
  body,
  idempotencyKey,
}: {
  method: 'GET' | 'POST' | 'PATCH';
  path: string;
  requestId: string;
  searchParams?: URLSearchParams;
  body?: unknown;
  idempotencyKey?: string;
}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const query = searchParams ? safeQuery(searchParams) : '';
    const response = await fetch(`${coreApiBaseUrl()}${path}${query}`, {
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
      throw new CustomerGatewayError('CUSTOMER_GATEWAY_RESPONSE_INVALID', 'Phản hồi khách hàng không hợp lệ', 502, false);
    }

    if (!response.ok) {
      throw new CustomerGatewayError(
        payload.error?.code || 'CUSTOMER_REQUEST_FAILED',
        payload.error?.message || 'Yêu cầu khách hàng không thành công',
        response.status,
        payload.error?.retryable === true,
        payload.error?.details ?? {},
      );
    }

    if (!Object.prototype.hasOwnProperty.call(payload, 'data')) {
      throw new CustomerGatewayError('CUSTOMER_GATEWAY_RESPONSE_INVALID', 'Phản hồi khách hàng không hợp lệ', 502, false);
    }

    return payload.data as T;
  } catch (error) {
    const normalized = error instanceof CustomerGatewayError
      ? error
      : new CustomerGatewayError('CUSTOMER_GATEWAY_UNAVAILABLE', 'Cổng khách hàng tạm thời không khả dụng', 503, true);
    logGatewayFailure({
      gateway: 'customer',
      method,
      upstreamPath: path,
      status: normalized.statusCode,
      requestId,
      code: normalized.code,
    });
    throw normalized;
  } finally {
    clearTimeout(timeout);
  }
}

export function listAllCustomers<T>(requestId: string, searchParams = new URLSearchParams()): Promise<T[]> {
  return requestCore<T[]>({ method: 'GET', path: customerPath(), requestId, searchParams });
}

export function getCustomer<T>(id: string, requestId: string): Promise<T> {
  return requestCore<T>({ method: 'GET', path: customerPath(id), requestId });
}

export function createCustomer<T>(requestId: string, body: unknown, idempotencyKey?: string): Promise<T> {
  return requestCore<T>({
    method: 'POST',
    path: customerPath(),
    requestId,
    body,
    idempotencyKey: idempotencyKey?.trim() || `web-${randomUUID()}`,
  });
}

export function patchCustomer<T>(id: string, requestId: string, body: unknown): Promise<T> {
  return requestCore<T>({ method: 'PATCH', path: customerPath(id), requestId, body });
}

export function listCustomerGroups<T>(requestId: string, searchParams = new URLSearchParams()): Promise<T[]> {
  return requestCore<T[]>({ method: 'GET', path: groupPath(), requestId, searchParams });
}

export function getCustomerGroup<T>(id: string, requestId: string): Promise<T> {
  return requestCore<T>({ method: 'GET', path: groupPath(id), requestId });
}

export function createCustomerGroup<T>(requestId: string, body: unknown, idempotencyKey?: string): Promise<T> {
  return requestCore<T>({
    method: 'POST',
    path: groupPath(),
    requestId,
    body,
    idempotencyKey: idempotencyKey?.trim() || `web-${randomUUID()}`,
  });
}

export function patchCustomerGroup<T>(id: string, requestId: string, body: unknown): Promise<T> {
  return requestCore<T>({ method: 'PATCH', path: groupPath(id), requestId, body });
}

export function listCustomerAddresses<T>(customerId: string, requestId: string): Promise<T[]> {
  return requestCore<T[]>({ method: 'GET', path: addressPath(customerId), requestId });
}

export function createCustomerAddress<T>(customerId: string, requestId: string, body: unknown, idempotencyKey?: string): Promise<T> {
  return requestCore<T>({
    method: 'POST',
    path: addressPath(customerId),
    requestId,
    body,
    idempotencyKey: idempotencyKey?.trim() || `web-${randomUUID()}`,
  });
}

export function patchCustomerAddress<T>(customerId: string, addressId: string, requestId: string, body: unknown): Promise<T> {
  return requestCore<T>({ method: 'PATCH', path: addressPath(customerId, addressId), requestId, body });
}

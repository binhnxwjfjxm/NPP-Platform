import 'server-only';

import { randomUUID } from 'node:crypto';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_TIMEOUT_MS = 8_000;
const ALLOWED_QUERY_KEYS = new Set(['active', 'limit', 'offset']);

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
    if (!ALLOWED_QUERY_KEYS.has(key) || value.length > 128) continue;
    next.append(key, value);
  }
  const serialized = next.toString();
  return serialized ? `?${serialized}` : '';
}

function customerPath(id?: string): string {
  if (id !== undefined && !UUID_PATTERN.test(id)) {
    throw new CustomerGatewayError('INVALID_CUSTOMER_ID', 'Mã khách hàng không hợp lệ', 400, false);
  }
  return `/api/customers${id ? `/${id}` : ''}`;
}

async function requestCore<T>({
  method,
  id,
  requestId,
  searchParams,
  body,
  idempotencyKey,
}: {
  method: 'GET' | 'POST' | 'PATCH';
  id?: string;
  requestId: string;
  searchParams?: URLSearchParams;
  body?: unknown;
  idempotencyKey?: string;
}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const path = `${customerPath(id)}${searchParams ? safeQuery(searchParams) : ''}`;
    const response = await fetch(`${coreApiBaseUrl()}${path}`, {
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
    if (error instanceof CustomerGatewayError) throw error;
    throw new CustomerGatewayError('CUSTOMER_GATEWAY_UNAVAILABLE', 'Cổng khách hàng tạm thời không khả dụng', 503, true);
  } finally {
    clearTimeout(timeout);
  }
}

export function listAllCustomers<T>(requestId: string, searchParams = new URLSearchParams()): Promise<T[]> {
  return requestCore<T[]>({ method: 'GET', requestId, searchParams });
}

export function getCustomer<T>(id: string, requestId: string): Promise<T> {
  return requestCore<T>({ method: 'GET', id, requestId });
}

export function createCustomer<T>(requestId: string, body: unknown, idempotencyKey?: string): Promise<T> {
  return requestCore<T>({ method: 'POST', requestId, body, idempotencyKey: idempotencyKey?.trim() || `web-${randomUUID()}` });
}

export function patchCustomer<T>(id: string, requestId: string, body: unknown): Promise<T> {
  return requestCore<T>({ method: 'PATCH', id, requestId, body });
}

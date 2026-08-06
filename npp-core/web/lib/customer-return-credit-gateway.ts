import 'server-only';

import { randomUUID } from 'node:crypto';
import type { CustomerRefundDraft } from './customer-return-credit-types';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,200}$/;
const REQUEST_TIMEOUT_MS = 8_000;
const ALLOWED_QUERY_KEYS = new Set([
  'limit', 'offset', 'status', 'customerId', 'warehouseId', 'currencyCode', 'search',
]);

type CoreEnvelope<T> = {
  data?: T;
  error?: { code?: string; message?: string; retryable?: boolean; details?: unknown };
  requestId?: string;
};

export class CustomerReturnCreditGatewayError extends Error {
  constructor(
    public readonly code: string,
    public readonly publicMessage: string,
    public readonly statusCode: number,
    public readonly retryable: boolean,
    public readonly details: unknown = {},
  ) {
    super(publicMessage);
    this.name = 'CustomerReturnCreditGatewayError';
  }
}

export function resolveCustomerReturnCreditRequestId(value: string | null | undefined): string {
  const candidate = String(value ?? '').trim();
  return REQUEST_ID_PATTERN.test(candidate) ? candidate : `web_${randomUUID()}`;
}

export function normalizeCustomerReturnCreditGatewayError(error: unknown): CustomerReturnCreditGatewayError {
  if (error instanceof CustomerReturnCreditGatewayError) return error;
  return new CustomerReturnCreditGatewayError(
    'CUSTOMER_RETURN_CREDIT_GATEWAY_UNAVAILABLE',
    'Điều chỉnh công nợ hàng trả tạm thời chưa khả dụng',
    503,
    true,
  );
}

function requiredServerValue(name: 'CORE_API_INTERNAL_URL' | 'CORE_API_SERVER_TOKEN'): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new CustomerReturnCreditGatewayError(
      'CUSTOMER_RETURN_CREDIT_GATEWAY_NOT_CONFIGURED',
      'Điều chỉnh công nợ hàng trả chưa được cấu hình',
      503,
      false,
    );
  }
  return value;
}

function coreApiBaseUrl(): string {
  let parsed: URL;
  try {
    parsed = new URL(requiredServerValue('CORE_API_INTERNAL_URL'));
  } catch {
    throw new CustomerReturnCreditGatewayError(
      'CUSTOMER_RETURN_CREDIT_GATEWAY_NOT_CONFIGURED',
      'Điều chỉnh công nợ hàng trả chưa được cấu hình',
      503,
      false,
    );
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new CustomerReturnCreditGatewayError(
      'CUSTOMER_RETURN_CREDIT_GATEWAY_NOT_CONFIGURED',
      'Điều chỉnh công nợ hàng trả chưa được cấu hình',
      503,
      false,
    );
  }
  if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    throw new CustomerReturnCreditGatewayError(
      'CUSTOMER_RETURN_CREDIT_GATEWAY_NOT_CONFIGURED',
      'Điều chỉnh công nợ hàng trả chưa được cấu hình',
      503,
      false,
    );
  }
  parsed.pathname = parsed.pathname.replace(/\/$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

function assertUuid(value: string, code: string, message: string): string {
  const normalized = value.trim();
  if (!UUID_PATTERN.test(normalized)) {
    throw new CustomerReturnCreditGatewayError(code, message, 400, false);
  }
  return normalized;
}

function assertIdempotencyKey(value: string | null | undefined): string {
  const normalized = String(value ?? '').trim();
  if (!IDEMPOTENCY_KEY_PATTERN.test(normalized)) {
    throw new CustomerReturnCreditGatewayError(
      'INVALID_IDEMPOTENCY_KEY',
      'Khóa chống trùng yêu cầu không hợp lệ',
      400,
      false,
    );
  }
  return normalized;
}

function safeQuery(params: URLSearchParams): string {
  const next = new URLSearchParams();
  for (const [key, value] of params.entries()) {
    if (ALLOWED_QUERY_KEYS.has(key) && value.length <= 256) next.append(key, value);
  }
  const serialized = next.toString();
  return serialized ? `?${serialized}` : '';
}

async function requestCore<T>({
  method,
  path,
  requestId,
  searchParams,
  body,
  idempotencyKey,
}: {
  method: 'GET' | 'POST';
  path: string;
  requestId: string;
  searchParams?: URLSearchParams;
  body?: unknown;
  idempotencyKey?: string;
}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(
      `${coreApiBaseUrl()}${path}${searchParams ? safeQuery(searchParams) : ''}`,
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
      payload = await response.json() as CoreEnvelope<T>;
    } catch {
      throw new CustomerReturnCreditGatewayError(
        'CUSTOMER_RETURN_CREDIT_GATEWAY_RESPONSE_INVALID',
        'Phản hồi điều chỉnh công nợ hàng trả không hợp lệ',
        502,
        false,
      );
    }
    if (!response.ok) {
      throw new CustomerReturnCreditGatewayError(
        payload.error?.code || 'CUSTOMER_RETURN_CREDIT_REQUEST_FAILED',
        payload.error?.message || 'Yêu cầu điều chỉnh công nợ hàng trả không thành công',
        response.status,
        payload.error?.retryable === true,
        payload.error?.details ?? {},
      );
    }
    if (!Object.prototype.hasOwnProperty.call(payload, 'data')) {
      throw new CustomerReturnCreditGatewayError(
        'CUSTOMER_RETURN_CREDIT_GATEWAY_RESPONSE_INVALID',
        'Phản hồi điều chỉnh công nợ hàng trả không hợp lệ',
        502,
        false,
      );
    }
    return payload.data as T;
  } catch (error) {
    if (error instanceof CustomerReturnCreditGatewayError) throw error;
    throw new CustomerReturnCreditGatewayError(
      'CUSTOMER_RETURN_CREDIT_GATEWAY_UNAVAILABLE',
      'Điều chỉnh công nợ hàng trả tạm thời chưa khả dụng',
      503,
      true,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function queryFrom(params?: Record<string, string | number | undefined>): URLSearchParams {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  return query;
}

export function listCustomerReturnCredits<T>(
  requestId: string,
  params?: Record<string, string | number | undefined>,
): Promise<T[]> {
  return requestCore<T[]>({
    method: 'GET',
    path: '/api/customer-return-credits',
    requestId,
    searchParams: queryFrom(params),
  });
}

export function getCustomerReturnCredit<T>(id: string, requestId: string): Promise<T> {
  return requestCore<T>({
    method: 'GET',
    path: `/api/customer-return-credits/${assertUuid(id, 'INVALID_CUSTOMER_RETURN_CREDIT_ID', 'Mã credit hàng trả không hợp lệ')}`,
    requestId,
  });
}

export function allocateCustomerReturnCredit<T>(
  id: string,
  requestId: string,
  body: unknown,
  idempotencyKey: string,
): Promise<T> {
  return requestCore<T>({
    method: 'POST',
    path: `/api/customer-return-credits/${assertUuid(id, 'INVALID_CUSTOMER_RETURN_CREDIT_ID', 'Mã credit hàng trả không hợp lệ')}/allocations`,
    requestId,
    body,
    idempotencyKey: assertIdempotencyKey(idempotencyKey),
  });
}

export function reverseCustomerReturnCredit<T>(
  id: string,
  requestId: string,
  body: unknown,
  idempotencyKey: string,
): Promise<T> {
  return requestCore<T>({
    method: 'POST',
    path: `/api/customer-return-credits/${assertUuid(id, 'INVALID_CUSTOMER_RETURN_CREDIT_ID', 'Mã credit hàng trả không hợp lệ')}/reverse`,
    requestId,
    body,
    idempotencyKey: assertIdempotencyKey(idempotencyKey),
  });
}

export function createCustomerRefund<T>(
  requestId: string,
  body: CustomerRefundDraft,
  idempotencyKey: string,
): Promise<T> {
  return requestCore<T>({
    method: 'POST',
    path: '/api/customer-refunds',
    requestId,
    body,
    idempotencyKey: assertIdempotencyKey(idempotencyKey),
  });
}

export function reverseCustomerRefund<T>(
  id: string,
  requestId: string,
  body: unknown,
  idempotencyKey: string,
): Promise<T> {
  return requestCore<T>({
    method: 'POST',
    path: `/api/customer-refunds/${assertUuid(id, 'INVALID_CUSTOMER_REFUND_ID', 'Mã hoàn tiền không hợp lệ')}/reverse`,
    requestId,
    body,
    idempotencyKey: assertIdempotencyKey(idempotencyKey),
  });
}

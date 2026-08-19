import 'server-only';

import { isValidIdempotencyKey, normalizeIdempotencyKey } from '@npp/contracts';
import { randomUUID } from 'node:crypto';
import type { CustomerPaymentDraft } from './customer-payment-types';
import { requireNppWorkforceSessionToken } from './internal-auth-client';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_TIMEOUT_MS = 8_000;
const ALLOWED_QUERY_KEYS = new Set([
  'limit', 'offset', 'status', 'customerId', 'warehouseId', 'currencyCode', 'search',
]);

type CoreEnvelope<T> = {
  data?: T;
  error?: { code?: string; message?: string; retryable?: boolean; details?: unknown };
  requestId?: string;
};

export class CustomerPaymentGatewayError extends Error {
  constructor(
    public readonly code: string,
    public readonly publicMessage: string,
    public readonly statusCode: number,
    public readonly retryable: boolean,
    public readonly details: unknown = {},
  ) {
    super(publicMessage);
    this.name = 'CustomerPaymentGatewayError';
  }
}

export function resolveCustomerPaymentRequestId(value: string | null | undefined) {
  const candidate = String(value ?? '').trim();
  return REQUEST_ID_PATTERN.test(candidate) ? candidate : `web_${randomUUID()}`;
}

export function normalizeCustomerPaymentGatewayError(error: unknown) {
  return error instanceof CustomerPaymentGatewayError
    ? error
    : new CustomerPaymentGatewayError(
        'CUSTOMER_PAYMENT_GATEWAY_UNAVAILABLE',
        'Thu tiền khách hàng tạm thời chưa khả dụng',
        503,
        true,
      );
}

function baseUrl() {
  const raw = process.env.CORE_API_INTERNAL_URL?.trim();
  if (!raw) {
    throw new CustomerPaymentGatewayError(
      'CUSTOMER_PAYMENT_GATEWAY_NOT_CONFIGURED',
      'Thu tiền khách hàng chưa được cấu hình',
      503,
      false,
    );
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new CustomerPaymentGatewayError(
      'CUSTOMER_PAYMENT_GATEWAY_NOT_CONFIGURED',
      'Thu tiền khách hàng chưa được cấu hình',
      503,
      false,
    );
  }
  if (
    !['http:', 'https:'].includes(url.protocol)
    || url.username
    || url.password
    || (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')
  ) {
    throw new CustomerPaymentGatewayError(
      'CUSTOMER_PAYMENT_GATEWAY_NOT_CONFIGURED',
      'Thu tiền khách hàng chưa được cấu hình',
      503,
      false,
    );
  }
  url.pathname = url.pathname.replace(/\/$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function uuid(value: string, code: string, message: string) {
  const normalized = value.trim();
  if (!UUID_PATTERN.test(normalized)) {
    throw new CustomerPaymentGatewayError(code, message, 400, false);
  }
  return normalized;
}

function key(value: string | null | undefined) {
  const normalized = normalizeIdempotencyKey(value);
  if (!normalized || !isValidIdempotencyKey(normalized)) {
    throw new CustomerPaymentGatewayError(
      'INVALID_IDEMPOTENCY_KEY',
      'Khóa chống trùng yêu cầu không hợp lệ',
      400,
      false,
    );
  }
  return normalized;
}

function safeQuery(params: URLSearchParams) {
  const safe = new URLSearchParams();
  for (const [name, value] of params.entries()) {
    if (ALLOWED_QUERY_KEYS.has(name) && value.length <= 256) safe.append(name, value);
  }
  const query = safe.toString();
  return query ? `?${query}` : '';
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
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(
      `${baseUrl()}${path}${searchParams ? safeQuery(searchParams) : ''}`,
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
      throw new CustomerPaymentGatewayError(
        'CUSTOMER_PAYMENT_GATEWAY_RESPONSE_INVALID',
        'Phản hồi thu tiền khách hàng không hợp lệ',
        502,
        false,
      );
    }
    if (!response.ok) {
      throw new CustomerPaymentGatewayError(
        payload.error?.code || 'CUSTOMER_PAYMENT_REQUEST_FAILED',
        payload.error?.message || 'Yêu cầu thu tiền khách hàng không thành công',
        response.status,
        payload.error?.retryable === true,
        payload.error?.details ?? {},
      );
    }
    if (!Object.prototype.hasOwnProperty.call(payload, 'data')) {
      throw new CustomerPaymentGatewayError(
        'CUSTOMER_PAYMENT_GATEWAY_RESPONSE_INVALID',
        'Phản hồi thu tiền khách hàng không hợp lệ',
        502,
        false,
      );
    }
    return payload.data as T;
  } catch (error) {
    if (error instanceof CustomerPaymentGatewayError) throw error;
    throw new CustomerPaymentGatewayError(
      'CUSTOMER_PAYMENT_GATEWAY_UNAVAILABLE',
      'Thu tiền khách hàng tạm thời chưa khả dụng',
      503,
      true,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function queryFrom(params?: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== '') query.set(name, String(value));
  }
  return query;
}

export function listCustomerPayments<T>(
  requestId: string,
  params?: Record<string, string | number | undefined>,
): Promise<T[]> {
  return requestCore<T[]>({
    method: 'GET', path: '/api/customer-payments', requestId, searchParams: queryFrom(params),
  });
}

export function getCustomerPayment<T>(id: string, requestId: string): Promise<T> {
  return requestCore<T>({
    method: 'GET',
    path: `/api/customer-payments/${uuid(id, 'INVALID_CUSTOMER_PAYMENT_ID', 'Mã phiếu thu không hợp lệ')}`,
    requestId,
  });
}

export function listCustomerPaymentTargets<T>(
  requestId: string,
  params?: Record<string, string | number | undefined>,
): Promise<T[]> {
  return requestCore<T[]>({
    method: 'GET',
    path: '/api/customer-payments/allocation-targets',
    requestId,
    searchParams: queryFrom(params),
  });
}

export function listCustomerPaymentRemittingEmployees<T>(requestId: string): Promise<T[]> {
  return requestCore<T[]>({
    method: 'GET', path: '/api/customer-payments/remitting-employees', requestId,
  });
}

export function createCustomerPayment<T>(
  requestId: string,
  body: CustomerPaymentDraft,
  idempotencyKey: string,
): Promise<T> {
  return requestCore<T>({
    method: 'POST', path: '/api/customer-payments', requestId, body, idempotencyKey: key(idempotencyKey),
  });
}

export function allocateCustomerPayment<T>(
  id: string,
  requestId: string,
  body: unknown,
  idempotencyKey: string,
): Promise<T> {
  return requestCore<T>({
    method: 'POST',
    path: `/api/customer-payments/${uuid(id, 'INVALID_CUSTOMER_PAYMENT_ID', 'Mã phiếu thu không hợp lệ')}/allocations`,
    requestId,
    body,
    idempotencyKey: key(idempotencyKey),
  });
}

export function reverseCustomerPayment<T>(
  id: string,
  requestId: string,
  body: unknown,
  idempotencyKey: string,
): Promise<T> {
  return requestCore<T>({
    method: 'POST',
    path: `/api/customer-payments/${uuid(id, 'INVALID_CUSTOMER_PAYMENT_ID', 'Mã phiếu thu không hợp lệ')}/reverse`,
    requestId,
    body,
    idempotencyKey: key(idempotencyKey),
  });
}

export function reverseReceivableAllocation<T>(
  id: string,
  requestId: string,
  body: unknown,
  idempotencyKey: string,
): Promise<T> {
  return requestCore<T>({
    method: 'POST',
    path: `/api/receivable-allocations/${uuid(id, 'INVALID_RECEIVABLE_ALLOCATION_ID', 'Mã ghi nhận công nợ không hợp lệ')}/reverse`,
    requestId,
    body,
    idempotencyKey: key(idempotencyKey),
  });
}

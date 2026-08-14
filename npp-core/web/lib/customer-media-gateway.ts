import 'server-only';
import { isValidIdempotencyKey, normalizeIdempotencyKey } from '@npp/contracts';
import { randomUUID } from 'node:crypto';
import { logGatewayFailure } from './gateway-diagnostics';
import { requireNppWorkforceSessionToken } from './internal-auth-client';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const REQUEST_TIMEOUT_MS = 8_000;

type CoreEnvelope<T> = {
  data?: T;
  error?: { code?: string; message?: string; retryable?: boolean; details?: unknown };
  requestId?: string;
};

export class CustomerMediaGatewayError extends Error {
  constructor(
    public readonly code: string,
    public readonly publicMessage: string,
    public readonly statusCode: number,
    public readonly retryable: boolean,
    public readonly details: unknown = {},
  ) {
    super(publicMessage);
    this.name = 'CustomerMediaGatewayError';
  }
}

export function resolveCustomerMediaRequestId(value: string | null | undefined) {
  const candidate = String(value ?? '').trim();
  return REQUEST_ID_PATTERN.test(candidate) ? candidate : `web_${randomUUID()}`;
}

export function normalizeCustomerMediaGatewayError(error: unknown) {
  return error instanceof CustomerMediaGatewayError
    ? error
    : new CustomerMediaGatewayError('CUSTOMER_MEDIA_GATEWAY_UNAVAILABLE', 'Ảnh khách hàng tạm thời chưa sẵn sàng', 503, true);
}

function coreApiBaseUrl() {
  const raw = process.env.CORE_API_INTERNAL_URL?.trim();
  if (!raw) throw new CustomerMediaGatewayError('CUSTOMER_MEDIA_GATEWAY_NOT_CONFIGURED', 'Cổng ảnh khách hàng chưa được cấu hình', 503, false);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new CustomerMediaGatewayError('CUSTOMER_MEDIA_GATEWAY_NOT_CONFIGURED', 'Cổng ảnh khách hàng chưa được cấu hình', 503, false);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')) {
    throw new CustomerMediaGatewayError('CUSTOMER_MEDIA_GATEWAY_NOT_CONFIGURED', 'Cổng ảnh khách hàng chưa được cấu hình', 503, false);
  }
  url.pathname = url.pathname.replace(/\/$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function customerMediaPath(customerId: string) {
  const id = customerId.trim();
  if (!UUID_PATTERN.test(id)) throw new CustomerMediaGatewayError('INVALID_CUSTOMER_ID', 'Mã khách hàng không hợp lệ', 400, false);
  return `/api/customers/${id}/media`;
}

function mutationKey(value: string | null | undefined) {
  const normalized = normalizeIdempotencyKey(value);
  if (!normalized || !isValidIdempotencyKey(normalized)) {
    throw new CustomerMediaGatewayError('INVALID_IDEMPOTENCY_KEY', 'Khóa chống trùng yêu cầu không hợp lệ', 400, false);
  }
  return normalized;
}

async function requestCore<T>({
  method,
  path,
  requestId,
  body,
  idempotencyKey,
}: {
  method: 'GET' | 'POST';
  path: string;
  requestId: string;
  body?: unknown;
  idempotencyKey?: string;
}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${coreApiBaseUrl()}${path}`, {
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
    });
    let payload: CoreEnvelope<T>;
    try {
      payload = await response.json() as CoreEnvelope<T>;
    } catch {
      throw new CustomerMediaGatewayError('CUSTOMER_MEDIA_GATEWAY_RESPONSE_INVALID', 'Phản hồi ảnh khách hàng không hợp lệ', 502, false);
    }
    if (!response.ok) {
      throw new CustomerMediaGatewayError(
        payload.error?.code || 'CUSTOMER_MEDIA_REQUEST_FAILED',
        payload.error?.message || 'Yêu cầu ảnh khách hàng không thành công',
        response.status,
        payload.error?.retryable === true,
        payload.error?.details ?? {},
      );
    }
    if (!Object.prototype.hasOwnProperty.call(payload, 'data')) {
      throw new CustomerMediaGatewayError('CUSTOMER_MEDIA_GATEWAY_RESPONSE_INVALID', 'Phản hồi ảnh khách hàng không hợp lệ', 502, false);
    }
    return payload.data as T;
  } catch (error) {
    const normalized = normalizeCustomerMediaGatewayError(error);
    logGatewayFailure({
      gateway: 'customer-media',
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

export function listCustomerMedia<T>(customerId: string, requestId: string): Promise<T> {
  return requestCore<T>({ method: 'GET', path: customerMediaPath(customerId), requestId });
}

export function mutateCustomerMedia<T>(
  customerId: string,
  requestId: string,
  body: unknown,
  idempotencyKey: string | null | undefined,
): Promise<T> {
  return requestCore<T>({
    method: 'POST',
    path: customerMediaPath(customerId),
    requestId,
    body,
    idempotencyKey: mutationKey(idempotencyKey),
  });
}

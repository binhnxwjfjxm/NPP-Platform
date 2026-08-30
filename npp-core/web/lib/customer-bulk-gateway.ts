import 'server-only';
import { isValidIdempotencyKey, normalizeIdempotencyKey } from '@npp/contracts';
import { logGatewayFailure } from './gateway-diagnostics';
import { requireNppWorkforceSessionToken } from './internal-auth-client';
import { CustomerGatewayError } from './customer-gateway';

const REQUEST_TIMEOUT_MS = 8_000;
type Method = 'POST' | 'PATCH';
type CoreEnvelope<T> = { data?: T; error?: { code?: string; message?: string; retryable?: boolean; details?: unknown } };

function coreApiBaseUrl() {
  const raw = process.env.CORE_API_INTERNAL_URL?.trim();
  if (!raw) throw new CustomerGatewayError('CUSTOMER_GATEWAY_NOT_CONFIGURED', 'Cổng khách hàng chưa được cấu hình', 503, false);
  let url: URL;
  try { url = new URL(raw); } catch { throw new CustomerGatewayError('CUSTOMER_GATEWAY_NOT_CONFIGURED', 'Cổng khách hàng chưa được cấu hình', 503, false); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')) {
    throw new CustomerGatewayError('CUSTOMER_GATEWAY_NOT_CONFIGURED', 'Cổng khách hàng chưa được cấu hình', 503, false);
  }
  url.pathname = url.pathname.replace(/\/$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function exactIdempotencyKey(value: string | undefined) {
  const normalized = normalizeIdempotencyKey(value);
  if (!normalized || !isValidIdempotencyKey(normalized)) {
    throw new CustomerGatewayError('INVALID_IDEMPOTENCY_KEY', 'Khóa chống trùng yêu cầu không hợp lệ', 400, false);
  }
  return normalized;
}

async function requestBulk<T>({ method, path, requestId, body, idempotencyKey }: { method: Method; path: string; requestId: string; body: unknown; idempotencyKey?: string }) {
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
        'Content-Type': 'application/json',
        'x-request-id': requestId,
        ...(idempotencyKey ? { 'Idempotency-Key': exactIdempotencyKey(idempotencyKey) } : {}),
      },
      body: JSON.stringify(body),
    });
    let payload: CoreEnvelope<T>;
    try { payload = await response.json() as CoreEnvelope<T>; } catch { throw new CustomerGatewayError('CUSTOMER_GATEWAY_RESPONSE_INVALID', 'Phản hồi khách hàng không hợp lệ', 502, false); }
    if (!response.ok) throw new CustomerGatewayError(payload.error?.code || 'CUSTOMER_REQUEST_FAILED', payload.error?.message || 'Yêu cầu khách hàng không thành công', response.status, payload.error?.retryable === true, payload.error?.details ?? {});
    if (!Object.prototype.hasOwnProperty.call(payload, 'data')) throw new CustomerGatewayError('CUSTOMER_GATEWAY_RESPONSE_INVALID', 'Phản hồi khách hàng không hợp lệ', 502, false);
    return payload.data as T;
  } catch (error) {
    const normalized = error instanceof CustomerGatewayError ? error : new CustomerGatewayError('CUSTOMER_GATEWAY_UNAVAILABLE', 'Cổng khách hàng tạm thời không khả dụng', 503, true);
    logGatewayFailure({ gateway: 'customer', method, upstreamPath: path, status: normalized.statusCode, requestId, code: normalized.code });
    throw normalized;
  } finally {
    clearTimeout(timeout);
  }
}

export function identifyCustomers<T>(requestId: string, body: unknown): Promise<T> {
  return requestBulk<T>({ method: 'POST', path: '/api/customers/identify', requestId, body });
}
export function importCustomers<T>(requestId: string, body: unknown, idempotencyKey?: string): Promise<T> {
  return requestBulk<T>({ method: 'POST', path: '/api/customers/import', requestId, body, idempotencyKey });
}
export function bulkUpdateCustomers<T>(requestId: string, body: unknown, idempotencyKey?: string): Promise<T> {
  return requestBulk<T>({ method: 'PATCH', path: '/api/customers/bulk-update', requestId, body, idempotencyKey });
}

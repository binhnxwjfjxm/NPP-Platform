import 'server-only';
import { isValidIdempotencyKey, normalizeIdempotencyKey } from '@npp/contracts';
import { SalesOrderGatewayError } from './sales-order-gateway';
import { requireNppWorkforceSessionToken } from './internal-auth-client';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_TIMEOUT_MS = 30_000;

type CoreEnvelope<T> = {
  data?: T;
  error?: { code?: string; message?: string; retryable?: boolean; details?: unknown };
  requestId?: string;
};

function baseUrl() {
  const raw = process.env.CORE_API_INTERNAL_URL?.trim();
  if (!raw) {
    throw new SalesOrderGatewayError('SALES_ORDER_GATEWAY_NOT_CONFIGURED', 'Chức năng bán hàng chưa được cấu hình', 503, false);
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SalesOrderGatewayError('SALES_ORDER_GATEWAY_NOT_CONFIGURED', 'Chức năng bán hàng chưa được cấu hình', 503, false);
  }
  if (!['http:', 'https:'].includes(url.protocol)
      || url.username
      || url.password
      || (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')) {
    throw new SalesOrderGatewayError('SALES_ORDER_GATEWAY_NOT_CONFIGURED', 'Chức năng bán hàng chưa được cấu hình', 503, false);
  }
  url.pathname = url.pathname.replace(/\/$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function salesOrderId(value: string) {
  const normalized = String(value ?? '').trim();
  if (!UUID_PATTERN.test(normalized)) {
    throw new SalesOrderGatewayError('INVALID_SALES_ORDER_ID', 'Mã đơn bán hàng không hợp lệ', 400, false);
  }
  return normalized;
}

function idempotencyKey(value: string) {
  const normalized = normalizeIdempotencyKey(value);
  if (!normalized || !isValidIdempotencyKey(normalized)) {
    throw new SalesOrderGatewayError('INVALID_IDEMPOTENCY_KEY', 'Khóa chống trùng yêu cầu không hợp lệ', 400, false);
  }
  return normalized;
}

async function request<T>({
  id,
  action,
  requestId,
  body,
  key,
}: {
  id: string;
  action: 'complete' | 'settlement';
  requestId: string;
  body: unknown;
  key: string;
}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl()}/api/manual-sales-orders/${salesOrderId(id)}/${action}`, {
      method: 'POST',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${requireNppWorkforceSessionToken()}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'x-request-id': requestId,
        'Idempotency-Key': idempotencyKey(key),
      },
      body: JSON.stringify(body ?? {}),
    });
    let payload: CoreEnvelope<T>;
    try {
      payload = await response.json() as CoreEnvelope<T>;
    } catch {
      throw new SalesOrderGatewayError('SALES_ORDER_GATEWAY_RESPONSE_INVALID', 'Phản hồi bán hàng không hợp lệ', 502, false);
    }
    if (!response.ok) {
      throw new SalesOrderGatewayError(
        payload.error?.code ?? 'SALES_ORDER_REQUEST_FAILED',
        payload.error?.message ?? 'Yêu cầu bán hàng không thành công',
        response.status,
        payload.error?.retryable === true,
        payload.error?.details ?? {},
      );
    }
    if (!Object.prototype.hasOwnProperty.call(payload, 'data')) {
      throw new SalesOrderGatewayError('SALES_ORDER_GATEWAY_RESPONSE_INVALID', 'Phản hồi bán hàng không hợp lệ', 502, false);
    }
    return payload.data as T;
  } catch (error) {
    if (error instanceof SalesOrderGatewayError) throw error;
    throw new SalesOrderGatewayError('SALES_ORDER_GATEWAY_UNAVAILABLE', 'Chức năng bán hàng tạm thời chưa khả dụng', 503, true);
  } finally {
    clearTimeout(timeout);
  }
}

export function completeManualSalesOrder<T>(id: string, requestId: string, body: unknown, key: string) {
  return request<T>({ id, action: 'complete', requestId, body, key });
}

export function settleManualSalesOrder<T>(id: string, requestId: string, body: unknown, key: string) {
  return request<T>({ id, action: 'settlement', requestId, body, key });
}
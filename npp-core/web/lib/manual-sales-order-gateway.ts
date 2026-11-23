import 'server-only';
import { isValidIdempotencyKey, normalizeIdempotencyKey } from '@npp/contracts';
import { SalesOrderGatewayError } from './sales-order-gateway';
import { recordSalesGatewayFailure, recordSlowSalesGatewayRequest } from './sales-order-gateway-diagnostics';
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
  const startedAt = Date.now();
  const path = `/api/manual-sales-orders/:id/${action}`;
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
    } catch (error) {
      // An abort or broken body stream is transport failure (possibly timeout),
      // not invalid JSON. Let the outer handler classify it as 503/504.
      if (controller.signal.aborted || !(error instanceof SyntaxError)) throw error;
      recordSalesGatewayFailure({
        requestId, method: 'POST', path, durationMs: Date.now() - startedAt,
        type: 'invalid_response', statusCode: response.status,
      });
      throw new SalesOrderGatewayError(
        'SALES_ORDER_GATEWAY_RESPONSE_INVALID',
        'Phản hồi từ Công Ty không hợp lệ. Kiểm tra chứng từ trước khi thử lại.',
        502, true,
      );
    }
    if (!payload || typeof payload !== 'object') {
      recordSalesGatewayFailure({
        requestId, method: 'POST', path, durationMs: Date.now() - startedAt,
        type: 'invalid_response', statusCode: response.status,
      });
      throw new SalesOrderGatewayError('SALES_ORDER_GATEWAY_RESPONSE_INVALID', 'Phản hồi bán hàng không hợp lệ.', 502, true);
    }
    if (!response.ok) {
      if (response.status >= 500) {
        recordSalesGatewayFailure({
          requestId, method: 'POST', path, durationMs: Date.now() - startedAt,
          type: 'upstream_failure', statusCode: response.status,
        });
      }
      throw new SalesOrderGatewayError(
        payload.error?.code ?? 'SALES_ORDER_REQUEST_FAILED',
        payload.error?.message ?? 'Yêu cầu bán hàng không thành công',
        response.status,
        payload.error?.retryable === true,
        payload.error?.details ?? {},
      );
    }
    if (!Object.prototype.hasOwnProperty.call(payload, 'data')) {
      recordSalesGatewayFailure({
        requestId, method: 'POST', path, durationMs: Date.now() - startedAt,
        type: 'invalid_response', statusCode: response.status,
      });
      throw new SalesOrderGatewayError('SALES_ORDER_GATEWAY_RESPONSE_INVALID', 'Phản hồi bán hàng thiếu dữ liệu.', 502, true);
    }
    recordSlowSalesGatewayRequest({
      requestId, method: 'POST', path, durationMs: Date.now() - startedAt,
      statusCode: response.status,
    });
    return payload.data as T;
  } catch (error) {
    if (error instanceof SalesOrderGatewayError) throw error;
    const timedOut = controller.signal.aborted;
    recordSalesGatewayFailure({
      requestId, method: 'POST', path, durationMs: Date.now() - startedAt,
      type: timedOut ? 'timeout' : 'transport',
    });
    throw new SalesOrderGatewayError(
      timedOut ? 'SALES_ORDER_GATEWAY_TIMEOUT' : 'SALES_ORDER_GATEWAY_UNAVAILABLE',
      timedOut
        ? 'Công Ty phản hồi quá thời gian. Kiểm tra chứng từ trước khi gửi lại.'
        : 'Mất kết nối đến Công Ty. Kiểm tra chứng từ trước khi gửi lại.',
      timedOut ? 504 : 503, true,
    );
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
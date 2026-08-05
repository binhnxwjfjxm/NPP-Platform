import 'server-only';

import { InventoryGatewayError } from './inventory-gateway';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_TIMEOUT_MS = 30_000;

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
    throw new InventoryGatewayError('DELIVERY_ATTEMPT_GATEWAY_NOT_CONFIGURED', 'Cổng kết quả giao chưa được cấu hình', 503, false);
  }
  return value;
}

function baseUrl(): string {
  let parsed: URL;
  try {
    parsed = new URL(requiredServerValue('CORE_API_INTERNAL_URL'));
  } catch {
    throw new InventoryGatewayError('DELIVERY_ATTEMPT_GATEWAY_NOT_CONFIGURED', 'Cổng kết quả giao chưa được cấu hình', 503, false);
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new InventoryGatewayError('DELIVERY_ATTEMPT_GATEWAY_NOT_CONFIGURED', 'Cổng kết quả giao chưa được cấu hình', 503, false);
  }
  if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    throw new InventoryGatewayError('DELIVERY_ATTEMPT_GATEWAY_NOT_CONFIGURED', 'Cổng kết quả giao chưa được cấu hình', 503, false);
  }
  parsed.pathname = parsed.pathname.replace(/\/$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

async function getCoreData<T>(path: string, requestId: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl()}${path}`, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${requiredServerValue('CORE_API_SERVER_TOKEN')}`,
        Accept: 'application/json',
        'x-request-id': requestId,
      },
    });
    let payload: CoreEnvelope<T>;
    try {
      payload = await response.json() as CoreEnvelope<T>;
    } catch {
      throw new InventoryGatewayError('DELIVERY_ATTEMPT_GATEWAY_RESPONSE_INVALID', 'Phản hồi kết quả giao không hợp lệ', 502, false);
    }
    if (!response.ok) {
      throw new InventoryGatewayError(
        payload.error?.code || 'DELIVERY_ATTEMPT_REQUEST_FAILED',
        payload.error?.message || 'Không tải được kết quả giao',
        response.status,
        payload.error?.retryable === true,
        payload.error?.details ?? {},
      );
    }
    if (!Object.prototype.hasOwnProperty.call(payload, 'data')) {
      throw new InventoryGatewayError('DELIVERY_ATTEMPT_GATEWAY_RESPONSE_INVALID', 'Phản hồi kết quả giao không hợp lệ', 502, false);
    }
    return payload.data as T;
  } catch (error) {
    if (error instanceof InventoryGatewayError) throw error;
    throw new InventoryGatewayError('DELIVERY_ATTEMPT_GATEWAY_UNAVAILABLE', 'Cổng kết quả giao tạm thời không khả dụng', 503, true);
  } finally {
    clearTimeout(timeout);
  }
}

export async function getDeliveryAttemptSummary<T>(tripId: string, requestId: string): Promise<T> {
  if (!UUID_PATTERN.test(tripId)) {
    throw new InventoryGatewayError('INVALID_TRIP_ID', 'Mã chuyến giao không hợp lệ', 400, false);
  }
  return getCoreData<T>(`/api/logistics/trips/${encodeURIComponent(tripId)}/attempts`, requestId);
}

export async function getDeliveryAttemptProofs<T>(
  tripId: string,
  attemptId: string,
  requestId: string,
): Promise<T> {
  if (!UUID_PATTERN.test(tripId) || !UUID_PATTERN.test(attemptId)) {
    throw new InventoryGatewayError('INVALID_POD_LINEAGE', 'Mã chuyến hoặc lần giao không hợp lệ', 400, false);
  }
  return getCoreData<T>(
    `/api/logistics/trips/${encodeURIComponent(tripId)}/attempts/${encodeURIComponent(attemptId)}/pod`,
    requestId,
  );
}

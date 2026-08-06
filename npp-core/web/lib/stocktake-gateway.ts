import 'server-only';

import { randomUUID } from 'node:crypto';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const REQUEST_TIMEOUT_MS = 30_000;

interface CoreEnvelope<T> {
  data?: T;
  error?: { code?: string; message?: string; retryable?: boolean; details?: unknown };
}

export class StocktakeGatewayError extends Error {
  constructor(
    public readonly code: string,
    public readonly publicMessage: string,
    public readonly statusCode: number,
    public readonly retryable: boolean,
    public readonly details: unknown = {},
  ) {
    super(publicMessage);
    this.name = 'StocktakeGatewayError';
  }
}

function requiredServerValue(name: 'CORE_API_INTERNAL_URL' | 'CORE_API_SERVER_TOKEN'): string {
  const value = process.env[name]?.trim();
  if (!value) throw new StocktakeGatewayError('STOCKTAKE_GATEWAY_NOT_CONFIGURED', 'Cổng kiểm kê chưa được cấu hình', 503, false);
  return value;
}

function coreApiBaseUrl(): string {
  let parsed: URL;
  try {
    parsed = new URL(requiredServerValue('CORE_API_INTERNAL_URL'));
  } catch {
    throw new StocktakeGatewayError('STOCKTAKE_GATEWAY_NOT_CONFIGURED', 'Cổng kiểm kê chưa được cấu hình', 503, false);
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new StocktakeGatewayError('STOCKTAKE_GATEWAY_NOT_CONFIGURED', 'Cổng kiểm kê chưa được cấu hình', 503, false);
  }
  if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    throw new StocktakeGatewayError('STOCKTAKE_GATEWAY_NOT_CONFIGURED', 'Cổng kiểm kê chưa được cấu hình', 503, false);
  }
  parsed.pathname = parsed.pathname.replace(/\/$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

export function resolveStocktakeRequestId(value: string | null | undefined): string {
  const candidate = String(value ?? '').trim();
  return REQUEST_ID_PATTERN.test(candidate) ? candidate : `web_${randomUUID()}`;
}

export function normalizeStocktakeGatewayError(error: unknown): StocktakeGatewayError {
  if (error instanceof StocktakeGatewayError) return error;
  return new StocktakeGatewayError('STOCKTAKE_GATEWAY_UNAVAILABLE', 'Dữ liệu kiểm kê tạm thời chưa sẵn sàng', 503, true);
}

function assertUuid(value: string): void {
  if (!UUID_PATTERN.test(value)) throw new StocktakeGatewayError('INVALID_STOCKTAKE_ID', 'Mã kiểm kê không hợp lệ', 400, false);
}

function requiredIdempotencyKey(value: string | null | undefined): string {
  const key = String(value ?? '').trim();
  if (!IDEMPOTENCY_PATTERN.test(key)) {
    throw new StocktakeGatewayError('INVALID_IDEMPOTENCY_KEY', 'Khóa chống xử lý trùng không hợp lệ', 400, false);
  }
  return key;
}

async function requestStocktake<T>({
  path,
  method,
  requestId,
  body,
  searchParams,
  idempotencyKey,
}: {
  path: string;
  method: 'GET' | 'POST';
  requestId: string;
  body?: unknown;
  searchParams?: URLSearchParams;
  idempotencyKey?: string | null;
}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const query = new URLSearchParams();
  for (const [key, value] of searchParams?.entries() ?? []) {
    if (['status', 'warehouseId', 'limit', 'offset'].includes(key) && value.length <= 128) query.append(key, value);
  }
  try {
    const response = await fetch(`${coreApiBaseUrl()}/api/inventory/stocktakes${path}${query.toString() ? `?${query.toString()}` : ''}`, {
      method,
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${requiredServerValue('CORE_API_SERVER_TOKEN')}`,
        Accept: 'application/json',
        'x-request-id': requestId,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(idempotencyKey ? { 'Idempotency-Key': requiredIdempotencyKey(idempotencyKey) } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = await response.json().catch(() => null) as CoreEnvelope<T> | null;
    if (!payload) throw new StocktakeGatewayError('STOCKTAKE_GATEWAY_RESPONSE_INVALID', 'Phản hồi kiểm kê không hợp lệ', 502, false);
    if (!response.ok) {
      throw new StocktakeGatewayError(
        payload.error?.code || 'STOCKTAKE_REQUEST_FAILED',
        payload.error?.message || 'Yêu cầu kiểm kê không thành công',
        response.status,
        payload.error?.retryable === true,
        payload.error?.details ?? {},
      );
    }
    if (!Object.prototype.hasOwnProperty.call(payload, 'data')) {
      throw new StocktakeGatewayError('STOCKTAKE_GATEWAY_RESPONSE_INVALID', 'Phản hồi kiểm kê không hợp lệ', 502, false);
    }
    return payload.data as T;
  } catch (error) {
    if (error instanceof StocktakeGatewayError) throw error;
    throw new StocktakeGatewayError('STOCKTAKE_GATEWAY_UNAVAILABLE', 'Cổng kiểm kê tạm thời không khả dụng', 503, true);
  } finally {
    clearTimeout(timeout);
  }
}

export function listStocktakes<T>(requestId: string, searchParams = new URLSearchParams()): Promise<T> {
  return requestStocktake<T>({ path: '', method: 'GET', requestId, searchParams });
}

export function getStocktake<T>(id: string, requestId: string): Promise<T> {
  assertUuid(id);
  return requestStocktake<T>({ path: `/${id}`, method: 'GET', requestId });
}

export function createStocktake<T>(requestId: string, body: unknown, idempotencyKey: string | null): Promise<T> {
  return requestStocktake<T>({ path: '', method: 'POST', requestId, body, idempotencyKey });
}

export function transitionStocktake<T>(
  id: string,
  action: 'count' | 'submit' | 'recount' | 'approve' | 'post' | 'cancel' | 'reverse',
  requestId: string,
  body: unknown,
  idempotencyKey: string | null,
): Promise<T> {
  assertUuid(id);
  return requestStocktake<T>({ path: `/${id}/${action}`, method: 'POST', requestId, body, idempotencyKey });
}

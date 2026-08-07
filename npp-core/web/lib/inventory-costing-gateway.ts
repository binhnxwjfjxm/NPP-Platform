import 'server-only';
import { randomUUID } from 'node:crypto';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
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

export class InventoryCostingGatewayError extends Error {
  constructor(
    public readonly code: string,
    public readonly publicMessage: string,
    public readonly statusCode: number,
    public readonly retryable: boolean,
    public readonly details: unknown = {},
  ) {
    super(publicMessage);
    this.name = 'InventoryCostingGatewayError';
  }
}

function requiredServerValue(
  name: 'CORE_API_INTERNAL_URL' | 'CORE_API_SERVER_TOKEN',
): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new InventoryCostingGatewayError(
      'INVENTORY_COSTING_GATEWAY_NOT_CONFIGURED',
      'Cổng giá vốn tồn kho chưa được cấu hình',
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
    throw new InventoryCostingGatewayError(
      'INVENTORY_COSTING_GATEWAY_NOT_CONFIGURED',
      'Cổng giá vốn tồn kho chưa được cấu hình',
      503,
      false,
    );
  }
  if (!['http:', 'https:'].includes(parsed.protocol)
      || parsed.username
      || parsed.password
      || (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:')) {
    throw new InventoryCostingGatewayError(
      'INVENTORY_COSTING_GATEWAY_NOT_CONFIGURED',
      'Cổng giá vốn tồn kho chưa được cấu hình',
      503,
      false,
    );
  }
  parsed.pathname = parsed.pathname.replace(/\/$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

export function resolveInventoryCostingRequestId(
  value: string | null | undefined,
): string {
  const candidate = String(value ?? '').trim();
  return REQUEST_ID_PATTERN.test(candidate)
    ? candidate
    : `web_${randomUUID()}`;
}

function requiredIdempotencyKey(value: string | null | undefined): string {
  const candidate = String(value ?? '').trim();
  if (!IDEMPOTENCY_PATTERN.test(candidate)) {
    throw new InventoryCostingGatewayError(
      'INVALID_IDEMPOTENCY_KEY',
      'Khóa chống xử lý trùng không hợp lệ',
      400,
      false,
    );
  }
  return candidate;
}

async function requestCosting<T>({
  path,
  method,
  requestId,
  searchParams,
  body,
  idempotencyKey,
}: {
  path: string;
  method: 'GET' | 'POST';
  requestId: string;
  searchParams?: URLSearchParams;
  body?: unknown;
  idempotencyKey?: string | null;
}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const query = new URLSearchParams();
  for (const [key, value] of searchParams?.entries() ?? []) {
    if (['status', 'runId', 'movementId', 'code', 'limit', 'offset'].includes(key)
        && value.length <= 128) {
      query.append(key, value);
    }
  }
  try {
    const response = await fetch(
      `${coreApiBaseUrl()}/api/inventory/costing${path}${query.toString() ? `?${query}` : ''}`,
      {
        method,
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${requiredServerValue('CORE_API_SERVER_TOKEN')}`,
          Accept: 'application/json',
          'x-request-id': requestId,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(idempotencyKey
            ? { 'Idempotency-Key': requiredIdempotencyKey(idempotencyKey) }
            : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
    const payload = await response.json().catch(() => null) as CoreEnvelope<T> | null;
    if (!payload) {
      throw new InventoryCostingGatewayError(
        'INVENTORY_COSTING_RESPONSE_INVALID',
        'Phản hồi giá vốn tồn kho không hợp lệ',
        502,
        false,
      );
    }
    if (!response.ok) {
      throw new InventoryCostingGatewayError(
        payload.error?.code || 'INVENTORY_COSTING_REQUEST_FAILED',
        payload.error?.message || 'Yêu cầu giá vốn tồn kho không thành công',
        response.status,
        payload.error?.retryable === true,
        payload.error?.details ?? {},
      );
    }
    if (!Object.prototype.hasOwnProperty.call(payload, 'data')) {
      throw new InventoryCostingGatewayError(
        'INVENTORY_COSTING_RESPONSE_INVALID',
        'Phản hồi giá vốn tồn kho không hợp lệ',
        502,
        false,
      );
    }
    return payload.data as T;
  } catch (error) {
    if (error instanceof InventoryCostingGatewayError) throw error;
    throw new InventoryCostingGatewayError(
      'INVENTORY_COSTING_GATEWAY_UNAVAILABLE',
      'Cổng giá vốn tồn kho tạm thời không khả dụng',
      503,
      true,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export const listInventoryCostBalances = <T>(
  requestId: string,
  searchParams = new URLSearchParams(),
) => requestCosting<T>({
  path: '/balances',
  method: 'GET',
  requestId,
  searchParams,
});

export const listInventoryCostFacts = <T>(
  requestId: string,
  searchParams = new URLSearchParams(),
) => requestCosting<T>({
  path: '/facts',
  method: 'GET',
  requestId,
  searchParams,
});

export const listInventoryCostAnomalies = <T>(
  requestId: string,
  searchParams = new URLSearchParams(),
) => requestCosting<T>({
  path: '/anomalies',
  method: 'GET',
  requestId,
  searchParams,
});

export const listInventoryCostReconciliation = <T>(
  requestId: string,
  searchParams = new URLSearchParams(),
) => requestCosting<T>({
  path: '/reconciliation',
  method: 'GET',
  requestId,
  searchParams,
});

export const getLatestInventoryCostingRun = <T>(requestId: string) =>
  requestCosting<T>({
    path: '/run',
    method: 'GET',
    requestId,
  });

export const rebuildInventoryCosting = <T>(
  requestId: string,
  body: unknown,
  idempotencyKey: string | null,
) => requestCosting<T>({
  path: '/rebuild',
  method: 'POST',
  requestId,
  body,
  idempotencyKey,
});

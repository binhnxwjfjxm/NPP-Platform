import 'server-only';

import { randomUUID } from 'node:crypto';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_TIMEOUT_MS = 30_000;
const ALLOWED_QUERY_KEYS = new Set([
  'search',
  'active',
  'limit',
  'offset',
  'baseVariantId',
  'warehouseId',
  'locationId',
  'lotId',
]);

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

export class InventoryGatewayError extends Error {
  constructor(
    public readonly code: string,
    public readonly publicMessage: string,
    public readonly statusCode: number,
    public readonly retryable: boolean,
    public readonly details: unknown = {},
  ) {
    super(publicMessage);
    this.name = 'InventoryGatewayError';
  }
}

export function resolveInventoryRequestId(value: string | null | undefined): string {
  const candidate = String(value ?? '').trim();
  return REQUEST_ID_PATTERN.test(candidate) ? candidate : `web_${randomUUID()}`;
}

export function normalizeInventoryGatewayError(error: unknown): InventoryGatewayError {
  if (error instanceof InventoryGatewayError) return error;
  return new InventoryGatewayError('INVENTORY_GATEWAY_UNAVAILABLE', 'Dữ liệu tồn kho tạm thời chưa sẵn sàng', 503, true);
}

function requiredServerValue(name: 'CORE_API_INTERNAL_URL' | 'CORE_API_SERVER_TOKEN'): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new InventoryGatewayError('INVENTORY_GATEWAY_NOT_CONFIGURED', 'Cổng tồn kho chưa được cấu hình', 503, false);
  }
  return value;
}

function coreApiBaseUrl(): string {
  const raw = requiredServerValue('CORE_API_INTERNAL_URL');
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new InventoryGatewayError('INVENTORY_GATEWAY_NOT_CONFIGURED', 'Cổng tồn kho chưa được cấu hình', 503, false);
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new InventoryGatewayError('INVENTORY_GATEWAY_NOT_CONFIGURED', 'Cổng tồn kho chưa được cấu hình', 503, false);
  }
  if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    throw new InventoryGatewayError('INVENTORY_GATEWAY_NOT_CONFIGURED', 'Cổng tồn kho chưa được cấu hình', 503, false);
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

async function requestInventory<T>({
  path,
  method,
  requestId,
  searchParams,
  body,
  idempotencyKey,
}: {
  path: string;
  method: 'GET' | 'POST' | 'PUT';
  requestId: string;
  searchParams?: URLSearchParams;
  body?: unknown;
  idempotencyKey?: string;
}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${coreApiBaseUrl()}/api/inventory${path}${searchParams ? safeQuery(searchParams) : ''}`, {
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
      throw new InventoryGatewayError('INVENTORY_GATEWAY_RESPONSE_INVALID', 'Phản hồi tồn kho không hợp lệ', 502, false);
    }

    if (!response.ok) {
      throw new InventoryGatewayError(
        payload.error?.code || 'INVENTORY_REQUEST_FAILED',
        payload.error?.message || 'Yêu cầu tồn kho không thành công',
        response.status,
        payload.error?.retryable === true,
        payload.error?.details ?? {},
      );
    }

    if (!Object.prototype.hasOwnProperty.call(payload, 'data')) {
      throw new InventoryGatewayError('INVENTORY_GATEWAY_RESPONSE_INVALID', 'Phản hồi tồn kho không hợp lệ', 502, false);
    }

    return payload.data as T;
  } catch (error) {
    if (error instanceof InventoryGatewayError) throw error;
    throw new InventoryGatewayError('INVENTORY_GATEWAY_UNAVAILABLE', 'Cổng tồn kho tạm thời không khả dụng', 503, true);
  } finally {
    clearTimeout(timeout);
  }
}

export function listInventoryTrackingPolicies<T>(requestId: string, searchParams: URLSearchParams): Promise<T> {
  return requestInventory<T>({ path: '/tracking-policies', method: 'GET', requestId, searchParams });
}

export function getInventoryTrackingPolicy<T>(baseVariantId: string, requestId: string): Promise<T> {
  if (!UUID_PATTERN.test(baseVariantId)) {
    throw new InventoryGatewayError('INVALID_BASE_VARIANT_ID', 'Mã biến thể cơ sở không hợp lệ', 400, false);
  }
  return requestInventory<T>({ path: `/tracking-policies/${baseVariantId}`, method: 'GET', requestId });
}

export function upsertInventoryTrackingPolicy<T>(
  baseVariantId: string,
  requestId: string,
  body: unknown,
  idempotencyKey?: string,
): Promise<T> {
  if (!UUID_PATTERN.test(baseVariantId)) {
    throw new InventoryGatewayError('INVALID_BASE_VARIANT_ID', 'Mã biến thể cơ sở không hợp lệ', 400, false);
  }
  return requestInventory<T>({
    path: `/tracking-policies/${baseVariantId}`,
    method: 'PUT',
    requestId,
    body,
    idempotencyKey: idempotencyKey?.trim() || `web-${randomUUID()}`,
  });
}

export function listInventoryLots<T>(requestId: string, searchParams: URLSearchParams): Promise<T> {
  return requestInventory<T>({ path: '/lots', method: 'GET', requestId, searchParams });
}

export function getInventoryLot<T>(id: string, requestId: string): Promise<T> {
  if (!UUID_PATTERN.test(id)) {
    throw new InventoryGatewayError('INVALID_LOT_ID', 'Mã lô không hợp lệ', 400, false);
  }
  return requestInventory<T>({ path: `/lots/${id}`, method: 'GET', requestId });
}

export function listInventoryBalances<T>(requestId: string, searchParams: URLSearchParams): Promise<T> {
  return requestInventory<T>({ path: '/balances', method: 'GET', requestId, searchParams });
}

export function listInventoryBalanceDrillDown<T>(requestId: string, searchParams: URLSearchParams): Promise<T> {
  return requestInventory<T>({ path: '/balances/drill-down', method: 'GET', requestId, searchParams });
}

export function listOpeningBalanceImports<T>(requestId: string, searchParams: URLSearchParams): Promise<T> {
  return requestInventory<T>({ path: '/opening-balances', method: 'GET', requestId, searchParams });
}

export function getOpeningBalanceImport<T>(id: string, requestId: string): Promise<T> {
  if (!UUID_PATTERN.test(id)) {
    throw new InventoryGatewayError('INVALID_OPENING_BALANCE_IMPORT_ID', 'Mã nhập tồn đầu kỳ không hợp lệ', 400, false);
  }
  return requestInventory<T>({ path: `/opening-balances/${id}`, method: 'GET', requestId });
}

export function validateOpeningBalanceImport<T>(requestId: string, body: unknown): Promise<T> {
  return requestInventory<T>({ path: '/opening-balances/validate', method: 'POST', requestId, body });
}

export function postOpeningBalanceImport<T>(
  requestId: string,
  body: unknown,
  idempotencyKey?: string,
): Promise<T> {
  return requestInventory<T>({
    path: '/opening-balances/post',
    method: 'POST',
    requestId,
    body,
    idempotencyKey: idempotencyKey?.trim() || `web-${randomUUID()}`,
  });
}

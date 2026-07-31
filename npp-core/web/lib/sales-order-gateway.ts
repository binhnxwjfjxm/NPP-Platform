import 'server-only';

import { randomUUID } from 'node:crypto';
import type { ListSalesOrdersParams } from './sales-order-types';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,200}$/;
const REQUEST_TIMEOUT_MS = 8_000;
const ALLOWED_QUERY_KEYS = new Set(['limit', 'offset', 'status', 'customerId', 'warehouseId', 'search']);

type CoreEnvelope<T> = {
  data?: T;
  error?: { code?: string; message?: string; retryable?: boolean; details?: unknown };
  requestId?: string;
};

export class SalesOrderGatewayError extends Error {
  constructor(
    public readonly code: string,
    public readonly publicMessage: string,
    public readonly statusCode: number,
    public readonly retryable: boolean,
    public readonly details: unknown = {},
  ) {
    super(publicMessage);
    this.name = 'SalesOrderGatewayError';
  }
}

export function resolveSalesOrderRequestId(value: string | null | undefined): string {
  const candidate = String(value ?? '').trim();
  return REQUEST_ID_PATTERN.test(candidate) ? candidate : `web_${randomUUID()}`;
}

export function normalizeSalesOrderGatewayError(error: unknown): SalesOrderGatewayError {
  if (error instanceof SalesOrderGatewayError) return error;
  return new SalesOrderGatewayError(
    'SALES_ORDER_GATEWAY_UNAVAILABLE',
    'Chức năng bán hàng tạm thời chưa sẵn sàng',
    503,
    true,
  );
}

function requiredServerValue(name: 'CORE_API_INTERNAL_URL' | 'CORE_API_SERVER_TOKEN'): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new SalesOrderGatewayError(
      'SALES_ORDER_GATEWAY_NOT_CONFIGURED',
      'Chức năng bán hàng chưa được cấu hình',
      503,
      false,
    );
  }
  return value;
}

function coreApiBaseUrl(): string {
  const raw = requiredServerValue('CORE_API_INTERNAL_URL');
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new SalesOrderGatewayError('SALES_ORDER_GATEWAY_NOT_CONFIGURED', 'Chức năng bán hàng chưa được cấu hình', 503, false);
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new SalesOrderGatewayError('SALES_ORDER_GATEWAY_NOT_CONFIGURED', 'Chức năng bán hàng chưa được cấu hình', 503, false);
  }
  if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    throw new SalesOrderGatewayError('SALES_ORDER_GATEWAY_NOT_CONFIGURED', 'Chức năng bán hàng chưa được cấu hình', 503, false);
  }
  parsed.pathname = parsed.pathname.replace(/\/$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

function assertUuid(value: string, code = 'INVALID_SALES_ORDER_ID', message = 'Mã đơn bán hàng không hợp lệ'): string {
  const normalized = String(value ?? '').trim();
  if (!UUID_PATTERN.test(normalized)) throw new SalesOrderGatewayError(code, message, 400, false);
  return normalized;
}

function assertVersion(value: string | number): string {
  const normalized = String(value ?? '').trim();
  if (!/^[1-9]\d{0,18}$/.test(normalized)) {
    throw new SalesOrderGatewayError('INVALID_SALES_ORDER_VERSION', 'Phiên bản đơn bán hàng không hợp lệ', 400, false);
  }
  return normalized;
}

function assertIdempotencyKey(value: string | null | undefined): string {
  const normalized = String(value ?? '').trim();
  if (!IDEMPOTENCY_KEY_PATTERN.test(normalized)) {
    throw new SalesOrderGatewayError('INVALID_IDEMPOTENCY_KEY', 'Khóa chống trùng yêu cầu không hợp lệ', 400, false);
  }
  return normalized;
}

function orderPath(id?: string): string {
  return `/api/sales-orders${id ? `/${assertUuid(id)}` : ''}`;
}

function safeQuery(searchParams: URLSearchParams): string {
  const next = new URLSearchParams();
  for (const [key, value] of searchParams.entries()) {
    if (!ALLOWED_QUERY_KEYS.has(key) || value.length > 256) continue;
    next.append(key, value);
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
  method: 'GET' | 'POST' | 'PUT';
  path: string;
  requestId: string;
  searchParams?: URLSearchParams;
  body?: unknown;
  idempotencyKey?: string;
}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const query = searchParams ? safeQuery(searchParams) : '';
    const response = await fetch(`${coreApiBaseUrl()}${path}${query}`, {
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
      payload = await response.json() as CoreEnvelope<T>;
    } catch {
      throw new SalesOrderGatewayError('SALES_ORDER_GATEWAY_RESPONSE_INVALID', 'Phản hồi bán hàng không hợp lệ', 502, false);
    }
    if (!response.ok) {
      throw new SalesOrderGatewayError(
        payload.error?.code || 'SALES_ORDER_REQUEST_FAILED',
        payload.error?.message || 'Yêu cầu bán hàng không thành công',
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

export function listSalesOrders<T>(requestId: string, params: ListSalesOrdersParams = {}): Promise<T[]> {
  const query = new URLSearchParams();
  if (params.limit !== undefined) query.set('limit', String(Math.max(1, Math.min(1000, Math.trunc(params.limit)))));
  if (params.offset !== undefined) query.set('offset', String(Math.max(0, Math.trunc(params.offset))));
  if (params.status && params.status !== 'all') query.set('status', params.status);
  if (params.customerId) query.set('customerId', assertUuid(params.customerId, 'INVALID_CUSTOMER_ID', 'Mã khách hàng không hợp lệ'));
  if (params.warehouseId) query.set('warehouseId', assertUuid(params.warehouseId, 'INVALID_WAREHOUSE_ID', 'Mã kho không hợp lệ'));
  if (params.search?.trim()) query.set('search', params.search.trim().slice(0, 256));
  return requestCore<T[]>({ method: 'GET', path: orderPath(), requestId, searchParams: query });
}

export function getSalesOrderEntrySettings<T>(requestId: string): Promise<T> {
  return requestCore<T>({ method: 'GET', path: `${orderPath()}/entry-settings`, requestId });
}

export function searchSalesOrderSkus<T>(requestId: string, searchParams: URLSearchParams): Promise<T[]> {
  const query = new URLSearchParams();
  const search = searchParams.get('search')?.trim() ?? '';
  const limit = Number(searchParams.get('limit') ?? 20);
  const offset = Number(searchParams.get('offset') ?? 0);
  if (search) query.set('search', search.slice(0, 256));
  query.set('limit', String(Number.isFinite(limit) ? Math.max(1, Math.min(50, Math.trunc(limit))) : 20));
  query.set('offset', String(Number.isFinite(offset) ? Math.max(0, Math.trunc(offset)) : 0));
  return requestCore<T[]>({ method: 'GET', path: `${orderPath()}/sku-search`, requestId, searchParams: query });
}

export function getSalesOrder<T>(id: string, requestId: string): Promise<T> {
  return requestCore<T>({ method: 'GET', path: orderPath(id), requestId });
}

export function createSalesOrder<T>(requestId: string, body: unknown, idempotencyKey: string): Promise<T> {
  return requestCore<T>({ method: 'POST', path: orderPath(), requestId, body, idempotencyKey: assertIdempotencyKey(idempotencyKey) });
}

export function updateSalesOrderDraft<T>(id: string, requestId: string, body: unknown, idempotencyKey: string): Promise<T> {
  return requestCore<T>({
    method: 'PUT',
    path: `${orderPath(id)}/draft`,
    requestId,
    body,
    idempotencyKey: assertIdempotencyKey(idempotencyKey),
  });
}

export function confirmSalesOrder<T>(id: string, requestId: string, idempotencyKey: string): Promise<T> {
  return requestCore<T>({ method: 'POST', path: `${orderPath(id)}/confirm`, requestId, body: {}, idempotencyKey: assertIdempotencyKey(idempotencyKey) });
}

export function createSalesOrderAmendment<T>(id: string, requestId: string, body: unknown, idempotencyKey: string): Promise<T> {
  return requestCore<T>({ method: 'POST', path: `${orderPath(id)}/amendments`, requestId, body, idempotencyKey: assertIdempotencyKey(idempotencyKey) });
}

export function updateSalesOrderAmendment<T>(id: string, version: string | number, requestId: string, body: unknown, idempotencyKey: string): Promise<T> {
  return requestCore<T>({
    method: 'PUT',
    path: `${orderPath(id)}/amendments/${assertVersion(version)}/draft`,
    requestId,
    body,
    idempotencyKey: assertIdempotencyKey(idempotencyKey),
  });
}

export function confirmSalesOrderAmendment<T>(id: string, version: string | number, requestId: string, idempotencyKey: string): Promise<T> {
  return requestCore<T>({
    method: 'POST',
    path: `${orderPath(id)}/amendments/${assertVersion(version)}/confirm`,
    requestId,
    body: {},
    idempotencyKey: assertIdempotencyKey(idempotencyKey),
  });
}

export function cancelSalesOrder<T>(id: string, requestId: string, body: unknown, idempotencyKey: string): Promise<T> {
  return requestCore<T>({ method: 'POST', path: `${orderPath(id)}/cancel`, requestId, body, idempotencyKey: assertIdempotencyKey(idempotencyKey) });
}

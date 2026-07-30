import 'server-only';

import { randomUUID } from 'node:crypto';
import type { ListPurchaseOrdersParams } from './purchase-order-types';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,200}$/;
const REQUEST_TIMEOUT_MS = 8_000;
const ALLOWED_QUERY_KEYS = new Set(['limit', 'offset', 'status', 'supplierId', 'warehouseId', 'search']);

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

export class PurchaseOrderGatewayError extends Error {
  constructor(
    public readonly code: string,
    public readonly publicMessage: string,
    public readonly statusCode: number,
    public readonly retryable: boolean,
    public readonly details: unknown = {},
  ) {
    super(publicMessage);
    this.name = 'PurchaseOrderGatewayError';
  }
}

export function resolvePurchaseOrderRequestId(value: string | null | undefined): string {
  const candidate = String(value ?? '').trim();
  return REQUEST_ID_PATTERN.test(candidate) ? candidate : `web_${randomUUID()}`;
}

export function normalizePurchaseOrderGatewayError(error: unknown): PurchaseOrderGatewayError {
  if (error instanceof PurchaseOrderGatewayError) return error;
  return new PurchaseOrderGatewayError(
    'PURCHASE_ORDER_GATEWAY_UNAVAILABLE',
    'Chức năng mua hàng tạm thời chưa sẵn sàng',
    503,
    true,
  );
}

function requiredServerValue(name: 'CORE_API_INTERNAL_URL' | 'CORE_API_SERVER_TOKEN'): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new PurchaseOrderGatewayError(
      'PURCHASE_ORDER_GATEWAY_NOT_CONFIGURED',
      'Chức năng mua hàng chưa được cấu hình',
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
    throw new PurchaseOrderGatewayError(
      'PURCHASE_ORDER_GATEWAY_NOT_CONFIGURED',
      'Chức năng mua hàng chưa được cấu hình',
      503,
      false,
    );
  }

  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new PurchaseOrderGatewayError(
      'PURCHASE_ORDER_GATEWAY_NOT_CONFIGURED',
      'Chức năng mua hàng chưa được cấu hình',
      503,
      false,
    );
  }
  if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    throw new PurchaseOrderGatewayError(
      'PURCHASE_ORDER_GATEWAY_NOT_CONFIGURED',
      'Chức năng mua hàng chưa được cấu hình',
      503,
      false,
    );
  }

  parsed.pathname = parsed.pathname.replace(/\/$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

function assertUuid(value: string, code: string, message: string): string {
  const normalized = value.trim();
  if (!UUID_PATTERN.test(normalized)) {
    throw new PurchaseOrderGatewayError(code, message, 400, false);
  }
  return normalized;
}

function assertIdempotencyKey(value: string | null | undefined): string {
  const normalized = String(value ?? '').trim();
  if (!IDEMPOTENCY_KEY_PATTERN.test(normalized)) {
    throw new PurchaseOrderGatewayError(
      'INVALID_IDEMPOTENCY_KEY',
      'Khóa chống trùng yêu cầu không hợp lệ',
      400,
      false,
    );
  }
  return normalized;
}

function purchaseOrderPath(id?: string): string {
  return `/api/purchase-orders${id ? `/${assertUuid(id, 'INVALID_PURCHASE_ORDER_ID', 'Mã đơn đặt hàng không hợp lệ')}` : ''}`;
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
  method: 'GET' | 'POST' | 'PATCH';
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
      payload = (await response.json()) as CoreEnvelope<T>;
    } catch {
      throw new PurchaseOrderGatewayError(
        'PURCHASE_ORDER_GATEWAY_RESPONSE_INVALID',
        'Phản hồi mua hàng không hợp lệ',
        502,
        false,
      );
    }

    if (!response.ok) {
      throw new PurchaseOrderGatewayError(
        payload.error?.code || 'PURCHASE_ORDER_REQUEST_FAILED',
        payload.error?.message || 'Yêu cầu mua hàng không thành công',
        response.status,
        payload.error?.retryable === true,
        payload.error?.details ?? {},
      );
    }

    if (!Object.prototype.hasOwnProperty.call(payload, 'data')) {
      throw new PurchaseOrderGatewayError(
        'PURCHASE_ORDER_GATEWAY_RESPONSE_INVALID',
        'Phản hồi mua hàng không hợp lệ',
        502,
        false,
      );
    }

    return payload.data as T;
  } catch (error) {
    if (error instanceof PurchaseOrderGatewayError) throw error;
    throw new PurchaseOrderGatewayError(
      'PURCHASE_ORDER_GATEWAY_UNAVAILABLE',
      'Chức năng mua hàng tạm thời chưa khả dụng',
      503,
      true,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function listPurchaseOrders<T>(requestId: string, params?: ListPurchaseOrdersParams): Promise<T[]> {
  const query = new URLSearchParams();
  if (params?.limit !== undefined) query.set('limit', String(Math.max(1, Math.min(1000, Math.trunc(params.limit)))));
  if (params?.offset !== undefined) query.set('offset', String(Math.max(0, Math.trunc(params.offset))));
  if (params?.status && params.status !== 'all') query.set('status', params.status);
  if (params?.supplierId) query.set('supplierId', assertUuid(params.supplierId, 'INVALID_SUPPLIER_ID', 'Mã nhà cung cấp không hợp lệ'));
  if (params?.warehouseId) query.set('warehouseId', assertUuid(params.warehouseId, 'INVALID_WAREHOUSE_ID', 'Mã kho nhận không hợp lệ'));
  if (params?.search?.trim()) query.set('search', params.search.trim().slice(0, 256));
  return requestCore<T[]>({ method: 'GET', path: purchaseOrderPath(), requestId, searchParams: query });
}

export function getPurchaseOrder<T>(id: string, requestId: string): Promise<T> {
  return requestCore<T>({ method: 'GET', path: purchaseOrderPath(id), requestId });
}

export function createPurchaseOrderDraft<T>(
  requestId: string,
  body: unknown,
  idempotencyKey: string,
): Promise<T> {
  return requestCore<T>({
    method: 'POST',
    path: purchaseOrderPath(),
    requestId,
    body,
    idempotencyKey: assertIdempotencyKey(idempotencyKey),
  });
}

export function patchPurchaseOrderDraft<T>(
  id: string,
  requestId: string,
  body: unknown,
  idempotencyKey: string,
): Promise<T> {
  return requestCore<T>({
    method: 'PATCH',
    path: purchaseOrderPath(id),
    requestId,
    body,
    idempotencyKey: assertIdempotencyKey(idempotencyKey),
  });
}

function postPurchaseOrderAction<T>(
  id: string,
  action: 'submit' | 'approve' | 'cancel',
  requestId: string,
  idempotencyKey: string,
  body?: unknown,
): Promise<T> {
  return requestCore<T>({
    method: 'POST',
    path: `${purchaseOrderPath(id)}/${action}`,
    requestId,
    body: body ?? {},
    idempotencyKey: assertIdempotencyKey(idempotencyKey),
  });
}

export function submitPurchaseOrder<T>(
  id: string,
  requestId: string,
  idempotencyKey: string,
  body?: unknown,
): Promise<T> {
  return postPurchaseOrderAction<T>(id, 'submit', requestId, idempotencyKey, body);
}

export function approvePurchaseOrder<T>(
  id: string,
  requestId: string,
  idempotencyKey: string,
  body?: unknown,
): Promise<T> {
  return postPurchaseOrderAction<T>(id, 'approve', requestId, idempotencyKey, body);
}

export function cancelPurchaseOrder<T>(
  id: string,
  requestId: string,
  idempotencyKey: string,
  body?: unknown,
): Promise<T> {
  return postPurchaseOrderAction<T>(id, 'cancel', requestId, idempotencyKey, body);
}

export function searchPurchaseOrderSkuOptions<T>(
  requestId: string,
  params: { search?: string; limit?: number; offset?: number } = {},
): Promise<T[]> {
  const query = new URLSearchParams();
  if (params.search?.trim()) query.set('search', params.search.trim().slice(0, 256));
  if (params.limit !== undefined) query.set('limit', String(Math.max(1, Math.min(50, Math.trunc(params.limit)))));
  if (params.offset !== undefined) query.set('offset', String(Math.max(0, Math.trunc(params.offset))));
  return requestCore<T[]>({ method: 'GET', path: '/api/purchase-orders/sku-search', requestId, searchParams: query });
}

export function resolvePurchaseOrderSkuOptions<T>(
  requestId: string,
  identifiers: readonly string[],
): Promise<T[]> {
  return requestCore<T[]>({
    method: 'POST',
    path: '/api/purchase-orders/sku-resolve',
    requestId,
    body: { identifiers: identifiers.slice(0, 500) },
  });
}

import 'server-only';

import { randomUUID } from 'node:crypto';
import type { PurchaseOrder, ListPurchaseOrdersParams } from './purchase-order-types';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const REQUEST_TIMEOUT_MS = 8_000;

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
  return new PurchaseOrderGatewayError('PURCHASE_ORDER_GATEWAY_UNAVAILABLE', 'Chức năng mua hàng tạm thời chưa sẵn sàng', 503, true);
}

function requiredServerValue(name: 'CORE_API_INTERNAL_URL' | 'CORE_API_SERVER_TOKEN'): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new PurchaseOrderGatewayError('PURCHASE_ORDER_GATEWAY_NOT_CONFIGURED', 'Chức năng mua hàng chưa được cấu hình', 503, false);
  }
  return value;
}

function coreApiBaseUrl(): string {
  const raw = requiredServerValue('CORE_API_INTERNAL_URL');
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new PurchaseOrderGatewayError('PURCHASE_ORDER_GATEWAY_NOT_CONFIGURED', 'Chức năng mua hàng chưa được cấu hình', 503, false);
  }

  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new PurchaseOrderGatewayError('PURCHASE_ORDER_GATEWAY_NOT_CONFIGURED', 'Chức năng mua hàng chưa được cấu hình', 503, false);
  }
  if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    throw new PurchaseOrderGatewayError('PURCHASE_ORDER_GATEWAY_NOT_CONFIGURED', 'Chức năng mua hàng chưa được cấu hình', 503, false);
  }

  parsed.pathname = parsed.pathname.replace(/\/$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

async function requestCore<T>({ method, path, requestId, searchParams, body, idempotencyKey, }: {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  requestId: string;
  searchParams?: URLSearchParams;
  body?: unknown;
  idempotencyKey?: string;
}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const query = searchParams ? `?${searchParams.toString()}` : '';
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
      throw new PurchaseOrderGatewayError('PURCHASE_ORDER_GATEWAY_RESPONSE_INVALID', 'Phản hồi mua hàng không hợp lệ', 502, false);
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
      throw new PurchaseOrderGatewayError('PURCHASE_ORDER_GATEWAY_RESPONSE_INVALID', 'Phản hồi mua hàng không hợp lệ', 502, false);
    }

    return payload.data as T;
  } catch (error) {
    if (error instanceof PurchaseOrderGatewayError) throw error;
    throw new PurchaseOrderGatewayError('PURCHASE_ORDER_GATEWAY_UNAVAILABLE', 'Chức năng mua hàng tạm thời chưa khả dụng', 503, true);
  } finally {
    clearTimeout(timeout);
  }
}

export function listPurchaseOrders<T>(requestId: string, params?: ListPurchaseOrdersParams): Promise<T[]> {
  const qs = new URLSearchParams();
  if (params?.limit) qs.append('limit', String(params.limit));
  if (params?.offset) qs.append('offset', String(params.offset));
  if (params?.status) qs.append('status', String(params.status));
  if (params?.supplierId) qs.append('supplierId', params.supplierId);
  if (params?.warehouseId) qs.append('warehouseId', params.warehouseId);
  if (params?.search) qs.append('search', params.search);
  return requestCore<T[]>({ method: 'GET', path: '/api/purchase-orders', requestId, searchParams: qs });
}

export function getPurchaseOrder<T>(id: string, requestId: string): Promise<T> {
  const sanitized = encodeURIComponent(id);
  return requestCore<T>({ method: 'GET', path: `/api/purchase-orders/${sanitized}`, requestId });
}

export function createPurchaseOrderDraft<T>(requestId: string, body: unknown, idempotencyKey?: string): Promise<T> {
  return requestCore<T>({ method: 'POST', path: '/api/purchase-orders', requestId, body, idempotencyKey: idempotencyKey?.trim() || `web-${randomUUID()}` });
}

export function patchPurchaseOrderDraft<T>(id: string, requestId: string, body: unknown): Promise<T> {
  const sanitized = encodeURIComponent(id);
  return requestCore<T>({ method: 'PATCH', path: `/api/purchase-orders/${sanitized}`, requestId, body });
}

export function submitPurchaseOrder<T>(id: string, requestId: string): Promise<T> {
  const sanitized = encodeURIComponent(id);
  return requestCore<T>({ method: 'POST', path: `/api/purchase-orders/${sanitized}/submit`, requestId });
}

export function approvePurchaseOrder<T>(id: string, requestId: string): Promise<T> {
  const sanitized = encodeURIComponent(id);
  return requestCore<T>({ method: 'POST', path: `/api/purchase-orders/${sanitized}/approve`, requestId });
}

export function cancelPurchaseOrder<T>(id: string, requestId: string): Promise<T> {
  const sanitized = encodeURIComponent(id);
  return requestCore<T>({ method: 'POST', path: `/api/purchase-orders/${sanitized}/cancel`, requestId });
}

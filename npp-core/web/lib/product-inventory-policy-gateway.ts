import 'server-only';
import { randomUUID } from 'node:crypto';
import { isValidIdempotencyKey, normalizeIdempotencyKey } from '@npp/contracts';
import { requireNppWorkforceSessionToken } from './internal-auth-client';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_TIMEOUT_MS = 8_000;

type Envelope<T> = {
  data?: T;
  error?: { code?: string; message?: string; retryable?: boolean; details?: unknown };
};

export class ProductInventoryPolicyGatewayError extends Error {
  constructor(
    public readonly code: string,
    public readonly publicMessage: string,
    public readonly statusCode: number,
    public readonly retryable: boolean,
    public readonly details: unknown = {},
  ) {
    super(publicMessage);
    this.name = 'ProductInventoryPolicyGatewayError';
  }
}

export function resolveProductInventoryPolicyRequestId(value: string | null | undefined) {
  const candidate = String(value ?? '').trim();
  return REQUEST_ID_PATTERN.test(candidate) ? candidate : `web_${randomUUID()}`;
}

export function normalizeProductInventoryPolicyGatewayError(error: unknown) {
  return error instanceof ProductInventoryPolicyGatewayError
    ? error
    : new ProductInventoryPolicyGatewayError('PRODUCT_GATEWAY_UNAVAILABLE', 'Chính sách Kho tạm thời chưa sẵn sàng', 503, true);
}

function baseUrl() {
  const raw = process.env.CORE_API_INTERNAL_URL?.trim();
  if (!raw) throw new ProductInventoryPolicyGatewayError('PRODUCT_GATEWAY_NOT_CONFIGURED', 'Cổng sản phẩm chưa được cấu hình', 503, false);
  let url: URL;
  try { url = new URL(raw); } catch {
    throw new ProductInventoryPolicyGatewayError('PRODUCT_GATEWAY_NOT_CONFIGURED', 'Cổng sản phẩm chưa được cấu hình', 503, false);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')) {
    throw new ProductInventoryPolicyGatewayError('PRODUCT_GATEWAY_NOT_CONFIGURED', 'Cổng sản phẩm chưa được cấu hình', 503, false);
  }
  url.pathname = url.pathname.replace(/\/$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function productId(value: string) {
  const normalized = String(value ?? '').trim();
  if (!UUID_PATTERN.test(normalized)) {
    throw new ProductInventoryPolicyGatewayError('INVALID_PRODUCT_ID', 'Mã sản phẩm không hợp lệ', 400, false);
  }
  return normalized;
}

function idempotencyKey(value: string | null | undefined) {
  const normalized = normalizeIdempotencyKey(String(value ?? ''));
  if (!normalized || !isValidIdempotencyKey(normalized)) {
    throw new ProductInventoryPolicyGatewayError('INVALID_IDEMPOTENCY_KEY', 'Khóa chống xử lý trùng không hợp lệ', 400, false);
  }
  return normalized;
}

async function request<T>({
  method,
  path,
  requestId,
  body,
  key,
}: {
  method: 'GET' | 'PATCH';
  path: string;
  requestId: string;
  body?: unknown;
  key?: string;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl()}${path}`, {
      method,
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${requireNppWorkforceSessionToken()}`,
        Accept: 'application/json',
        'x-request-id': requestId,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    let payload: Envelope<T>;
    try { payload = await response.json() as Envelope<T>; } catch {
      throw new ProductInventoryPolicyGatewayError('PRODUCT_GATEWAY_RESPONSE_INVALID', 'Phản hồi chính sách Kho không hợp lệ', 502, false);
    }
    if (!response.ok) {
      throw new ProductInventoryPolicyGatewayError(
        payload.error?.code ?? 'PRODUCT_REQUEST_FAILED',
        payload.error?.message ?? 'Yêu cầu chính sách Kho không thành công',
        response.status,
        payload.error?.retryable === true,
        payload.error?.details ?? {},
      );
    }
    if (!Object.prototype.hasOwnProperty.call(payload, 'data')) {
      throw new ProductInventoryPolicyGatewayError('PRODUCT_GATEWAY_RESPONSE_INVALID', 'Phản hồi chính sách Kho không hợp lệ', 502, false);
    }
    return payload.data as T;
  } catch (error) {
    if (error instanceof ProductInventoryPolicyGatewayError) throw error;
    throw new ProductInventoryPolicyGatewayError('PRODUCT_GATEWAY_UNAVAILABLE', 'Chính sách Kho tạm thời chưa sẵn sàng', 503, true);
  } finally {
    clearTimeout(timeout);
  }
}

export function listProductInventoryPolicies<T>(requestId: string): Promise<T[]> {
  return request<T[]>({ method: 'GET', path: '/api/products/inventory-policies', requestId });
}

export function getProductInventoryPolicy<T>(id: string, requestId: string): Promise<T> {
  return request<T>({ method: 'GET', path: `/api/products/${productId(id)}/inventory-policy`, requestId });
}

export function patchProductInventoryPolicy<T>(id: string, requestId: string, body: unknown, key: string): Promise<T> {
  return request<T>({
    method: 'PATCH',
    path: `/api/products/${productId(id)}/inventory-policy`,
    requestId,
    body,
    key: idempotencyKey(key),
  });
}

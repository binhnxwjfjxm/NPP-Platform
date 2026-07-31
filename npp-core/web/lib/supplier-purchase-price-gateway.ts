import 'server-only';

import { randomUUID } from 'node:crypto';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,200}$/;
const REQUEST_TIMEOUT_MS = 8_000;

interface CoreEnvelope<T> {
  data?: T;
  error?: { code?: string; message?: string; retryable?: boolean; details?: unknown };
}

export class SupplierPurchasePriceGatewayError extends Error {
  constructor(
    public readonly code: string,
    public readonly publicMessage: string,
    public readonly statusCode: number,
    public readonly retryable: boolean,
    public readonly details: unknown = {},
  ) {
    super(publicMessage);
    this.name = 'SupplierPurchasePriceGatewayError';
  }
}

export function resolveSupplierPurchasePriceRequestId(value: string | null | undefined): string {
  const candidate = String(value ?? '').trim();
  return REQUEST_ID_PATTERN.test(candidate) ? candidate : `web_${randomUUID()}`;
}

function requiredServerValue(name: 'CORE_API_INTERNAL_URL' | 'CORE_API_SERVER_TOKEN'): string {
  const value = process.env[name]?.trim();
  if (!value) throw new SupplierPurchasePriceGatewayError('PURCHASE_PRICE_GATEWAY_NOT_CONFIGURED', 'Bảng giá mua chưa được cấu hình.', 503, false);
  return value;
}

function coreApiBaseUrl(): string {
  let parsed: URL;
  try {
    parsed = new URL(requiredServerValue('CORE_API_INTERNAL_URL'));
  } catch {
    throw new SupplierPurchasePriceGatewayError('PURCHASE_PRICE_GATEWAY_NOT_CONFIGURED', 'Bảng giá mua chưa được cấu hình.', 503, false);
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new SupplierPurchasePriceGatewayError('PURCHASE_PRICE_GATEWAY_NOT_CONFIGURED', 'Bảng giá mua chưa được cấu hình.', 503, false);
  }
  if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    throw new SupplierPurchasePriceGatewayError('PURCHASE_PRICE_GATEWAY_NOT_CONFIGURED', 'Bảng giá mua chưa được cấu hình.', 503, false);
  }
  parsed.pathname = parsed.pathname.replace(/\/$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

function uuid(value: string, field: string): string {
  const normalized = String(value ?? '').trim();
  if (!UUID_PATTERN.test(normalized)) throw new SupplierPurchasePriceGatewayError(`INVALID_${field.toUpperCase()}`, `${field} không hợp lệ.`, 400, false);
  return normalized;
}

function idempotencyKey(value: string | null | undefined): string {
  const normalized = String(value ?? '').trim();
  if (!IDEMPOTENCY_KEY_PATTERN.test(normalized)) {
    throw new SupplierPurchasePriceGatewayError('INVALID_IDEMPOTENCY_KEY', 'Khóa chống trùng yêu cầu không hợp lệ.', 400, false);
  }
  return normalized;
}

async function requestCore<T>({
  method,
  path,
  requestId,
  body,
  key,
}: {
  method: 'GET' | 'POST' | 'PATCH';
  path: string;
  requestId: string;
  body?: unknown;
  key?: string;
}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${coreApiBaseUrl()}${path}`, {
      method,
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${requiredServerValue('CORE_API_SERVER_TOKEN')}`,
        Accept: 'application/json',
        'x-request-id': requestId,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = await response.json().catch(() => null) as CoreEnvelope<T> | null;
    if (!payload) throw new SupplierPurchasePriceGatewayError('PURCHASE_PRICE_RESPONSE_INVALID', 'Phản hồi bảng giá mua không hợp lệ.', 502, false);
    if (!response.ok) {
      throw new SupplierPurchasePriceGatewayError(
        payload.error?.code || 'PURCHASE_PRICE_REQUEST_FAILED',
        payload.error?.message || 'Yêu cầu bảng giá mua không thành công.',
        response.status,
        payload.error?.retryable === true,
        payload.error?.details ?? {},
      );
    }
    if (!Object.prototype.hasOwnProperty.call(payload, 'data')) {
      throw new SupplierPurchasePriceGatewayError('PURCHASE_PRICE_RESPONSE_INVALID', 'Phản hồi bảng giá mua không hợp lệ.', 502, false);
    }
    return payload.data as T;
  } catch (error) {
    if (error instanceof SupplierPurchasePriceGatewayError) throw error;
    throw new SupplierPurchasePriceGatewayError('PURCHASE_PRICE_GATEWAY_UNAVAILABLE', 'Bảng giá mua tạm thời chưa khả dụng.', 503, true);
  } finally {
    clearTimeout(timeout);
  }
}

export function listSupplierPurchasePrices<T>(requestId: string, searchParams: URLSearchParams): Promise<T[]> {
  const query = new URLSearchParams();
  const supplierId = searchParams.get('supplierId');
  const variantId = searchParams.get('variantId');
  const active = searchParams.get('active');
  const limit = searchParams.get('limit');
  const offset = searchParams.get('offset');
  if (supplierId) query.set('supplierId', uuid(supplierId, 'supplierId'));
  if (variantId) query.set('variantId', uuid(variantId, 'variantId'));
  if (active === 'true' || active === 'false') query.set('active', active);
  if (limit) query.set('limit', String(Math.max(1, Math.min(1000, Number(limit) || 100))));
  if (offset) query.set('offset', String(Math.max(0, Number(offset) || 0)));
  const serialized = query.toString();
  return requestCore<T[]>({
    method: 'GET',
    path: `/api/supplier-purchase-prices${serialized ? `?${serialized}` : ''}`,
    requestId,
  });
}

export function createSupplierPurchasePrice<T>(requestId: string, body: unknown, key: string): Promise<T> {
  return requestCore<T>({
    method: 'POST',
    path: '/api/supplier-purchase-prices',
    requestId,
    body,
    key: idempotencyKey(key),
  });
}

export function updateSupplierPurchasePrice<T>(id: string, requestId: string, body: unknown): Promise<T> {
  return requestCore<T>({
    method: 'PATCH',
    path: `/api/supplier-purchase-prices/${uuid(id, 'purchasePriceId')}`,
    requestId,
    body,
  });
}

export function resolveSupplierPurchasePrice<T>(requestId: string, body: unknown): Promise<T> {
  return requestCore<T>({
    method: 'POST',
    path: '/api/supplier-purchase-prices/resolve',
    requestId,
    body,
  });
}

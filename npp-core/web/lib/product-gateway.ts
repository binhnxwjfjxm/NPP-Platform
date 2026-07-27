import 'server-only';

import { randomUUID } from 'node:crypto';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_TIMEOUT_MS = 8_000;
const ALLOWED_QUERY_KEYS = new Set([
  'active',
  'limit',
  'offset',
  'search',
  'categoryId',
  'brandId',
  'catalogVisible',
  'orderable',
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

export class ProductGatewayError extends Error {
  constructor(
    public readonly code: string,
    public readonly publicMessage: string,
    public readonly statusCode: number,
    public readonly retryable: boolean,
    public readonly details: unknown = {},
  ) {
    super(publicMessage);
    this.name = 'ProductGatewayError';
  }
}

export function resolveProductRequestId(value: string | null | undefined): string {
  const candidate = String(value ?? '').trim();
  return REQUEST_ID_PATTERN.test(candidate) ? candidate : `web_${randomUUID()}`;
}

export function normalizeProductGatewayError(error: unknown): ProductGatewayError {
  if (error instanceof ProductGatewayError) return error;
  return new ProductGatewayError('PRODUCT_GATEWAY_UNAVAILABLE', 'Dữ liệu danh mục sản phẩm tạm thời chưa sẵn sàng', 503, true);
}

function requiredServerValue(name: 'CORE_API_INTERNAL_URL' | 'CORE_API_SERVER_TOKEN') {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new ProductGatewayError('PRODUCT_GATEWAY_NOT_CONFIGURED', 'Cổng sản phẩm chưa được cấu hình', 503, false);
  }
  return value;
}

function coreApiBaseUrl(): string {
  const raw = requiredServerValue('CORE_API_INTERNAL_URL');
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ProductGatewayError('PRODUCT_GATEWAY_NOT_CONFIGURED', 'Cổng sản phẩm chưa được cấu hình', 503, false);
  }

  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new ProductGatewayError('PRODUCT_GATEWAY_NOT_CONFIGURED', 'Cổng sản phẩm chưa được cấu hình', 503, false);
  }
  if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    throw new ProductGatewayError('PRODUCT_GATEWAY_NOT_CONFIGURED', 'Cổng sản phẩm chưa được cấu hình', 503, false);
  }

  parsed.pathname = parsed.pathname.replace(/\/$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
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

function assertUuid(value: string, code: string, message: string): string {
  const normalized = String(value ?? '').trim();
  if (!UUID_PATTERN.test(normalized)) {
    throw new ProductGatewayError(code, message, 400, false);
  }
  return normalized;
}

function categoryPath(id?: string): string {
  return `/api/product-categories${id ? `/${assertUuid(id, 'INVALID_PRODUCT_CATEGORY_ID', 'Mã loại sản phẩm không hợp lệ')}` : ''}`;
}

function brandPath(id?: string): string {
  return `/api/product-brands${id ? `/${assertUuid(id, 'INVALID_PRODUCT_BRAND_ID', 'Mã nhãn hàng không hợp lệ')}` : ''}`;
}

function productPath(id?: string): string {
  return `/api/products${id ? `/${assertUuid(id, 'INVALID_PRODUCT_ID', 'Mã sản phẩm không hợp lệ')}` : ''}`;
}

function variantPath(productId: string, variantId?: string): string {
  const product = assertUuid(productId, 'INVALID_PRODUCT_ID', 'Mã sản phẩm không hợp lệ');
  return `/api/products/${product}/variants${variantId ? `/${assertUuid(variantId, 'INVALID_PRODUCT_VARIANT_ID', 'Mã biến thể sản phẩm không hợp lệ')}` : ''}`;
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
      throw new ProductGatewayError('PRODUCT_GATEWAY_RESPONSE_INVALID', 'Phản hồi sản phẩm không hợp lệ', 502, false);
    }

    if (!response.ok) {
      throw new ProductGatewayError(
        payload.error?.code || 'PRODUCT_REQUEST_FAILED',
        payload.error?.message || 'Yêu cầu sản phẩm không thành công',
        response.status,
        payload.error?.retryable === true,
        payload.error?.details ?? {},
      );
    }

    if (!Object.prototype.hasOwnProperty.call(payload, 'data')) {
      throw new ProductGatewayError('PRODUCT_GATEWAY_RESPONSE_INVALID', 'Phản hồi sản phẩm không hợp lệ', 502, false);
    }

    return payload.data as T;
  } catch (error) {
    if (error instanceof ProductGatewayError) throw error;
    throw new ProductGatewayError('PRODUCT_GATEWAY_UNAVAILABLE', 'Cổng sản phẩm tạm thời không khả dụng', 503, true);
  } finally {
    clearTimeout(timeout);
  }
}

export function listProductCategories<T>(requestId: string, searchParams = new URLSearchParams()): Promise<T[]> {
  return requestCore<T[]>({ method: 'GET', path: categoryPath(), requestId, searchParams });
}

export function getProductCategory<T>(id: string, requestId: string): Promise<T> {
  return requestCore<T>({ method: 'GET', path: categoryPath(id), requestId });
}

export function createProductCategory<T>(requestId: string, body: unknown, idempotencyKey?: string): Promise<T> {
  return requestCore<T>({
    method: 'POST',
    path: categoryPath(),
    requestId,
    body,
    idempotencyKey: idempotencyKey?.trim() || `web-${randomUUID()}`,
  });
}

export function patchProductCategory<T>(id: string, requestId: string, body: unknown): Promise<T> {
  return requestCore<T>({ method: 'PATCH', path: categoryPath(id), requestId, body });
}

export function listProductBrands<T>(requestId: string, searchParams = new URLSearchParams()): Promise<T[]> {
  return requestCore<T[]>({ method: 'GET', path: brandPath(), requestId, searchParams });
}

export function getProductBrand<T>(id: string, requestId: string): Promise<T> {
  return requestCore<T>({ method: 'GET', path: brandPath(id), requestId });
}

export function createProductBrand<T>(requestId: string, body: unknown, idempotencyKey?: string): Promise<T> {
  return requestCore<T>({
    method: 'POST',
    path: brandPath(),
    requestId,
    body,
    idempotencyKey: idempotencyKey?.trim() || `web-${randomUUID()}`,
  });
}

export function patchProductBrand<T>(id: string, requestId: string, body: unknown): Promise<T> {
  return requestCore<T>({ method: 'PATCH', path: brandPath(id), requestId, body });
}

export function listProducts<T>(requestId: string, searchParams = new URLSearchParams()): Promise<T[]> {
  return requestCore<T[]>({ method: 'GET', path: productPath(), requestId, searchParams });
}

export function getProduct<T>(id: string, requestId: string): Promise<T> {
  return requestCore<T>({ method: 'GET', path: productPath(id), requestId });
}

export function createProduct<T>(requestId: string, body: unknown, idempotencyKey?: string): Promise<T> {
  return requestCore<T>({
    method: 'POST',
    path: productPath(),
    requestId,
    body,
    idempotencyKey: idempotencyKey?.trim() || `web-${randomUUID()}`,
  });
}

export function patchProduct<T>(id: string, requestId: string, body: unknown): Promise<T> {
  return requestCore<T>({ method: 'PATCH', path: productPath(id), requestId, body });
}

export function listProductVariants<T>(productId: string, requestId: string): Promise<T[]> {
  return requestCore<T[]>({ method: 'GET', path: variantPath(productId), requestId });
}

export function createProductVariant<T>(productId: string, requestId: string, body: unknown, idempotencyKey?: string): Promise<T> {
  return requestCore<T>({
    method: 'POST',
    path: variantPath(productId),
    requestId,
    body,
    idempotencyKey: idempotencyKey?.trim() || `web-${randomUUID()}`,
  });
}

export function patchProductVariant<T>(productId: string, variantId: string, requestId: string, body: unknown): Promise<T> {
  return requestCore<T>({ method: 'PATCH', path: variantPath(productId, variantId), requestId, body });
}

export function importProducts<T>(requestId: string, body: unknown, idempotencyKey?: string): Promise<T> {
  return requestCore<T>({
    method: 'POST',
    path: '/api/products/import',
    requestId,
    body,
    idempotencyKey: idempotencyKey?.trim() || `web-${randomUUID()}`,
  });
}

function unitPath(id?: string): string {
  return `/api/units${id ? `/${assertUuid(id, 'INVALID_UNIT_ID', 'Mã đơn vị tính không hợp lệ')}` : ''}`;
}

function variantUnitPath(productId: string, variantId: string): string {
  return `${variantPath(productId, variantId)}/unit`;
}

function variantBarcodePath(productId: string, variantId: string, barcodeId?: string): string {
  const base = `${variantPath(productId, variantId)}/barcodes`;
  return barcodeId ? `${base}/${assertUuid(barcodeId, 'INVALID_PRODUCT_BARCODE_ID', 'Mã barcode không hợp lệ')}` : base;
}

export function listUnits<T>(requestId: string, searchParams = new URLSearchParams()): Promise<T[]> {
  return requestCore<T[]>({ method: 'GET', path: unitPath(), requestId, searchParams });
}

export function createUnit<T>(requestId: string, body: unknown, idempotencyKey?: string): Promise<T> {
  return requestCore<T>({ method: 'POST', path: unitPath(), requestId, body, idempotencyKey: idempotencyKey?.trim() || `web-${randomUUID()}` });
}

export function patchUnit<T>(id: string, requestId: string, body: unknown): Promise<T> {
  return requestCore<T>({ method: 'PATCH', path: unitPath(id), requestId, body });
}

export function getVariantUnit<T>(productId: string, variantId: string, requestId: string): Promise<T> {
  return requestCore<T>({ method: 'GET', path: variantUnitPath(productId, variantId), requestId });
}

export function patchVariantUnit<T>(productId: string, variantId: string, requestId: string, body: unknown): Promise<T> {
  return requestCore<T>({ method: 'PATCH', path: variantUnitPath(productId, variantId), requestId, body });
}

export function listVariantBarcodes<T>(productId: string, variantId: string, requestId: string): Promise<T[]> {
  return requestCore<T[]>({ method: 'GET', path: variantBarcodePath(productId, variantId), requestId });
}

export function createVariantBarcode<T>(productId: string, variantId: string, requestId: string, body: unknown, idempotencyKey?: string): Promise<T> {
  return requestCore<T>({ method: 'POST', path: variantBarcodePath(productId, variantId), requestId, body, idempotencyKey: idempotencyKey?.trim() || `web-${randomUUID()}` });
}

export function patchVariantBarcode<T>(productId: string, variantId: string, barcodeId: string, requestId: string, body: unknown): Promise<T> {
  return requestCore<T>({ method: 'PATCH', path: variantBarcodePath(productId, variantId, barcodeId), requestId, body });
}

export function normalizeVariantQuantity<T>(productId: string, variantId: string, requestId: string, body: unknown): Promise<T> {
  return requestCore<T>({ method: 'POST', path: `${variantPath(productId, variantId)}/normalize-quantity`, requestId, body });
}

export function importProductUnits<T>(requestId: string, body: unknown, idempotencyKey?: string): Promise<T> {
  return requestCore<T>({ method: 'POST', path: '/api/product-units/import', requestId, body, idempotencyKey: idempotencyKey?.trim() || `web-${randomUUID()}` });
}

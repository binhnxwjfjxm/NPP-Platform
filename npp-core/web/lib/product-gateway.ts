import 'server-only';
import { randomUUID } from 'node:crypto';
import { createIdempotencyKey, isValidIdempotencyKey, normalizeIdempotencyKey } from '@npp/contracts';
import { requireNppWorkforceSessionToken } from './internal-auth-client';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_TIMEOUT_MS = 8_000;
const ALLOWED_QUERY_KEYS = new Set(['active', 'limit', 'offset', 'search', 'categoryId', 'brandId', 'catalogVisible', 'orderable']);

interface CoreEnvelope<T> {
  data?: T;
  error?: { code?: string; message?: string; retryable?: boolean; details?: unknown };
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

export function resolveProductRequestId(value: string | null | undefined) {
  const candidate = String(value ?? '').trim();
  return REQUEST_ID_PATTERN.test(candidate) ? candidate : `web_${randomUUID()}`;
}

export function normalizeProductGatewayError(error: unknown) {
  return error instanceof ProductGatewayError
    ? error
    : new ProductGatewayError('PRODUCT_GATEWAY_UNAVAILABLE', 'Dữ liệu danh mục sản phẩm tạm thời chưa sẵn sàng', 503, true);
}

function baseUrl() {
  const raw = process.env.CORE_API_INTERNAL_URL?.trim();
  if (!raw) throw new ProductGatewayError('PRODUCT_GATEWAY_NOT_CONFIGURED', 'Cổng sản phẩm chưa được cấu hình', 503, false);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ProductGatewayError('PRODUCT_GATEWAY_NOT_CONFIGURED', 'Cổng sản phẩm chưa được cấu hình', 503, false);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')) {
    throw new ProductGatewayError('PRODUCT_GATEWAY_NOT_CONFIGURED', 'Cổng sản phẩm chưa được cấu hình', 503, false);
  }
  url.pathname = url.pathname.replace(/\/$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function safeQuery(params: URLSearchParams) {
  const next = new URLSearchParams();
  for (const [key, value] of params.entries()) {
    if (ALLOWED_QUERY_KEYS.has(key) && value.length <= 256) next.append(key, value);
  }
  const search = next.toString();
  return search ? `?${search}` : '';
}

function uuid(value: string, code: string, message: string) {
  const normalized = String(value ?? '').trim();
  if (!UUID_PATTERN.test(normalized)) throw new ProductGatewayError(code, message, 400, false);
  return normalized;
}

function categoryPath(id?: string) {
  return `/api/product-categories${id ? `/${uuid(id, 'INVALID_PRODUCT_CATEGORY_ID', 'Mã loại sản phẩm không hợp lệ')}` : ''}`;
}

function brandPath(id?: string) {
  return `/api/product-brands${id ? `/${uuid(id, 'INVALID_PRODUCT_BRAND_ID', 'Mã nhãn hàng không hợp lệ')}` : ''}`;
}

function productPath(id?: string) {
  return `/api/products${id ? `/${uuid(id, 'INVALID_PRODUCT_ID', 'Mã sản phẩm không hợp lệ')}` : ''}`;
}

function variantPath(productId: string, variantId?: string) {
  const product = uuid(productId, 'INVALID_PRODUCT_ID', 'Mã sản phẩm không hợp lệ');
  return `/api/products/${product}/variants${variantId ? `/${uuid(variantId, 'INVALID_PRODUCT_VARIANT_ID', 'Mã biến thể sản phẩm không hợp lệ')}` : ''}`;
}

function mutationKey(value: string | undefined, operation: string) {
  if (value === undefined || !value.trim()) return createIdempotencyKey(operation);
  const normalized = normalizeIdempotencyKey(value);
  if (!normalized || !isValidIdempotencyKey(normalized)) {
    throw new ProductGatewayError('INVALID_IDEMPOTENCY_KEY', 'Khóa chống xử lý trùng không hợp lệ', 400, false);
  }
  return normalized;
}

function requiredMutationKey(value: string | undefined, operation: string) {
  if (value === undefined || !value.trim()) {
    throw new ProductGatewayError('MISSING_IDEMPOTENCY_KEY', 'Thiếu khóa chống xử lý trùng cho thao tác cập nhật', 400, false);
  }
  return mutationKey(value, operation);
}

async function req<T>({
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
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl()}${path}${searchParams ? safeQuery(searchParams) : ''}`, {
      method,
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${requireNppWorkforceSessionToken()}`,
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

export function listProductCategories<T>(requestId: string, query = new URLSearchParams()): Promise<T[]> {
  return req<T[]>({ method: 'GET', path: categoryPath(), requestId, searchParams: query });
}
export function getProductCategory<T>(id: string, requestId: string): Promise<T> {
  return req<T>({ method: 'GET', path: categoryPath(id), requestId });
}
export function createProductCategory<T>(requestId: string, body: unknown, key?: string): Promise<T> {
  return req<T>({ method: 'POST', path: categoryPath(), requestId, body, idempotencyKey: mutationKey(key, 'product-category-create') });
}
export function patchProductCategory<T>(id: string, requestId: string, body: unknown): Promise<T> {
  return req<T>({ method: 'PATCH', path: categoryPath(id), requestId, body });
}

export function listProductBrands<T>(requestId: string, query = new URLSearchParams()): Promise<T[]> {
  return req<T[]>({ method: 'GET', path: brandPath(), requestId, searchParams: query });
}
export function getProductBrand<T>(id: string, requestId: string): Promise<T> {
  return req<T>({ method: 'GET', path: brandPath(id), requestId });
}
export function createProductBrand<T>(requestId: string, body: unknown, key?: string): Promise<T> {
  return req<T>({ method: 'POST', path: brandPath(), requestId, body, idempotencyKey: mutationKey(key, 'product-brand-create') });
}
export function patchProductBrand<T>(id: string, requestId: string, body: unknown): Promise<T> {
  return req<T>({ method: 'PATCH', path: brandPath(id), requestId, body });
}

export function listProducts<T>(requestId: string, query = new URLSearchParams()): Promise<T[]> {
  return req<T[]>({ method: 'GET', path: productPath(), requestId, searchParams: query });
}
export function getProduct<T>(id: string, requestId: string): Promise<T> {
  return req<T>({ method: 'GET', path: productPath(id), requestId });
}
export function createProduct<T>(requestId: string, body: unknown, key?: string): Promise<T> {
  return req<T>({ method: 'POST', path: productPath(), requestId, body, idempotencyKey: mutationKey(key, 'product-create') });
}
export function patchProduct<T>(id: string, requestId: string, body: unknown): Promise<T> {
  return req<T>({ method: 'PATCH', path: productPath(id), requestId, body });
}

export function listProductVariants<T>(productId: string, requestId: string): Promise<T[]> {
  return req<T[]>({ method: 'GET', path: variantPath(productId), requestId });
}
export function createProductVariant<T>(productId: string, requestId: string, body: unknown, key?: string): Promise<T> {
  return req<T>({ method: 'POST', path: variantPath(productId), requestId, body, idempotencyKey: mutationKey(key, 'product-variant-create') });
}
export function patchProductVariant<T>(productId: string, variantId: string, requestId: string, body: unknown): Promise<T> {
  return req<T>({ method: 'PATCH', path: variantPath(productId, variantId), requestId, body });
}
export function identifyProductVariants<T>(requestId: string, body: unknown): Promise<T> {
  return req<T>({ method: 'POST', path: '/api/products/variants/identify', requestId, body });
}
export function bulkUpdateProductVariants<T>(requestId: string, body: unknown, key?: string): Promise<T> {
  const dryRun = Boolean(body && typeof body === 'object' && !Array.isArray(body) && (body as { dryRun?: unknown }).dryRun === true);
  return req<T>({
    method: 'PATCH',
    path: '/api/products/variants/bulk-update',
    requestId,
    body,
    idempotencyKey: dryRun ? undefined : requiredMutationKey(key, 'product-variants-bulk-update'),
  });
}
export function importProducts<T>(requestId: string, body: unknown, key?: string): Promise<T> {
  return req<T>({ method: 'POST', path: '/api/products/import', requestId, body, idempotencyKey: mutationKey(key, 'products-import') });
}

function unitPath(id?: string) {
  return `/api/units${id ? `/${uuid(id, 'INVALID_UNIT_ID', 'Mã đơn vị tính không hợp lệ')}` : ''}`;
}
function variantUnitPath(productId: string, variantId: string) {
  return `${variantPath(productId, variantId)}/unit`;
}
function variantBarcodePath(productId: string, variantId: string, barcodeId?: string) {
  const base = `${variantPath(productId, variantId)}/barcodes`;
  return barcodeId ? `${base}/${uuid(barcodeId, 'INVALID_PRODUCT_BARCODE_ID', 'Mã barcode không hợp lệ')}` : base;
}

export function listUnits<T>(requestId: string, query = new URLSearchParams()): Promise<T[]> {
  return req<T[]>({ method: 'GET', path: unitPath(), requestId, searchParams: query });
}
export function createUnit<T>(requestId: string, body: unknown, key?: string): Promise<T> {
  return req<T>({ method: 'POST', path: unitPath(), requestId, body, idempotencyKey: mutationKey(key, 'unit-create') });
}
export function patchUnit<T>(id: string, requestId: string, body: unknown): Promise<T> {
  return req<T>({ method: 'PATCH', path: unitPath(id), requestId, body });
}
export function getVariantUnit<T>(productId: string, variantId: string, requestId: string): Promise<T> {
  return req<T>({ method: 'GET', path: variantUnitPath(productId, variantId), requestId });
}
export function patchVariantUnit<T>(productId: string, variantId: string, requestId: string, body: unknown): Promise<T> {
  return req<T>({ method: 'PATCH', path: variantUnitPath(productId, variantId), requestId, body });
}
export function listVariantBarcodes<T>(productId: string, variantId: string, requestId: string): Promise<T[]> {
  return req<T[]>({ method: 'GET', path: variantBarcodePath(productId, variantId), requestId });
}
export function createVariantBarcode<T>(productId: string, variantId: string, requestId: string, body: unknown, key?: string): Promise<T> {
  return req<T>({ method: 'POST', path: variantBarcodePath(productId, variantId), requestId, body, idempotencyKey: mutationKey(key, 'product-barcode-create') });
}
export function patchVariantBarcode<T>(productId: string, variantId: string, barcodeId: string, requestId: string, body: unknown): Promise<T> {
  return req<T>({ method: 'PATCH', path: variantBarcodePath(productId, variantId, barcodeId), requestId, body });
}
export function normalizeVariantQuantity<T>(productId: string, variantId: string, requestId: string, body: unknown): Promise<T> {
  return req<T>({ method: 'POST', path: `${variantPath(productId, variantId)}/normalize-quantity`, requestId, body });
}
export function importProductUnits<T>(requestId: string, body: unknown, key?: string): Promise<T> {
  return req<T>({ method: 'POST', path: '/api/product-units/import', requestId, body, idempotencyKey: mutationKey(key, 'product-units-import') });
}

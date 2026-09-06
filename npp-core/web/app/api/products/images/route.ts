import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { isValidIdempotencyKey, normalizeIdempotencyKey } from '@npp/contracts';
import { requireNppWorkforceSessionToken } from '../../../../lib/internal-auth-client';

export const dynamic = 'force-dynamic';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const PRODUCT_IMAGE_CONTENT_TYPE = 'image/webp';

type CoreEnvelope<T> = {
  data?: T;
  error?: { code?: string; message?: string; retryable?: boolean; details?: unknown };
  requestId?: string;
};

function requestId(request: NextRequest) {
  const candidate = String(request.headers.get('x-request-id') ?? '').trim();
  return REQUEST_ID_PATTERN.test(candidate) ? candidate : `web_${randomUUID()}`;
}

function coreBaseUrl() {
  const raw = process.env.CORE_API_INTERNAL_URL?.trim();
  if (!raw) throw new Error('PRODUCT_IMAGE_GATEWAY_NOT_CONFIGURED');
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')) {
    throw new Error('PRODUCT_IMAGE_GATEWAY_NOT_CONFIGURED');
  }
  return url.toString().replace(/\/$/, '');
}

function safeKey(request: NextRequest) {
  const raw = request.headers.get('idempotency-key');
  if (!raw) return null;
  try {
    const normalized = normalizeIdempotencyKey(raw);
    return normalized && isValidIdempotencyKey(normalized) ? normalized : null;
  } catch {
    return null;
  }
}

function responseHeaders(id: string) {
  return { 'Cache-Control': 'no-store', 'x-request-id': id };
}

function jsonError(id: string, status: number, code: string, message: string, retryable = false) {
  return NextResponse.json(
    { error: { code, message, retryable }, requestId: id },
    { status, headers: responseHeaders(id) },
  );
}

async function proxy<T>(request: NextRequest, id: string, method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown, requireKey = false) {
  const key = safeKey(request);
  if (requireKey && !key) {
    return jsonError(id, 400, 'INVALID_IDEMPOTENCY_KEY', 'Khóa chống xử lý trùng không hợp lệ');
  }
  try {
    const response = await fetch(`${coreBaseUrl()}${path}`, {
      method,
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${requireNppWorkforceSessionToken()}`,
        Accept: 'application/json',
        'x-request-id': id,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = await response.json().catch(() => null) as CoreEnvelope<T> | null;
    if (!payload) {
      return jsonError(id, 502, 'PRODUCT_IMAGE_GATEWAY_RESPONSE_INVALID', 'Phản hồi ảnh sản phẩm không hợp lệ', true);
    }
    return NextResponse.json(payload, { status: response.status, headers: responseHeaders(id) });
  } catch {
    return jsonError(id, 503, 'PRODUCT_IMAGE_GATEWAY_UNAVAILABLE', 'Kho ảnh sản phẩm tạm thời chưa sẵn sàng', true);
  }
}

async function proxyImageUpload<T>(request: NextRequest, id: string, productId: string, bytes: ArrayBuffer) {
  const key = safeKey(request);
  if (!key) {
    return jsonError(id, 400, 'INVALID_IDEMPOTENCY_KEY', 'Khóa chống xử lý trùng không hợp lệ');
  }
  try {
    const response = await fetch(`${coreBaseUrl()}/api/products/${productId}/image/upload`, {
      method: 'PUT',
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${requireNppWorkforceSessionToken()}`,
        Accept: 'application/json',
        'Content-Type': PRODUCT_IMAGE_CONTENT_TYPE,
        'Idempotency-Key': key,
        'x-request-id': id,
      },
      body: bytes,
    });
    const payload = await response.json().catch(() => null) as CoreEnvelope<T> | null;
    if (!payload) {
      return jsonError(id, 502, 'PRODUCT_IMAGE_GATEWAY_RESPONSE_INVALID', 'Phản hồi ảnh sản phẩm không hợp lệ', true);
    }
    return NextResponse.json(payload, { status: response.status, headers: responseHeaders(id) });
  } catch {
    return jsonError(id, 503, 'PRODUCT_IMAGE_GATEWAY_UNAVAILABLE', 'Kho ảnh sản phẩm tạm thời chưa sẵn sàng', true);
  }
}

export async function GET(request: NextRequest) {
  const id = requestId(request);
  return proxy(request, id, 'GET', '/api/products/images');
}

export async function PUT(request: NextRequest) {
  const id = requestId(request);
  const productId = String(request.nextUrl.searchParams.get('productId') ?? '').trim();
  if (!UUID_PATTERN.test(productId)) {
    return jsonError(id, 400, 'INVALID_PRODUCT_IMAGE_REQUEST', 'Sản phẩm không hợp lệ');
  }
  const contentType = String(request.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
  if (contentType !== PRODUCT_IMAGE_CONTENT_TYPE) {
    return jsonError(id, 400, 'INVALID_PRODUCT_IMAGE_TYPE', 'Ảnh sản phẩm phải được chuyển sang WebP trước khi tải lên');
  }
  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > PRODUCT_IMAGE_MAX_BYTES) {
    return jsonError(id, 413, 'INVALID_PRODUCT_IMAGE_SIZE', 'Dung lượng ảnh sản phẩm vượt giới hạn');
  }
  let bytes: ArrayBuffer;
  try {
    bytes = await request.arrayBuffer();
  } catch {
    return jsonError(id, 400, 'INVALID_PRODUCT_IMAGE_REQUEST', 'Không đọc được dữ liệu ảnh sản phẩm');
  }
  if (bytes.byteLength < 1 || bytes.byteLength > PRODUCT_IMAGE_MAX_BYTES) {
    return jsonError(id, bytes.byteLength > PRODUCT_IMAGE_MAX_BYTES ? 413 : 400, 'INVALID_PRODUCT_IMAGE_SIZE', 'Dung lượng ảnh sản phẩm không hợp lệ');
  }
  return proxyImageUpload(request, id, productId, bytes);
}

export async function POST(request: NextRequest) {
  const id = requestId(request);
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return jsonError(id, 400, 'INVALID_JSON_BODY', 'Dữ liệu ảnh không hợp lệ');
  }
  const action = String(body.action ?? '');
  const productId = String(body.productId ?? '');
  if (!UUID_PATTERN.test(productId) || !['prepare', 'commit'].includes(action)) {
    return jsonError(id, 400, 'INVALID_PRODUCT_IMAGE_REQUEST', 'Yêu cầu ảnh sản phẩm không hợp lệ');
  }
  if (action === 'prepare') {
    return proxy(request, id, 'POST', `/api/products/${productId}/image/prepare`, {
      mimeType: body.mimeType,
      byteSize: body.byteSize,
    });
  }
  return proxy(request, id, 'POST', `/api/products/${productId}/image/commit`, {
    expectedByteSize: body.expectedByteSize,
  }, true);
}

export async function DELETE(request: NextRequest) {
  const id = requestId(request);
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    body = {};
  }
  const productId = String(body.productId ?? '');
  if (!UUID_PATTERN.test(productId)) {
    return jsonError(id, 400, 'INVALID_PRODUCT_IMAGE_REQUEST', 'Sản phẩm không hợp lệ');
  }
  return proxy(request, id, 'DELETE', `/api/products/${productId}/image`, undefined, true);
}

import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { isValidIdempotencyKey, normalizeIdempotencyKey } from '@npp/contracts';
import { requireNppWorkforceSessionToken } from '../../../../lib/internal-auth-client';

export const dynamic = 'force-dynamic';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

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
  const normalized = normalizeIdempotencyKey(raw);
  return normalized && isValidIdempotencyKey(normalized) ? normalized : null;
}

function responseHeaders(id: string) {
  return { 'Cache-Control': 'no-store', 'x-request-id': id };
}

async function proxy<T>(request: NextRequest, id: string, method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown, requireKey = false) {
  const key = safeKey(request);
  if (requireKey && !key) {
    return NextResponse.json(
      { error: { code: 'INVALID_IDEMPOTENCY_KEY', message: 'Khóa chống xử lý trùng không hợp lệ', retryable: false }, requestId: id },
      { status: 400, headers: responseHeaders(id) },
    );
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
      return NextResponse.json(
        { error: { code: 'PRODUCT_IMAGE_GATEWAY_RESPONSE_INVALID', message: 'Phản hồi ảnh sản phẩm không hợp lệ', retryable: true }, requestId: id },
        { status: 502, headers: responseHeaders(id) },
      );
    }
    return NextResponse.json(payload, { status: response.status, headers: responseHeaders(id) });
  } catch {
    return NextResponse.json(
      { error: { code: 'PRODUCT_IMAGE_GATEWAY_UNAVAILABLE', message: 'Kho ảnh sản phẩm tạm thời chưa sẵn sàng', retryable: true }, requestId: id },
      { status: 503, headers: responseHeaders(id) },
    );
  }
}

export async function GET(request: NextRequest) {
  const id = requestId(request);
  return proxy(request, id, 'GET', '/api/products/images');
}

export async function POST(request: NextRequest) {
  const id = requestId(request);
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: { code: 'INVALID_JSON_BODY', message: 'Dữ liệu ảnh không hợp lệ', retryable: false }, requestId: id },
      { status: 400, headers: responseHeaders(id) },
    );
  }
  const action = String(body.action ?? '');
  const productId = String(body.productId ?? '');
  if (!UUID_PATTERN.test(productId) || !['prepare', 'commit'].includes(action)) {
    return NextResponse.json(
      { error: { code: 'INVALID_PRODUCT_IMAGE_REQUEST', message: 'Yêu cầu ảnh sản phẩm không hợp lệ', retryable: false }, requestId: id },
      { status: 400, headers: responseHeaders(id) },
    );
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
    return NextResponse.json(
      { error: { code: 'INVALID_PRODUCT_IMAGE_REQUEST', message: 'Sản phẩm không hợp lệ', retryable: false }, requestId: id },
      { status: 400, headers: responseHeaders(id) },
    );
  }
  return proxy(request, id, 'DELETE', `/api/products/${productId}/image`, undefined, true);
}

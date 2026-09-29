import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { isValidIdempotencyKey, normalizeIdempotencyKey } from '@npp/contracts';
import { requireNppWorkforceSessionToken } from '../../../../lib/internal-auth-client';

export const dynamic = 'force-dynamic';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function requestId(request: NextRequest) {
  const candidate = String(request.headers.get('x-request-id') ?? '').trim();
  return REQUEST_ID_PATTERN.test(candidate) ? candidate : `web_${randomUUID()}`;
}

function coreBaseUrl() {
  const raw = process.env.CORE_API_INTERNAL_URL?.trim();
  if (!raw) throw new Error('HOME_CONTENT_GATEWAY_NOT_CONFIGURED');
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')) {
    throw new Error('HOME_CONTENT_GATEWAY_NOT_CONFIGURED');
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

async function proxy(request: NextRequest, method: 'GET' | 'PATCH', body?: unknown) {
  const id = requestId(request);
  const key = safeKey(request);
  if (method === 'PATCH' && !key) {
    return NextResponse.json({ error: { code: 'INVALID_IDEMPOTENCY_KEY', message: 'Mã nhận diện yêu cầu không hợp lệ.' } }, { status: 400, headers: responseHeaders(id) });
  }
  try {
    const response = await fetch(`${coreBaseUrl()}/api/customer-ordering-home-content`, {
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
    const payload = await response.json().catch(() => null);
    if (!payload) return NextResponse.json({ error: { code: 'HOME_CONTENT_GATEWAY_INVALID', message: 'Phản hồi không hợp lệ.' } }, { status: 502, headers: responseHeaders(id) });
    return NextResponse.json(payload, { status: response.status, headers: responseHeaders(id) });
  } catch {
    return NextResponse.json({ error: { code: 'HOME_CONTENT_GATEWAY_UNAVAILABLE', message: 'Nội dung đặt hàng tạm thời chưa sẵn sàng.' } }, { status: 503, headers: responseHeaders(id) });
  }
}

export async function GET(request: NextRequest) {
  return proxy(request, 'GET');
}

export async function PATCH(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  return proxy(request, 'PATCH', body);
}

export async function PUT(request: NextRequest) {
  const id = requestId(request);
  const key = safeKey(request);
  if (!key) {
    return NextResponse.json({ error: { code: 'INVALID_IDEMPOTENCY_KEY', message: 'Mã nhận diện yêu cầu không hợp lệ.' } }, { status: 400, headers: responseHeaders(id) });
  }
  const contentType = String(request.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'image/webp') {
    return NextResponse.json({ error: { code: 'INVALID_BANNER_IMAGE_TYPE', message: 'Ảnh banner phải là WebP.' } }, { status: 400, headers: responseHeaders(id) });
  }
  let bytes: ArrayBuffer;
  try {
    bytes = await request.arrayBuffer();
  } catch {
    return NextResponse.json({ error: { code: 'INVALID_BANNER_IMAGE_REQUEST', message: 'Không đọc được ảnh banner.' } }, { status: 400, headers: responseHeaders(id) });
  }
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: { code: 'INVALID_BANNER_IMAGE_SIZE', message: 'Dung lượng ảnh banner không hợp lệ.' } }, { status: bytes.byteLength > MAX_IMAGE_BYTES ? 413 : 400, headers: responseHeaders(id) });
  }
  try {
    const response = await fetch(`${coreBaseUrl()}/api/customer-ordering-home-content/banner`, {
      method: 'PUT',
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${requireNppWorkforceSessionToken()}`,
        Accept: 'application/json',
        'Content-Type': 'image/webp',
        'Idempotency-Key': key,
        'x-request-id': id,
      },
      body: bytes,
    });
    const payload = await response.json().catch(() => null);
    if (!payload) return NextResponse.json({ error: { code: 'HOME_CONTENT_GATEWAY_INVALID', message: 'Phản hồi không hợp lệ.' } }, { status: 502, headers: responseHeaders(id) });
    return NextResponse.json(payload, { status: response.status, headers: responseHeaders(id) });
  } catch {
    return NextResponse.json({ error: { code: 'HOME_CONTENT_GATEWAY_UNAVAILABLE', message: 'Không tải được ảnh banner.' } }, { status: 503, headers: responseHeaders(id) });
  }
}

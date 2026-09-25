import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { isValidIdempotencyKey, normalizeIdempotencyKey } from '@npp/contracts';
import { requireNppWorkforceSessionToken } from '../../../../../lib/internal-auth-client';

export const dynamic = 'force-dynamic';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

type CoreEnvelope<T> = {
  data?: T;
  error?: { code?: string; message?: string; retryable?: boolean; details?: unknown };
  requestId?: string;
};

function requestId(request: NextRequest) {
  const candidate = String(request.headers.get('x-request-id') ?? '').trim();
  return REQUEST_ID_PATTERN.test(candidate) ? candidate : `web_${randomUUID()}`;
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

function coreBaseUrl() {
  const raw = process.env.CORE_API_INTERNAL_URL?.trim();
  if (!raw) throw new Error('WORKFORCE_LEAVE_ATTACHMENT_GATEWAY_NOT_CONFIGURED');
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)
    || url.username
    || url.password
    || (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')) {
    throw new Error('WORKFORCE_LEAVE_ATTACHMENT_GATEWAY_NOT_CONFIGURED');
  }
  return url.toString().replace(/\/$/, '');
}

function idempotencyKey(request: NextRequest) {
  const raw = request.headers.get('idempotency-key');
  if (!raw) return null;
  try {
    const normalized = normalizeIdempotencyKey(raw);
    return normalized && isValidIdempotencyKey(normalized) ? normalized : null;
  } catch {
    return null;
  }
}

export async function PUT(request: NextRequest) {
  const id = requestId(request);
  const key = idempotencyKey(request);
  if (!key) return jsonError(id, 400, 'INVALID_IDEMPOTENCY_KEY', 'Khóa chống xử lý trùng không hợp lệ');

  const contentType = String(request.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
  if (!ALLOWED_TYPES.has(contentType)) {
    return jsonError(id, 400, 'INVALID_LEAVE_ATTACHMENT_TYPE', 'Chứng từ chỉ nhận JPG, PNG, WebP hoặc PDF');
  }
  const fileName = String(request.headers.get('x-file-name') ?? '').trim();
  if (!fileName || fileName.length > 600) {
    return jsonError(id, 400, 'INVALID_LEAVE_ATTACHMENT_NAME', 'Tên chứng từ nghỉ không hợp lệ');
  }
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    return jsonError(id, 413, 'INVALID_LEAVE_ATTACHMENT_SIZE', 'Dung lượng chứng từ nghỉ vượt giới hạn 10 MB');
  }

  let bytes: ArrayBuffer;
  try {
    bytes = await request.arrayBuffer();
  } catch {
    return jsonError(id, 400, 'INVALID_LEAVE_ATTACHMENT', 'Không đọc được chứng từ nghỉ');
  }
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_BYTES) {
    return jsonError(
      id,
      bytes.byteLength > MAX_BYTES ? 413 : 400,
      'INVALID_LEAVE_ATTACHMENT_SIZE',
      'Dung lượng chứng từ nghỉ không hợp lệ',
    );
  }

  try {
    const response = await fetch(`${coreBaseUrl()}/api/workforce/leave/attachments`, {
      method: 'PUT',
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${requireNppWorkforceSessionToken()}`,
        Accept: 'application/json',
        'Content-Type': contentType,
        'Content-Length': String(bytes.byteLength),
        'Idempotency-Key': key,
        'x-file-name': fileName,
        'x-request-id': id,
      },
      body: bytes,
    });
    const payload = await response.json().catch(() => null) as CoreEnvelope<unknown> | null;
    if (!payload) {
      return jsonError(id, 502, 'WORKFORCE_LEAVE_ATTACHMENT_RESPONSE_INVALID', 'Phản hồi kho chứng từ không hợp lệ', true);
    }
    return NextResponse.json(payload, { status: response.status, headers: responseHeaders(id) });
  } catch {
    return jsonError(id, 503, 'WORKFORCE_LEAVE_ATTACHMENT_UNAVAILABLE', 'Kho chứng từ nghỉ tạm thời chưa sẵn sàng', true);
  }
}

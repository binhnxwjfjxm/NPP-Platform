import { isValidIdempotencyKey, normalizeIdempotencyKey } from '@npp/contracts';
import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { nppCoreBaseUrl, requireNppWorkforceSessionToken } from '../../../../../../lib/internal-auth-client';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type CoreEnvelope = {
  data?: unknown;
  error?: { code?: string; message?: string; retryable?: boolean; details?: unknown };
  requestId?: string;
};

type RouteContext = Readonly<{ params: Readonly<{ id: string }> }>;

function responseHeaders(requestId: string) {
  return { 'Cache-Control': 'no-store', 'x-request-id': requestId };
}

function errorResponse(requestId: string, status: number, code: string, message: string, retryable = false) {
  return NextResponse.json(
    { error: { code, message, retryable }, requestId },
    { status, headers: responseHeaders(requestId) },
  );
}

export async function PUT(request: NextRequest, { params }: RouteContext) {
  const requestId = request.headers.get('x-request-id')?.trim() || `web_user_scopes_${randomUUID()}`;
  const userId = String(params.id || '').trim();
  if (!UUID_PATTERN.test(userId)) {
    return errorResponse(requestId, 400, 'INVALID_USER_ID', 'Mã người dùng không hợp lệ');
  }

  const idempotencyKey = normalizeIdempotencyKey(request.headers.get('idempotency-key') ?? undefined);
  if (!idempotencyKey || !isValidIdempotencyKey(idempotencyKey)) {
    return errorResponse(requestId, 400, 'INVALID_IDEMPOTENCY_KEY', 'Khóa chống trùng yêu cầu không hợp lệ');
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(requestId, 400, 'INVALID_JSON_BODY', 'Nội dung yêu cầu phải là JSON hợp lệ');
  }

  let baseUrl: string;
  let token: string;
  try {
    baseUrl = nppCoreBaseUrl();
    token = requireNppWorkforceSessionToken();
  } catch {
    return errorResponse(requestId, 401, 'NPP_AUTH_REQUIRED', 'Cần đăng nhập để cập nhật phạm vi người dùng');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`${baseUrl}/api/internal-auth/users/${encodeURIComponent(userId)}/scopes`, {
      method: 'PUT',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
        'x-request-id': requestId,
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null) as CoreEnvelope | null;
    if (!payload) {
      return errorResponse(requestId, 502, 'NPP_CORE_RESPONSE_INVALID', 'Phản hồi từ Hệ thống Công Ty không hợp lệ');
    }
    return NextResponse.json(payload, {
      status: response.status,
      headers: responseHeaders(payload.requestId || requestId),
    });
  } catch {
    return errorResponse(requestId, 503, 'NPP_CORE_UNAVAILABLE', 'Hệ thống Công Ty tạm thời chưa sẵn sàng', true);
  } finally {
    clearTimeout(timeout);
  }
}

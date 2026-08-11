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
  const requestId = request.headers.get('x-request-id')?.trim() || `web_user_credential_${randomUUID()}`;
  const userId = String(params.id || '').trim();
  if (!UUID_PATTERN.test(userId)) {
    return errorResponse(requestId, 400, 'INVALID_USER_ID', 'Mã người dùng không hợp lệ');
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(requestId, 400, 'INVALID_JSON_BODY', 'Nội dung yêu cầu phải là JSON hợp lệ');
  }

  const password = typeof (body as { password?: unknown })?.password === 'string'
    ? (body as { password: string }).password
    : '';
  if (!password) {
    return errorResponse(requestId, 400, 'INTERNAL_AUTH_PASSWORD_INVALID', 'Mật khẩu là bắt buộc');
  }

  let baseUrl: string;
  let token: string;
  try {
    baseUrl = nppCoreBaseUrl();
    token = requireNppWorkforceSessionToken();
  } catch {
    return errorResponse(requestId, 401, 'NPP_AUTH_REQUIRED', 'Cần đăng nhập để cập nhật mật khẩu');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`${baseUrl}/api/internal-auth/users/${encodeURIComponent(userId)}/credential`, {
      method: 'PUT',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'x-request-id': requestId,
      },
      body: JSON.stringify({ password }),
    });
    const payload = await response.json().catch(() => null) as CoreEnvelope | null;
    if (!payload) {
      return errorResponse(requestId, 502, 'NPP_CORE_RESPONSE_INVALID', 'Phản hồi từ NPP Core không hợp lệ');
    }
    return NextResponse.json(payload, {
      status: response.status,
      headers: responseHeaders(payload.requestId || requestId),
    });
  } catch {
    return errorResponse(requestId, 503, 'NPP_CORE_UNAVAILABLE', 'NPP Core tạm thời chưa sẵn sàng', true);
  } finally {
    clearTimeout(timeout);
  }
}

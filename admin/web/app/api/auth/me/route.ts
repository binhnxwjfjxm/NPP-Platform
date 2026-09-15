import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { readAdminSessionToken, requestInternalAuth } from '../../../../lib/internal-auth-client';

export const runtime = 'nodejs';

type CurrentSession = Readonly<{
  loginName?: string | null;
  employeeFullName?: string | null;
}>;

type MeData = Readonly<{ session?: CurrentSession | null }>;

function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function bearerToken(request: NextRequest): string | null {
  const header = request.headers.get('authorization')?.trim() || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() || null;
}

function cacheUserId(loginName: string | null) {
  if (!loginName) return null;
  return `admin.${createHash('sha256').update(loginName.toLowerCase()).digest('hex').slice(0, 32)}`;
}

export async function GET(request: NextRequest) {
  const token = bearerToken(request) || readAdminSessionToken();
  if (!token) {
    return noStoreJson({ error: { code: 'UNAUTHORIZED', message: 'Cần đăng nhập', retryable: false } }, 401);
  }

  const result = await requestInternalAuth<MeData>('/api/internal-auth/me', {
    method: 'GET',
    token,
  });
  if (!result.ok) {
    return noStoreJson({
      error: {
        code: result.code ?? 'ADMIN_AUTH_ME_FAILED',
        message: result.message ?? 'Không tải được tài khoản hiện tại',
        retryable: result.retryable === true,
      },
    }, result.status);
  }

  const session = result.data?.session;
  const loginName = session?.loginName?.trim() || null;
  return noStoreJson({
    data: {
      employeeFullName: session?.employeeFullName?.trim() || null,
      loginName,
      cacheUserId: cacheUserId(loginName),
    },
  });
}

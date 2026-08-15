import { NextResponse } from 'next/server';
import { readNppWorkforceSessionToken, requestNppInternalAuth } from '../../../../lib/internal-auth-client';

type CurrentSession = Readonly<{
  loginName?: string | null;
  employeeFullName?: string | null;
}>;

type MeData = Readonly<{
  roles?: string[];
  permissions?: string[];
  session?: CurrentSession | null;
}>;

function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function GET() {
  const token = readNppWorkforceSessionToken();
  if (!token) {
    return noStoreJson({ error: { code: 'UNAUTHORIZED', message: 'Cần đăng nhập', retryable: false } }, 401);
  }

  const result = await requestNppInternalAuth<MeData>('/api/internal-auth/me', {
    method: 'GET',
    token,
  });
  if (!result.ok) {
    return noStoreJson({
      error: {
        code: result.code ?? 'NPP_AUTH_ME_FAILED',
        message: result.message ?? 'Không tải được tài khoản hiện tại',
        retryable: result.retryable === true,
      },
    }, result.status);
  }

  const session = result.data?.session;
  return noStoreJson({
    data: {
      employeeFullName: session?.employeeFullName?.trim() || null,
      loginName: session?.loginName?.trim() || null,
      roles: Array.isArray(result.data?.roles) ? result.data.roles : [],
      permissions: Array.isArray(result.data?.permissions) ? result.data.permissions : [],
    },
  });
}

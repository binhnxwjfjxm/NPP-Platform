import { NextRequest, NextResponse } from 'next/server';
import {
  RETAIL_SESSION_COOKIE,
  RETAIL_SOURCE_APP,
  companyAuthentication,
  retailSessionCookieOptions,
  safeReturnTo,
} from '../../../../lib/company-gateway';

type LoginData = { token?: string; session?: { expiresAt?: string } };

function error(message: string, status: number, challengeRequired = false) {
  return NextResponse.json({ error: { message, challengeRequired } }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const returnTo = safeReturnTo(String(form.get('returnTo') ?? '/'));
  const result = await companyAuthentication<LoginData>('/api/internal-auth/login', {
    method: 'POST',
    body: {
      loginName: String(form.get('username') ?? '').trim(),
      password: String(form.get('password') ?? ''),
      ...(String(form.get('ownerCode') ?? '').trim() ? { ownerCode: String(form.get('ownerCode')).trim() } : {}),
      sourceApp: RETAIL_SOURCE_APP,
    },
  });

  if (!result.ok || !result.data?.token || !result.data.session?.expiresAt) {
    if (result.code === 'INTERNAL_AUTH_OWNER_CHALLENGE_REQUIRED') {
      return error('Công Ty đã gửi mã xác minh. Hãy nhập mã để tiếp tục.', 401, true);
    }
    if (result.code === 'INTERNAL_AUTH_OWNER_CODE_INVALID') {
      return error('Mã xác minh chưa đúng hoặc đã hết hạn.', 401, true);
    }
    if (result.status === 401) return error('Tên đăng nhập hoặc mật khẩu chưa đúng.', 401);
    return error(result.message ?? 'Hệ thống Công Ty đang tạm thời chưa sẵn sàng.', result.status || 503);
  }

  const response = NextResponse.json({ data: { redirectTo: returnTo } }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  response.cookies.set(RETAIL_SESSION_COOKIE, result.data.token, retailSessionCookieOptions(result.data.session.expiresAt));
  return response;
}

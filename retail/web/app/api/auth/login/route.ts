import { NextRequest, NextResponse } from 'next/server';
import {
  RETAIL_SESSION_COOKIE,
  RETAIL_SOURCE_APP,
  companyAuthentication,
  retailSessionCookieOptions,
  safeReturnTo,
} from '../../../../lib/company-gateway';

type LoginData = { token?: string; session?: { expiresAt?: string } };

function redirect(path: string) {
  return new NextResponse(null, { status: 303, headers: { Location: path, 'Cache-Control': 'no-store' } });
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
    const error = result.code === 'INTERNAL_AUTH_OWNER_CHALLENGE_REQUIRED'
      ? 'owner_challenge_required'
      : result.status === 401 ? 'invalid_credentials' : 'company_unavailable';
    return redirect(`/login?${new URLSearchParams({ error, ...(returnTo === '/' ? {} : { returnTo }) })}`);
  }
  const response = redirect(returnTo);
  response.cookies.set(RETAIL_SESSION_COOKIE, result.data.token, retailSessionCookieOptions(result.data.session.expiresAt));
  return response;
}

import { NextRequest, NextResponse } from 'next/server';
import { NPP_SESSION_COOKIE, nppSessionCookieOptions, safeNppReturnTo } from '../../../../lib/workforce-session';
import { NPP_INTERNAL_SOURCE_APP, requestNppInternalAuth } from '../../../../lib/internal-auth-client';

type LoginData = { token?: string; session?: { expiresAt?: string } };
function redirect(location: string) { return new NextResponse(null, { status: 303, headers: { Location: location, 'Cache-Control': 'no-store' } }); }
function loginError(returnTo: string, error: string, challenge = false) {
  const search = new URLSearchParams({ error });
  if (challenge) search.set('challenge', 'owner');
  if (returnTo !== '/') search.set('returnTo', returnTo);
  return redirect(`/login?${search.toString()}`);
}
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const username = String(form.get('username') || '').trim();
  const password = String(form.get('password') || '');
  const ownerCode = String(form.get('ownerCode') || '').trim();
  const returnTo = safeNppReturnTo(String(form.get('returnTo') || '/'));
  const result = await requestNppInternalAuth<LoginData>('/api/internal-auth/login', { method: 'POST', body: { loginName: username, password, ...(ownerCode ? { ownerCode } : {}), sourceApp: NPP_INTERNAL_SOURCE_APP } });
  if (!result.ok) {
    if (result.code === 'INTERNAL_AUTH_OWNER_CHALLENGE_REQUIRED') return loginError(returnTo, 'owner_challenge_required', true);
    if (result.code === 'INTERNAL_AUTH_OWNER_CODE_INVALID') return loginError(returnTo, 'invalid_owner_code', true);
    if (result.code === 'INTERNAL_AUTH_OWNER_CHALLENGE_UNAVAILABLE') return loginError(returnTo, 'owner_challenge_unavailable', true);
    if (result.status === 401) return loginError(returnTo, 'invalid_credentials');
    return loginError(returnTo, 'core_unavailable');
  }
  const token = result.data?.token?.trim(); const expiresAt = result.data?.session?.expiresAt;
  if (!token || !expiresAt) return loginError(returnTo, 'core_response_invalid');
  const response = redirect(returnTo);
  response.cookies.set(NPP_SESSION_COOKIE, token, nppSessionCookieOptions(expiresAt));
  return response;
}

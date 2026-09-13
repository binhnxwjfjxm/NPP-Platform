import { NextRequest, NextResponse } from 'next/server';
import { NPP_SESSION_COOKIE, nppSessionCookieOptions, safeNppReturnTo } from '../../../../lib/workforce-session';
import { NPP_INTERNAL_SOURCE_APP, requestNppInternalAuth } from '../../../../lib/internal-auth-client';

type LoginData = { token?: string; session?: { expiresAt?: string } };
type VerificationState = 'owner_code_required';
type LoginReply = Readonly<{
  ok: boolean;
  returnTo: string;
  error?: string;
  state?: VerificationState;
}>;

function redirect(location: string) {
  return new NextResponse(null, { status: 303, headers: { Location: location, 'Cache-Control': 'no-store' } });
}

function loginError(returnTo: string, error: string, state?: VerificationState) {
  const search = new URLSearchParams({ error });
  if (state) search.set('state', state);
  if (returnTo !== '/') search.set('returnTo', returnTo);
  return redirect(`/login?${search.toString()}`);
}

function wantsJson(request: NextRequest) {
  return request.headers.get('accept')?.includes('application/json') === true;
}

function jsonReply(payload: LoginReply, status: number) {
  return NextResponse.json(payload, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function loginFailure(
  request: NextRequest,
  returnTo: string,
  error: string,
  status: number,
  state?: VerificationState,
) {
  return wantsJson(request)
    ? jsonReply({ ok: false, error, state, returnTo }, status)
    : loginError(returnTo, error, state);
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const username = String(form.get('username') || '').trim();
  const password = String(form.get('password') || '');
  const ownerCode = String(form.get('ownerCode') || '').trim();
  const returnTo = safeNppReturnTo(String(form.get('returnTo') || '/'));
  const result = await requestNppInternalAuth<LoginData>('/api/internal-auth/login', {
    method: 'POST',
    body: {
      loginName: username,
      password,
      ...(ownerCode ? { ownerCode } : {}),
      sourceApp: NPP_INTERNAL_SOURCE_APP,
    },
  });

  if (!result.ok) {
    if (result.code === 'INTERNAL_AUTH_OWNER_CHALLENGE_REQUIRED') {
      return loginFailure(request, returnTo, 'owner_challenge_required', 401, 'owner_code_required');
    }
    if (result.code === 'INTERNAL_AUTH_OWNER_CODE_INVALID') {
      return loginFailure(request, returnTo, 'invalid_owner_code', 401, 'owner_code_required');
    }
    if (result.code === 'INTERNAL_AUTH_OWNER_CHALLENGE_UNAVAILABLE') {
      return loginFailure(request, returnTo, 'owner_challenge_unavailable', 503, 'owner_code_required');
    }
    if (result.status === 401) return loginFailure(request, returnTo, 'invalid_credentials', 401);
    return loginFailure(request, returnTo, 'core_unavailable', 503);
  }

  const token = result.data?.token?.trim();
  const expiresAt = result.data?.session?.expiresAt;
  if (!token || !expiresAt) return loginFailure(request, returnTo, 'core_response_invalid', 502);

  // Do not issue a browser session until the newly-created backend session can be
  // resolved through the same production /me boundary used by protected routes.
  const sessionCheck = await requestNppInternalAuth<unknown>('/api/internal-auth/me', {
    method: 'GET',
    token,
  });
  if (!sessionCheck.ok) {
    return loginFailure(
      request,
      returnTo,
      sessionCheck.status >= 500 ? 'core_unavailable' : 'core_response_invalid',
      sessionCheck.status >= 500 ? 503 : 502,
    );
  }

  const response = wantsJson(request)
    ? jsonReply({ ok: true, returnTo }, 200)
    : redirect(returnTo);
  response.cookies.set(NPP_SESSION_COOKIE, token, nppSessionCookieOptions(expiresAt));
  return response;
}

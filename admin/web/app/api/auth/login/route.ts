import { NextRequest, NextResponse } from 'next/server';
import {
  ADMIN_SESSION_COOKIE,
  adminSessionCookieOptions,
  safeAdminReturnTo,
} from '../../../../lib/admin-session';
import {
  ADMIN_INTERNAL_SOURCE_APP,
  requestInternalAuth,
} from '../../../../lib/internal-auth-client';

type LoginData = {
  token?: string;
  session?: { expiresAt?: string };
};

type VerificationState = 'owner_code_required';

function redirect(location: string): NextResponse {
  return new NextResponse(null, {
    status: 303,
    headers: {
      Location: location,
      'Cache-Control': 'no-store',
    },
  });
}

function loginError(returnTo: string, error: string, state?: VerificationState) {
  const search = new URLSearchParams({ error });
  if (state) search.set('state', state);
  if (returnTo !== '/') search.set('returnTo', returnTo);
  return redirect(`/login?${search.toString()}`);
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const username = String(form.get('username') || '').trim();
  const password = String(form.get('password') || '');
  const ownerCode = String(form.get('ownerCode') || '').trim();
  const returnTo = safeAdminReturnTo(String(form.get('returnTo') || '/'));

  const result = await requestInternalAuth<LoginData>('/api/internal-auth/login', {
    method: 'POST',
    body: {
      loginName: username,
      password,
      ...(ownerCode ? { ownerCode } : {}),
      sourceApp: ADMIN_INTERNAL_SOURCE_APP,
    },
  });

  if (!result.ok) {
    if (result.code === 'INTERNAL_AUTH_OWNER_CHALLENGE_REQUIRED') {
      return loginError(returnTo, 'owner_challenge_required', 'owner_code_required');
    }
    if (result.code === 'INTERNAL_AUTH_OWNER_CODE_INVALID') {
      return loginError(returnTo, 'invalid_owner_code', 'owner_code_required');
    }
    if (result.code === 'INTERNAL_AUTH_OWNER_CHALLENGE_UNAVAILABLE') {
      return loginError(returnTo, 'owner_challenge_unavailable', 'owner_code_required');
    }
    if (result.status === 401) return loginError(returnTo, 'invalid_credentials');
    return loginError(returnTo, 'core_unavailable');
  }

  const token = result.data?.token?.trim();
  const expiresAt = result.data?.session?.expiresAt;
  if (!token || !expiresAt) return loginError(returnTo, 'core_response_invalid');

  const response = redirect(returnTo);
  response.cookies.set(
    ADMIN_SESSION_COOKIE,
    token,
    adminSessionCookieOptions(expiresAt),
  );
  return response;
}

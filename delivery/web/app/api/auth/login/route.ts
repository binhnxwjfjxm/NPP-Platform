import { NextRequest, NextResponse } from 'next/server';
import { DELIVERY_INTERNAL_SOURCE_APP, requestDeliveryInternalAuth } from '../../../../lib/internal-auth-client';
import {
  DELIVERY_SESSION_COOKIE,
  deliverySessionCookieOptions,
  safeDeliveryReturnTo,
} from '../../../../lib/delivery-session';

type LoginData = Readonly<{
  token: string;
  session: Readonly<{ expiresAt?: string }>;
}>;

type VerificationState = 'owner_code_required';

function redirect(location: string): NextResponse {
  return new NextResponse(null, {
    status: 303,
    headers: { Location: location, 'Cache-Control': 'no-store' },
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
  const loginName = String(form.get('username') || '').trim();
  const password = String(form.get('password') || '');
  const ownerCode = String(form.get('ownerCode') || '').trim();
  const returnTo = safeDeliveryReturnTo(String(form.get('returnTo') || '/'));

  const result = await requestDeliveryInternalAuth<LoginData>('/api/internal-auth/login', {
    method: 'POST',
    body: {
      loginName,
      password,
      ...(ownerCode ? { ownerCode } : {}),
      sourceApp: DELIVERY_INTERNAL_SOURCE_APP,
    },
  });

  if (!result.ok || !result.data?.token) {
    if (result.code === 'INTERNAL_AUTH_OWNER_CHALLENGE_REQUIRED') {
      return loginError(returnTo, 'owner_challenge_required', 'owner_code_required');
    }
    if (result.code === 'INTERNAL_AUTH_OWNER_CODE_INVALID') {
      return loginError(returnTo, 'owner_code_invalid', 'owner_code_required');
    }
    if (result.code === 'INTERNAL_AUTH_OWNER_CHALLENGE_UNAVAILABLE') {
      return loginError(returnTo, 'owner_challenge_unavailable', 'owner_code_required');
    }
    if (result.status >= 500) return loginError(returnTo, 'auth_unavailable');
    if (result.ok) return loginError(returnTo, 'auth_unavailable');
    return loginError(returnTo, 'invalid_credentials');
  }

  const response = redirect(returnTo);
  response.cookies.set(
    DELIVERY_SESSION_COOKIE,
    result.data.token,
    deliverySessionCookieOptions(result.data.session?.expiresAt),
  );
  return response;
}

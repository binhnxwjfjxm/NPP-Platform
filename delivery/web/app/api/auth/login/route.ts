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

function redirect(location: string): NextResponse {
  return new NextResponse(null, {
    status: 303,
    headers: { Location: location, 'Cache-Control': 'no-store' },
  });
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
    const error = result.code === 'INTERNAL_AUTH_OWNER_CODE_INVALID'
      ? 'owner_code_invalid'
      : result.code === 'INTERNAL_AUTH_OWNER_CHALLENGE_UNAVAILABLE'
        ? 'owner_challenge_unavailable'
        : result.status >= 500
          ? 'auth_unavailable'
          : 'invalid_credentials';
    const search = new URLSearchParams({ error });
    if (returnTo !== '/') search.set('returnTo', returnTo);
    return redirect(`/login?${search.toString()}`);
  }

  const response = redirect(returnTo);
  response.cookies.set(
    DELIVERY_SESSION_COOKIE,
    result.data.token,
    deliverySessionCookieOptions(result.data.session?.expiresAt),
  );
  return response;
}

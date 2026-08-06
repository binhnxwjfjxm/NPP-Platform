import { NextRequest, NextResponse } from 'next/server';
import {
  ADMIN_SESSION_COOKIE,
  adminSessionCookieOptions,
  authenticateAdminCredentials,
  createAdminSession,
  safeAdminReturnTo,
} from '../../../../lib/admin-session';

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const username = String(form.get('username') || '').trim();
  const password = String(form.get('password') || '');
  const returnTo = safeAdminReturnTo(String(form.get('returnTo') || '/'));

  if (!authenticateAdminCredentials(username, password)) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('error', 'invalid_credentials');
    if (returnTo !== '/') loginUrl.searchParams.set('returnTo', returnTo);
    return NextResponse.redirect(loginUrl, 303);
  }

  const response = NextResponse.redirect(new URL(returnTo, request.url), 303);
  response.cookies.set(
    ADMIN_SESSION_COOKIE,
    await createAdminSession(username),
    adminSessionCookieOptions(),
  );
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

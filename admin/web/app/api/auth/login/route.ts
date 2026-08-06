import { NextRequest, NextResponse } from 'next/server';
import {
  ADMIN_SESSION_COOKIE,
  adminSessionCookieOptions,
  authenticateAdminCredentials,
  createAdminSession,
  safeAdminReturnTo,
} from '../../../../lib/admin-session';

function redirect(location: string): NextResponse {
  return new NextResponse(null, {
    status: 303,
    headers: {
      Location: location,
      'Cache-Control': 'no-store',
    },
  });
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const username = String(form.get('username') || '').trim();
  const password = String(form.get('password') || '');
  const returnTo = safeAdminReturnTo(String(form.get('returnTo') || '/'));

  if (!authenticateAdminCredentials(username, password)) {
    const search = new URLSearchParams({ error: 'invalid_credentials' });
    if (returnTo !== '/') search.set('returnTo', returnTo);
    return redirect(`/login?${search.toString()}`);
  }

  const response = redirect(returnTo);
  response.cookies.set(
    ADMIN_SESSION_COOKIE,
    await createAdminSession(username),
    adminSessionCookieOptions(),
  );
  return response;
}

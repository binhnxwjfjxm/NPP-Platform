import { NextResponse } from 'next/server';
import { ADMIN_SESSION_COOKIE } from '../../../../lib/admin-session';
import { readAdminSessionToken, requestInternalAuth } from '../../../../lib/internal-auth-client';

export async function POST() {
  const token = readAdminSessionToken();
  if (token) {
    await requestInternalAuth('/api/internal-auth/logout', {
      method: 'POST',
      token,
    });
  }

  const response = new NextResponse(null, {
    status: 303,
    headers: {
      Location: '/login',
      'Cache-Control': 'no-store',
    },
  });
  response.cookies.set(ADMIN_SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
  return response;
}

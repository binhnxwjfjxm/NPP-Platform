import { NextResponse } from 'next/server';
import { readNppWorkforceSessionToken, requestNppInternalAuth } from '../../../../lib/internal-auth-client';
import { NPP_SESSION_COOKIE } from '../../../../lib/workforce-session';

export async function POST() {
  const token = readNppWorkforceSessionToken();
  if (token) await requestNppInternalAuth('/api/internal-auth/logout', { method: 'POST', token });
  const response = new NextResponse(null, { status: 303, headers: { Location: '/login', 'Cache-Control': 'no-store' } });
  response.cookies.set(NPP_SESSION_COOKIE, '', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 0 });
  return response;
}

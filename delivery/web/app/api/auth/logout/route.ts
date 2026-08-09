import { NextRequest, NextResponse } from 'next/server';
import { readDeliverySessionToken, requestDeliveryInternalAuth } from '../../../../lib/internal-auth-client';
import { DELIVERY_SESSION_COOKIE } from '../../../../lib/delivery-session';

export async function POST(_request: NextRequest) {
  const token = readDeliverySessionToken();
  if (token) {
    await requestDeliveryInternalAuth('/api/internal-auth/logout', { method: 'POST', token });
  }
  const response = new NextResponse(null, {
    status: 303,
    headers: { Location: '/login', 'Cache-Control': 'no-store' },
  });
  response.cookies.set(DELIVERY_SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
  return response;
}

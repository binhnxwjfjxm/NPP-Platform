import { NextResponse } from 'next/server';
import { DELIVERY_SESSION_COOKIE } from '../../../../lib/delivery-session';

export async function POST() {
  const response = new NextResponse(null, {
    status: 303,
    headers: {
      Location: '/login',
      'Cache-Control': 'no-store',
    },
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

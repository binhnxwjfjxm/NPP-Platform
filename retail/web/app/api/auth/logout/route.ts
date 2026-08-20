import { NextResponse } from 'next/server';
import { RETAIL_SESSION_COOKIE, companyAuthentication } from '../../../../lib/company-gateway';

export async function POST(request: Request) {
  const token = request.headers.get('cookie')?.match(/(?:^|; )hp_npp_session=([^;]+)/)?.[1];
  if (token) await companyAuthentication('/api/internal-auth/logout', { method: 'POST', token: decodeURIComponent(token) });
  const response = new NextResponse(null, { status: 303, headers: { Location: '/login', 'Cache-Control': 'no-store' } });
  response.cookies.set(RETAIL_SESSION_COOKIE, '', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 0 });
  return response;
}

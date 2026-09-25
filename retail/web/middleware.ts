import { NextRequest, NextResponse } from 'next/server';

const RETAIL_SESSION_COOKIE = 'hp_npp_session';

const PUBLIC_PATHS = new Set(['/login', '/api/auth/login', '/api/auth/logout', '/api/health', '/api/cong-ty/health']);

function browser(request: NextRequest) {
  return (request.method === 'GET' || request.method === 'HEAD') && Boolean(request.headers.get('accept')?.includes('text/html'));
}

export function middleware(request: NextRequest) {
  if (PUBLIC_PATHS.has(request.nextUrl.pathname)) return NextResponse.next();
  const token = request.cookies.get(RETAIL_SESSION_COOKIE)?.value?.trim();
  if (token?.startsWith('nppusr.')) return NextResponse.next();
  if (browser(request)) {
    const login = request.nextUrl.clone();
    login.pathname = '/login';
    login.search = '';
    const returnTo = `${request.nextUrl.pathname}${request.nextUrl.search}`;
    if (returnTo !== '/') login.searchParams.set('returnTo', returnTo);
    return NextResponse.redirect(login);
  }
  return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Cần đăng nhập để tiếp tục', retryable: false } }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|pwa-icon-retail.png|sw.js).*)'] };

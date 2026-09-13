import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_SESSION_COOKIE, safeAdminReturnTo } from './lib/admin-session';

const SESSION_CHECK_PATH = '/api/auth/me';
const PUBLIC_PATHS = new Set(['/login', '/api/auth/login', '/api/auth/logout', SESSION_CHECK_PATH]);

function deny(request: NextRequest, status: 401 | 503, code: string, message: string) {
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  return request.nextUrl.pathname.startsWith('/api/')
    ? NextResponse.json({ error: { code, message, retryable: status === 503 } }, { status, headers })
    : new NextResponse(message, { status, headers });
}

function isBrowserNavigation(request: NextRequest): boolean {
  return (request.method === 'GET' || request.method === 'HEAD')
    && Boolean(request.headers.get('accept')?.includes('text/html'));
}

function loginRedirect(request: NextRequest) {
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = '/login';
  loginUrl.search = '';
  const returnTo = safeAdminReturnTo(`${request.nextUrl.pathname}${request.nextUrl.search}`);
  if (returnTo !== '/') loginUrl.searchParams.set('returnTo', returnTo);
  return NextResponse.redirect(loginUrl);
}

function clearInvalidSession(response: NextResponse) {
  response.cookies.set(ADMIN_SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
  return response;
}

function sessionCheckUrl(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.pathname = SESSION_CHECK_PATH;
  url.search = '';
  url.hash = '';
  return url;
}

async function sessionIsActive(request: NextRequest, token: string): Promise<'active' | 'invalid' | 'unavailable'> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    // Edge only talks to the same-origin Node route. That Node route owns the
    // /api/internal-auth/me VPS hop, avoiding direct Edge-to-VPS auth traffic.
    const response = await fetch(sessionCheckUrl(request), {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });
    if (response.ok) return 'active';
    if (response.status === 401 || response.status === 403) return 'invalid';
    return 'unavailable';
  } catch {
    return 'unavailable';
  } finally {
    clearTimeout(timeout);
  }
}

export async function middleware(request: NextRequest) {
  if (PUBLIC_PATHS.has(request.nextUrl.pathname)) return NextResponse.next();

  const forwardedProtocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  if (process.env.NODE_ENV === 'production' && forwardedProtocol !== 'https' && request.nextUrl.protocol !== 'https:') {
    return deny(request, 503, 'ADMIN_HTTPS_REQUIRED', 'Kết nối an toàn đang không khả dụng');
  }

  const sessionToken = request.cookies.get(ADMIN_SESSION_COOKIE)?.value?.trim();
  if (!sessionToken) {
    if (isBrowserNavigation(request)) return loginRedirect(request);
    return deny(request, 401, 'UNAUTHORIZED', 'Cần đăng nhập');
  }

  const state = await sessionIsActive(request, sessionToken);
  if (state === 'active') return NextResponse.next();
  if (state === 'invalid') {
    const response = isBrowserNavigation(request)
      ? loginRedirect(request)
      : deny(request, 401, 'UNAUTHORIZED', 'Cần đăng nhập');
    return clearInvalidSession(response);
  }
  return deny(request, 503, 'ADMIN_AUTH_UNAVAILABLE', 'Hệ thống xác thực của Công Ty tạm thời chưa sẵn sàng');
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|offline.html|icons/).*)',
  ],
};

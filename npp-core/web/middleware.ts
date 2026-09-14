import { NextRequest, NextResponse } from 'next/server';
import { NPP_SESSION_COOKIE, safeNppReturnTo } from './lib/workforce-session';

const SESSION_CHECK_PATH = '/api/auth/me';
const PUBLIC_PATHS = new Set(['/login', '/api/auth/login', '/api/auth/logout', SESSION_CHECK_PATH]);
const BACKEND_AUTHORIZED_API_PREFIXES = Object.freeze([
  '/api/sales-orders',
  '/api/customers',
  '/api/products',
  '/api/document-print-templates',
]);

function deny(request: NextRequest, status: 401 | 503, code: string, message: string) {
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  return request.nextUrl.pathname.startsWith('/api/')
    ? NextResponse.json({ error: { code, message, retryable: status === 503 } }, { status, headers })
    : new NextResponse(message, { status, headers });
}

function browser(request: NextRequest) {
  return (request.method === 'GET' || request.method === 'HEAD')
    && Boolean(request.headers.get('accept')?.includes('text/html'));
}

function loginRedirect(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  const returnTo = safeNppReturnTo(`${request.nextUrl.pathname}${request.nextUrl.search}`);
  if (returnTo !== '/') url.searchParams.set('returnTo', returnTo);
  return NextResponse.redirect(url);
}

function clearInvalidSession(response: NextResponse) {
  response.cookies.set(NPP_SESSION_COOKIE, '', {
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

function backendAuthorizesApi(pathname: string) {
  return BACKEND_AUTHORIZED_API_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

async function sessionState(request: NextRequest, token: string): Promise<'active' | 'invalid' | 'unavailable'> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    // Page navigation still uses the same-origin Node auth boundary. Business API
    // families listed above already forward this same opaque session to Công Ty,
    // where canonical authentication and authorization run before business work.
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

  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  if (
    process.env.NODE_ENV === 'production'
    && forwardedProto !== 'https'
    && request.nextUrl.protocol !== 'https:'
  ) {
    return deny(request, 503, 'NPP_HTTPS_REQUIRED', 'Hệ thống Công Ty yêu cầu kết nối HTTPS');
  }

  const token = request.cookies.get(NPP_SESSION_COOKIE)?.value?.trim();
  if (!token) {
    return browser(request)
      ? loginRedirect(request)
      : deny(request, 401, 'UNAUTHORIZED', 'Cần đăng nhập để tiếp tục');
  }

  // Do not duplicate canonical backend authentication for request-heavy business
  // APIs. A cookie is still required here; the route gateway forwards it and the
  // Công Ty backend remains deny-by-default for revoked/invalid sessions.
  if (backendAuthorizesApi(request.nextUrl.pathname)) return NextResponse.next();

  const state = await sessionState(request, token);
  if (state === 'active') return NextResponse.next();
  if (state === 'invalid') {
    return clearInvalidSession(
      browser(request)
        ? loginRedirect(request)
        : deny(request, 401, 'UNAUTHORIZED', 'Cần đăng nhập để tiếp tục'),
    );
  }
  return deny(
    request,
    503,
    'NPP_AUTH_UNAVAILABLE',
    'Hệ thống xác thực Công Ty đang tạm thời chưa sẵn sàng',
  );
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|offline.html|icons/|logo-transparent.png).*)',
  ],
};
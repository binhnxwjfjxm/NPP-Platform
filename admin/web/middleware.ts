import { NextRequest, NextResponse } from 'next/server';
import {
  ADMIN_SESSION_COOKIE,
  adminCredentialsConfigured,
  adminSessionCookieOptions,
  authenticateAdminCredentials,
  createAdminSession,
  safeAdminReturnTo,
  verifyAdminSession,
} from './lib/admin-session';

const REALM = 'Admin MCP/NPP';
const PUBLIC_PATHS = new Set(['/login', '/api/auth/login', '/api/auth/logout']);

function credentials(value: string | null): { username: string; password: string } | null {
  if (!value?.startsWith('Basic ')) return null;
  try {
    const decoded = atob(value.slice(6));
    const separator = decoded.indexOf(':');
    return separator < 0 ? null : { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
  } catch {
    return null;
  }
}

function deny(request: NextRequest, status: 401 | 503, code: string, message: string) {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    ...(status === 401 ? { 'WWW-Authenticate': `Basic realm="${REALM}", charset="UTF-8"` } : {}),
  });
  return request.nextUrl.pathname.startsWith('/api/')
    ? NextResponse.json({ error: { code, message, retryable: false } }, { status, headers })
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

export async function middleware(request: NextRequest) {
  if (PUBLIC_PATHS.has(request.nextUrl.pathname)) return NextResponse.next();
  if (!adminCredentialsConfigured()) {
    return deny(request, 503, 'ADMIN_AUTH_NOT_CONFIGURED', 'Admin access is not configured');
  }

  const forwardedProtocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  if (process.env.NODE_ENV === 'production' && forwardedProtocol !== 'https' && request.nextUrl.protocol !== 'https:') {
    return deny(request, 503, 'ADMIN_HTTPS_REQUIRED', 'Admin access requires HTTPS');
  }

  const sessionToken = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  if (await verifyAdminSession(sessionToken)) return NextResponse.next();

  const supplied = credentials(request.headers.get('authorization'));
  if (supplied && authenticateAdminCredentials(supplied.username, supplied.password)) {
    const response = NextResponse.next();
    response.cookies.set(
      ADMIN_SESSION_COOKIE,
      await createAdminSession(supplied.username.trim()),
      adminSessionCookieOptions(),
    );
    return response;
  }

  if (isBrowserNavigation(request)) return loginRedirect(request);
  return deny(request, 401, 'UNAUTHORIZED', 'Authentication required');
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|offline.html|api/pwa-icon).*)',
  ],
};

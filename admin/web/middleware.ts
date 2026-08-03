import { NextRequest, NextResponse } from 'next/server';

const REALM = 'Admin MCP/NPP';

function constantTimeEqual(left: string, right: string): boolean {
  const maxLength = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < maxLength; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function credentials(value: string | null): { username: string; password: string } | null {
  if (!value?.startsWith('Basic ')) return null;
  try {
    const decoded = atob(value.slice(6));
    const separator = decoded.indexOf(':');
    return separator < 0 ? null : { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
  } catch { return null; }
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

export function middleware(request: NextRequest) {
  const username = process.env.CORE_WEB_ADMIN_USERNAME?.trim();
  const password = process.env.CORE_WEB_ADMIN_PASSWORD;
  if (!username || !password) return deny(request, 503, 'ADMIN_AUTH_NOT_CONFIGURED', 'Admin access is not configured');
  const forwardedProtocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  if (process.env.NODE_ENV === 'production' && forwardedProtocol !== 'https' && request.nextUrl.protocol !== 'https:') {
    return deny(request, 503, 'ADMIN_HTTPS_REQUIRED', 'Admin access requires HTTPS');
  }
  const supplied = credentials(request.headers.get('authorization'));
  if (!supplied || !constantTimeEqual(supplied.username, username) || !constantTimeEqual(supplied.password, password)) {
    return deny(request, 401, 'UNAUTHORIZED', 'Authentication required');
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

import { NextRequest, NextResponse } from 'next/server';

const BASIC_REALM = 'NPP Core';

function constantTimeEqual(left: string, right: string): boolean {
  const maxLength = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < maxLength; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function parseBasicAuthorization(value: string | null): { username: string; password: string } | null {
  if (!value?.startsWith('Basic ')) return null;
  try {
    const decoded = atob(value.slice(6));
    const separator = decoded.indexOf(':');
    if (separator < 0) return null;
    return { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
  } catch {
    return null;
  }
}

function deny(request: NextRequest, status: 401 | 503, code: string, message: string) {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    ...(status === 401 ? { 'WWW-Authenticate': `Basic realm="${BASIC_REALM}", charset="UTF-8"` } : {}),
  });
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: { code, message, retryable: false } }, { status, headers });
  }
  return new NextResponse(message, { status, headers });
}

export function middleware(request: NextRequest) {
  const configuredUsername = process.env.CORE_WEB_ADMIN_USERNAME?.trim();
  const configuredPassword = process.env.CORE_WEB_ADMIN_PASSWORD;
  if (!configuredUsername || !configuredPassword) {
    return deny(request, 503, 'CORE_WEB_AUTH_NOT_CONFIGURED', 'Core web access is not configured');
  }

  const forwardedProtocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  if (process.env.NODE_ENV === 'production' && forwardedProtocol !== 'https' && request.nextUrl.protocol !== 'https:') {
    return deny(request, 503, 'CORE_WEB_HTTPS_REQUIRED', 'Core web access requires HTTPS');
  }

  const credentials = parseBasicAuthorization(request.headers.get('authorization'));
  if (!credentials
    || !constantTimeEqual(credentials.username, configuredUsername)
    || !constantTimeEqual(credentials.password, configuredPassword)) {
    return deny(request, 401, 'UNAUTHORIZED', 'Authentication required');
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/organization/:path*',
    '/customers/:path*',
    '/suppliers/:path*',
    '/products/:path*',
    '/access/:path*',
    '/api/organization/:path*',
    '/api/access/:path*',
    '/api/customers/:path*',
    '/api/customer-groups/:path*',
    '/api/suppliers/:path*',
    '/api/products/:path*',
    '/api/product-categories/:path*',
    '/api/product-brands/:path*',
  ],
};

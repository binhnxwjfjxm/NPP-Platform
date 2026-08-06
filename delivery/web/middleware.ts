import { NextRequest, NextResponse } from 'next/server';
import {
  DELIVERY_SESSION_COOKIE,
  createDeliverySession,
  deliverySessionCookieOptions,
  safeDeliveryReturnTo,
  verifyDeliverySession,
} from './lib/delivery-session';

const REALM = 'Hung Phat Delivery';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PUBLIC_PATHS = new Set(['/login', '/api/auth/login', '/api/auth/logout']);

type DeliveryCredential = Readonly<{
  username: string;
  password: string;
  employeeId: string;
}>;

function constantTimeEqual(left: string, right: string): boolean {
  const maxLength = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < maxLength; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function parseBasic(value: string | null): { username: string; password: string } | null {
  if (!value?.startsWith('Basic ')) return null;
  try {
    const decoded = atob(value.slice(6));
    const separator = decoded.indexOf(':');
    return separator < 1
      ? null
      : { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
  } catch {
    return null;
  }
}

function setupPending(): boolean {
  return String(process.env.DELIVERY_SETUP_MODE || '').trim().toLowerCase() === 'true';
}

function setupCredential(): DeliveryCredential | null {
  const username = String(process.env.DELIVERY_SETUP_USERNAME || '').trim();
  const password = String(process.env.DELIVERY_SETUP_PASSWORD || '');
  if (!/^[A-Za-z0-9._-]{2,80}$/.test(username) || password.length < 12) return null;
  return Object.freeze({ username, password, employeeId: '' });
}

function credentials(): readonly DeliveryCredential[] | null {
  if (setupPending()) {
    const setup = setupCredential();
    return setup ? Object.freeze([setup]) : null;
  }

  const raw = process.env.DELIVERY_WEB_USERS_JSON;
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 500) return null;
    const usernames = new Set<string>();
    const employees = new Set<string>();
    const entries = parsed.map((entry) => {
      if (!entry || typeof entry !== 'object') throw new Error('invalid');
      const value = entry as Record<string, unknown>;
      const username = String(value.username ?? '').trim();
      const password = String(value.password ?? '');
      const employeeId = String(value.employeeId ?? '').trim();
      if (!/^[A-Za-z0-9._-]{2,80}$/.test(username)
          || password.length < 12
          || !UUID_PATTERN.test(employeeId)
          || usernames.has(username)
          || employees.has(employeeId)) throw new Error('invalid');
      usernames.add(username);
      employees.add(employeeId);
      return Object.freeze({ username, password, employeeId });
    });
    return Object.freeze(entries);
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
  const returnTo = safeDeliveryReturnTo(`${request.nextUrl.pathname}${request.nextUrl.search}`);
  if (returnTo !== '/') loginUrl.searchParams.set('returnTo', returnTo);
  return NextResponse.redirect(loginUrl);
}

function withInternalBasicAuth(request: NextRequest, user: DeliveryCredential) {
  const headers = new Headers(request.headers);
  headers.set('authorization', `Basic ${btoa(`${user.username}:${user.password}`)}`);
  return NextResponse.next({ request: { headers } });
}

export async function middleware(request: NextRequest) {
  if (PUBLIC_PATHS.has(request.nextUrl.pathname)) return NextResponse.next();

  const users = credentials();
  if (!users || !process.env.DELIVERY_CORE_API_TOKEN?.trim()) {
    return deny(request, 503, 'DELIVERY_AUTH_NOT_CONFIGURED', 'Delivery access is not configured');
  }

  const forwardedProtocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  if (process.env.NODE_ENV === 'production' && forwardedProtocol !== 'https' && request.nextUrl.protocol !== 'https:') {
    return deny(request, 503, 'DELIVERY_HTTPS_REQUIRED', 'Delivery access requires HTTPS');
  }

  const sessionUsername = await verifyDeliverySession(request.cookies.get(DELIVERY_SESSION_COOKIE)?.value);
  const sessionUser = sessionUsername
    ? users.find((candidate) => candidate.username === sessionUsername)
    : null;
  if (sessionUser) {
    if (setupPending() && request.nextUrl.pathname !== '/') {
      return deny(request, 503, 'DELIVERY_DRIVER_SETUP_PENDING', 'Delivery driver setup is pending');
    }
    return withInternalBasicAuth(request, sessionUser);
  }

  const supplied = parseBasic(request.headers.get('authorization'));
  const user = supplied ? users.find((candidate) => candidate.username === supplied.username) : null;
  if (supplied && user && constantTimeEqual(user.password, supplied.password)) {
    if (setupPending() && request.nextUrl.pathname !== '/') {
      return deny(request, 503, 'DELIVERY_DRIVER_SETUP_PENDING', 'Delivery driver setup is pending');
    }
    const response = NextResponse.next();
    response.cookies.set(
      DELIVERY_SESSION_COOKIE,
      await createDeliverySession(user.username),
      deliverySessionCookieOptions(),
    );
    return response;
  }

  if (isBrowserNavigation(request)) return loginRedirect(request);
  return deny(request, 401, 'UNAUTHORIZED', 'Authentication required');
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|offline.html|icons/).*)'],
};

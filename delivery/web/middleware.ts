import { NextRequest, NextResponse } from 'next/server';
import { encodeDeliveryInternalAuthorization } from './lib/delivery-auth';
import { DELIVERY_CAPABILITY_HEADERS, type DeliveryCapabilities } from './lib/delivery-capabilities';
import { DELIVERY_SESSION_COOKIE, safeDeliveryReturnTo } from './lib/delivery-session';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PUBLIC_PATHS = new Set(['/login', '/api/auth/login', '/api/auth/logout']);

const CORE_PERMISSIONS = Object.freeze({
  viewTrips: 'core.delivery-trip.driver-read',
  viewCustody: 'core.cod-collection.read',
  recordCod: 'core.cod-collection.record',
  createCodHandover: 'core.cod-handover.create',
  readFulfillment: 'core.fulfillment.read',
  pickFulfillment: 'core.fulfillment.pick',
});

type MePayload = Readonly<{
  employeeId?: string;
  permissions?: readonly string[];
  scopes?: Readonly<{ warehouseIds?: readonly string[] }>;
  session?: Readonly<{ loginName?: string; employeeFullName?: string }>;
}>;

type SessionState =
  | Readonly<{
      state: 'active';
      user: { username: string; employeeId: string; displayName: string };
      capabilities: DeliveryCapabilities;
    }>
  | Readonly<{ state: 'invalid' | 'unavailable' }>;

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
  const returnTo = safeDeliveryReturnTo(`${request.nextUrl.pathname}${request.nextUrl.search}`);
  if (returnTo !== '/') loginUrl.searchParams.set('returnTo', returnTo);
  return NextResponse.redirect(loginUrl);
}

function clearInvalidSession(response: NextResponse) {
  response.cookies.set(DELIVERY_SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
  return response;
}

function coreBaseUrl(): string | null {
  const raw = process.env.CORE_API_INTERNAL_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') return null;
    url.pathname = url.pathname.replace(/\/$/, '');
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function deriveCapabilities(payload: MePayload): DeliveryCapabilities {
  const permissions = new Set(
    (Array.isArray(payload.permissions) ? payload.permissions : [])
      .filter((value): value is string => typeof value === 'string'),
  );
  const warehouseIds = Array.isArray(payload.scopes?.warehouseIds)
    ? payload.scopes.warehouseIds.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];
  return Object.freeze({
    canViewTrips: permissions.has(CORE_PERMISSIONS.viewTrips),
    canViewCustody: permissions.has(CORE_PERMISSIONS.viewCustody),
    canRecordCod: permissions.has(CORE_PERMISSIONS.recordCod),
    canCreateCodHandover: permissions.has(CORE_PERMISSIONS.createCodHandover),
    canPickWithWarehouse: permissions.has(CORE_PERMISSIONS.readFulfillment)
      && permissions.has(CORE_PERMISSIONS.pickFulfillment)
      && warehouseIds.length > 0,
  });
}

async function resolveSession(token: string): Promise<SessionState> {
  const baseUrl = coreBaseUrl();
  if (!baseUrl) return { state: 'unavailable' };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetch(`${baseUrl}/api/internal-auth/me`, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (response.status === 401 || response.status === 403) return { state: 'invalid' };
    if (!response.ok) return { state: 'unavailable' };
    const payload = await response.json().catch(() => null) as { data?: MePayload } | null;
    const employeeId = String(payload?.data?.employeeId || '').trim();
    const username = String(payload?.data?.session?.loginName || '').trim();
    const displayName = String(payload?.data?.session?.employeeFullName || '').trim();
    if (!UUID_PATTERN.test(employeeId) || !/^[A-Za-z0-9._-]{2,128}$/.test(username) || !displayName || !payload?.data) {
      return { state: 'invalid' };
    }
    return {
      state: 'active',
      user: { username, employeeId, displayName },
      capabilities: deriveCapabilities(payload.data),
    };
  } catch {
    return { state: 'unavailable' };
  } finally {
    clearTimeout(timeout);
  }
}

function applyCapabilityHeaders(headers: Headers, capabilities: DeliveryCapabilities) {
  for (const name of Object.values(DELIVERY_CAPABILITY_HEADERS)) headers.delete(name);
  headers.set(DELIVERY_CAPABILITY_HEADERS.canViewTrips, capabilities.canViewTrips ? '1' : '0');
  headers.set(DELIVERY_CAPABILITY_HEADERS.canViewCustody, capabilities.canViewCustody ? '1' : '0');
  headers.set(DELIVERY_CAPABILITY_HEADERS.canRecordCod, capabilities.canRecordCod ? '1' : '0');
  headers.set(DELIVERY_CAPABILITY_HEADERS.canCreateCodHandover, capabilities.canCreateCodHandover ? '1' : '0');
  headers.set(DELIVERY_CAPABILITY_HEADERS.canPickWithWarehouse, capabilities.canPickWithWarehouse ? '1' : '0');
}

export async function middleware(request: NextRequest) {
  if (PUBLIC_PATHS.has(request.nextUrl.pathname)) return NextResponse.next();

  const forwardedProtocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  if (process.env.NODE_ENV === 'production' && forwardedProtocol !== 'https' && request.nextUrl.protocol !== 'https:') {
    return deny(request, 503, 'DELIVERY_HTTPS_REQUIRED', 'Delivery access requires HTTPS');
  }

  const sessionToken = request.cookies.get(DELIVERY_SESSION_COOKIE)?.value?.trim();
  if (!sessionToken) {
    if (isBrowserNavigation(request)) return loginRedirect(request);
    return deny(request, 401, 'UNAUTHORIZED', 'Authentication required');
  }

  const resolved = await resolveSession(sessionToken);
  if (resolved.state === 'active') {
    const headers = new Headers(request.headers);
    headers.set('authorization', encodeDeliveryInternalAuthorization(resolved.user));
    headers.delete('x-npp-delivery-employee-id');
    applyCapabilityHeaders(headers, resolved.capabilities);
    return NextResponse.next({ request: { headers } });
  }
  if (resolved.state === 'invalid') {
    const response = isBrowserNavigation(request)
      ? loginRedirect(request)
      : deny(request, 401, 'UNAUTHORIZED', 'Authentication required');
    return clearInvalidSession(response);
  }
  return deny(request, 503, 'DELIVERY_AUTH_UNAVAILABLE', 'NPP Core authentication is temporarily unavailable');
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|offline.html|icons/|logo-transparent.png).*)'],
};

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const middleware = read('middleware.ts');
const session = read('lib/delivery-session.ts');
const auth = read('lib/delivery-auth.ts');
const authClient = read('lib/internal-auth-client.ts');
const coreApi = read('lib/core-api.ts');
const attemptApi = read('lib/attempt-api.ts');
const codApi = read('lib/cod-api.ts');
const podApi = read('lib/pod-api.ts');
const frame = read('app/DeliveryAppFrame.tsx');
const loginPage = read('app/login/page.tsx');
const loginRoute = read('app/api/auth/login/route.ts');
const authMeRoute = read('app/api/auth/me/route.ts');
const logoutRoute = read('app/api/auth/logout/route.ts');

test('Delivery PWA stores only the opaque canonical Core workforce session in an HttpOnly cookie', () => {
  assert.match(session, /DELIVERY_SESSION_COOKIE = 'hp_delivery_session'/);
  assert.match(session, /httpOnly:\s*true/);
  assert.match(session, /sameSite:\s*'lax'/);
  assert.match(session, /secure:\s*process\.env\.NODE_ENV === 'production'/);
  assert.doesNotMatch(session, /HMAC|SHA-256|DELIVERY_CORE_API_TOKEN|DELIVERY_WEB_USERS_JSON|DELIVERY_SETUP_PASSWORD/);
  assert.match(authClient, /cookies\(\)\.get\(DELIVERY_SESSION_COOKIE\)/);
  assert.match(authClient, /token\?\.startsWith\('nppusr\.'/);
});

test('Delivery middleware verifies the workforce session through the same-origin Node auth boundary', () => {
  assert.match(middleware, /const SESSION_CHECK_PATH = '\/api\/auth\/me'/);
  assert.match(middleware, /PUBLIC_PATHS = new Set\(\['\/login', '\/api\/auth\/login', '\/api\/auth\/logout', SESSION_CHECK_PATH\]\)/);
  assert.match(middleware, /fetch\(sessionCheckUrl\(request\)/);
  assert.match(middleware, /Authorization:\s*`Bearer \$\{token\}`/);
  assert.match(middleware, /encodeDeliveryInternalAuthorization/);
  assert.match(middleware, /headers\.set\('authorization'/);
  assert.match(middleware, /headers\.delete\('x-npp-delivery-employee-id'\)/);
  assert.match(middleware, /clearInvalidSession/);
  assert.doesNotMatch(middleware, /CORE_API_INTERNAL_URL/);
  assert.doesNotMatch(middleware, /fetch\(`\$\{baseUrl\}\/api\/internal-auth\/me`/);
  assert.doesNotMatch(middleware, /DELIVERY_WEB_USERS_JSON|DELIVERY_CORE_API_TOKEN|DELIVERY_SETUP_USERNAME|DELIVERY_SETUP_PASSWORD/);
  assert.match(auth, /INTERNAL_IDENTITY_VERSION = 'v2'/);
});

test('Delivery same-origin /me route forwards bearer or cookie session to Công Ty without middleware recursion', () => {
  assert.match(authMeRoute, /function bearerToken\(request: NextRequest\)/);
  assert.match(authMeRoute, /bearerToken\(request\) \|\| readDeliverySessionToken\(\)/);
  assert.match(authMeRoute, /requestDeliveryInternalAuth<CoreMe>\('\/api\/internal-auth\/me'/);
  assert.match(authMeRoute, /'Cache-Control': 'no-store'/);
  assert.match(authClient, /new Set\(\['127\.0\.0\.1', 'localhost', '::1'\]\)\.has\(url\.hostname\)/);
  assert.match(authClient, /url\.protocol !== 'https:' && !loopback/);
  assert.doesNotMatch(authClient, /NPP Core/);
});

test('Delivery login and logout use canonical Core internal-auth and retain professional branded login', () => {
  assert.match(loginRoute, /requestDeliveryInternalAuth<LoginData>\('\/api\/internal-auth\/login'/);
  assert.match(loginRoute, /sourceApp:\s*DELIVERY_INTERNAL_SOURCE_APP/);
  assert.match(loginRoute, /response\.cookies\.set/);
  assert.match(logoutRoute, /\/api\/internal-auth\/logout/);
  assert.match(logoutRoute, /maxAge:\s*0/);
  assert.match(loginPage, /Welcome to Hung Phat Operations\./);
  assert.match(loginPage, /Logo Hưng Phát Company/);
  assert.match(loginPage, /name="ownerCode"/);
  assert.match(frame, /pathname === '\/login'/);
  assert.match(frame, /action="\/api\/auth\/logout"/);
  assert.match(frame, /Mở menu tài khoản/);
  assert.match(frame, /Đăng xuất/);
});

test('Delivery Core gateways forward the employee session bearer and never the legacy service token/header', () => {
  const gateways = coreApi + attemptApi + codApi + podApi;
  assert.match(gateways, /requireDeliverySessionToken/);
  assert.match(gateways, /Authorization:\s*`Bearer \$\{requireDeliverySessionToken\(\)\}`/);
  assert.doesNotMatch(gateways, /DELIVERY_CORE_API_TOKEN|x-npp-delivery-employee-id/);
});

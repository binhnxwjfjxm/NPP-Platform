import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const middleware = read('middleware.ts');
const session = read('lib/delivery-session.ts');
const frame = read('app/DeliveryAppFrame.tsx');
const loginPage = read('app/login/page.tsx');
const loginRoute = read('app/api/auth/login/route.ts');
const logoutRoute = read('app/api/auth/logout/route.ts');

test('Delivery PWA uses a signed HttpOnly session cookie that survives reloads', () => {
  assert.match(session, /DELIVERY_SESSION_COOKIE = 'hp_delivery_session'/);
  assert.match(session, /HMAC/);
  assert.match(session, /SHA-256/);
  assert.match(session, /60 \* 60 \* 24 \* 30/);
  assert.match(session, /httpOnly:\s*true/);
  assert.match(session, /sameSite:\s*'lax'/);
  assert.match(session, /secure:\s*process\.env\.NODE_ENV === 'production'/);
  assert.match(session, /DELIVERY_CORE_API_TOKEN/);
  assert.doesNotMatch(session, /password[^\n]*payload|payload[^\n]*password/i);
});

test('Delivery browser navigation uses a first-party login page and keeps Basic Auth for deployment smoke', () => {
  assert.match(middleware, /PUBLIC_PATHS/);
  assert.match(middleware, /isBrowserNavigation/);
  assert.match(middleware, /loginRedirect/);
  assert.match(middleware, /verifyDeliverySession/);
  assert.match(middleware, /withInternalBasicAuth/);
  assert.match(middleware, /createDeliverySession/);
  assert.match(middleware, /WWW-Authenticate/);
  assert.match(loginPage, /Đăng nhập một lần/);
  assert.match(loginPage, /autoComplete="username"/);
  assert.match(loginPage, /autoComplete="current-password"/);
  assert.match(frame, /pathname === '\/login'/);
  assert.match(frame, /if \(onLogin\) return children/);
});

test('Delivery login maps credentials to the existing server-owned driver account without changing origin', () => {
  assert.match(loginRoute, /authenticateDeliveryUser/);
  assert.match(loginRoute, /deliverySetupPending/);
  assert.match(loginRoute, /createDeliverySession/);
  assert.match(loginRoute, /response\.cookies\.set/);
  assert.match(loginRoute, /Location:\s*location/);
  assert.doesNotMatch(loginRoute + logoutRoute, /new URL\([^)]*, request\.url\)/);
  assert.match(logoutRoute, /Location:\s*'\/login'/);
  assert.match(logoutRoute, /maxAge:\s*0/);
  assert.match(loginRoute + logoutRoute, /Cache-Control/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const middleware = read('middleware.ts');
const session = read('lib/admin-session.ts');
const loginPage = read('app/login/page.tsx');
const loginRoute = read('app/api/auth/login/route.ts');
const logoutRoute = read('app/api/auth/logout/route.ts');

test('Admin PWA uses a signed HttpOnly session cookie that survives reloads', () => {
  assert.match(session, /ADMIN_SESSION_COOKIE = 'hp_admin_session'/);
  assert.match(session, /HMAC/);
  assert.match(session, /SHA-256/);
  assert.match(session, /60 \* 60 \* 24 \* 30/);
  assert.match(session, /httpOnly:\s*true/);
  assert.match(session, /sameSite:\s*'lax'/);
  assert.match(session, /secure:\s*process\.env\.NODE_ENV === 'production'/);
  assert.match(session, /CORE_API_SERVER_TOKEN/);
  assert.doesNotMatch(session, /password[^\n]*payload|payload[^\n]*password/i);
});

test('Admin browser navigation redirects to a first-party login page instead of raw Basic Auth text', () => {
  assert.match(middleware, /PUBLIC_PATHS/);
  assert.match(middleware, /isBrowserNavigation/);
  assert.match(middleware, /loginRedirect/);
  assert.match(middleware, /verifyAdminSession/);
  assert.match(middleware, /createAdminSession/);
  assert.match(middleware, /WWW-Authenticate/);
  assert.match(loginPage, /Đăng nhập một lần/);
  assert.match(loginPage, /autoComplete="username"/);
  assert.match(loginPage, /autoComplete="current-password"/);
});

test('Admin login and logout endpoints only manage the signed session cookie', () => {
  assert.match(loginRoute, /authenticateAdminCredentials/);
  assert.match(loginRoute, /createAdminSession/);
  assert.match(loginRoute, /response\.cookies\.set/);
  assert.match(logoutRoute, /maxAge:\s*0/);
  assert.match(loginRoute + logoutRoute, /Cache-Control/);
});

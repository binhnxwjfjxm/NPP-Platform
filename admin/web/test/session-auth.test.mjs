import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const middleware = read('middleware.ts');
const session = read('lib/admin-session.ts');
const authClient = read('lib/internal-auth-client.ts');
const coreApi = read('lib/core-api.ts');
const shell = read('app/admin-shell.tsx');
const loginPage = read('app/login/page.tsx');
const loginRoute = read('app/api/auth/login/route.ts');
const logoutRoute = read('app/api/auth/logout/route.ts');

test('Admin PWA stores only the opaque Core employee session in an HttpOnly cookie', () => {
  assert.match(session, /ADMIN_SESSION_COOKIE = 'hp_admin_session'/);
  assert.match(session, /httpOnly:\s*true/);
  assert.match(session, /sameSite:\s*'lax'/);
  assert.match(session, /secure:\s*process\.env\.NODE_ENV === 'production'/);
  assert.doesNotMatch(session, /HMAC|CORE_API_SERVER_TOKEN|CORE_WEB_ADMIN_PASSWORD/);
  assert.match(authClient, /cookies\(\)\.get\(ADMIN_SESSION_COOKIE\)/);
  assert.match(coreApi, /Bearer \$\{employeeSessionToken\(\)\}/);
  assert.doesNotMatch(coreApi, /CORE_API_SERVER_TOKEN/);
});

test('Admin browser navigation validates the employee session through Core instead of Basic Auth', () => {
  assert.match(middleware, /PUBLIC_PATHS/);
  assert.match(middleware, /loginRedirect/);
  assert.match(middleware, /\/api\/internal-auth\/me/);
  assert.match(middleware, /ADMIN_SESSION_COOKIE/);
  assert.doesNotMatch(middlewar, /WWW-Authenticate|Basic realm|CORE_WEB_ADMIN_USERNAME|CORE_WEB_ADMIN_PASSWORD/);
  assert.match(loginPage, /tài khoản nhân viên/);
  assert.match(loginPage, /autoComplete="username"/);
  assert.match(loginPage, /autoComplete="current-password"/);
  assert.match(loginPage, /Mã xác minh đăng nhập/);
  assert.match(loginPage, /email của chính tài khoản/);
});

test('Admin login and logout proxy the canonical Core internal-auth lifecycle without exposing the token to browser JavaScript', () => {
  assert.match(loginRoute, /\/api\/internal-auth\/login/);
  assert.match(loginRoute, /ADMIN_INTERNAL_SOURCE_APP/);
  assert.match(loginRoute, /response\.cookies\.set/);
  assert.match(loginRoute, /owner_challenge_required/);
  assert.match(logoutRoute, /\/api\/internal-auth\/logout/);
  assert.match(logoutRoute, /maxAge:\s*0/);
  assert.match(loginRoute + logoutRoute, /Cache-Control/);
  assert.match(shell, /action="\/api\/auth\/logout"/);
  assert.match(shell, /Đăng xuất/);
  assert.doesNotMatch(loginRoute + logoutRoute, /CORE_API_SERVER_TOKEN|CORE_WEB_ADMIN_USERNAME|CORE_WEB_ADMIN_PASSWORD/);
});

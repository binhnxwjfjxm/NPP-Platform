import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const middleware = await readFile(new URL('../middleware.ts', import.meta.url), 'utf8');
const authMeRoute = await readFile(new URL('../app/api/auth/me/route.ts', import.meta.url), 'utf8');

test('Phase 9.7 keeps operations history behind canonical NPP workforce auth', () => {
  assert.match(middleware, /NPP_SESSION_COOKIE/);
  assert.match(middleware, /SESSION_CHECK_PATH = '\/api\/auth\/me'/);
  assert.match(middleware, /\/api\/internal-auth\/me/);
  assert.match(middleware, /loginRedirect/);
  assert.match(middleware, /NPP_AUTH_UNAVAILABLE/);
  assert.match(authMeRoute, /\/api\/internal-auth\/me/);
  assert.doesNotMatch(middleware, /CORE_API_INTERNAL_URL|CORE_WEB_ADMIN_USERNAME|CORE_WEB_ADMIN_PASSWORD|Basic realm/);
});
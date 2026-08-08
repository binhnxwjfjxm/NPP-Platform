import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const middleware = await readFile(new URL('../middleware.ts', import.meta.url), 'utf8');

test('Phase 9.7 keeps operations history behind the NPP web-auth middleware', () => {
  assert.match(middleware, /'\/operations\/:path\*'/);
  assert.match(middleware, /process\.env\.CORE_WEB_ADMIN_USERNAME/);
  assert.match(middleware, /process\.env\.CORE_WEB_ADMIN_PASSWORD/);
});

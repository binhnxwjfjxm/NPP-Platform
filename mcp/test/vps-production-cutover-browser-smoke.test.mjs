import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('Issue 958 frontend smoke behaves like a browser without weakening Retail auth', async () => {
  const [cutover, retailMiddleware] = await Promise.all([
    read('npp-core/api/scripts/vps-production-cutover-wiring-958.sh'),
    read('retail/web/middleware.ts'),
  ]);

  assert.match(retailMiddleware, /includes\('text\/html'\)/);
  assert.match(retailMiddleware, /NextResponse\.redirect\(login\)/);
  assert.match(retailMiddleware, /status: 401/);
  assert.match(cutover, /assert_html_status\(\)/);
  assert.match(cutover, /--header 'Accept: text\/html'/);
  assert.match(cutover, /assert_html_status 'https:\/\/retail\.nguyenlieuhungphat\.com\/' 200/);
  assert.doesNotMatch(cutover, /assert_status 'https:\/\/retail\.nguyenlieuhungphat\.com\/' 200/);
});

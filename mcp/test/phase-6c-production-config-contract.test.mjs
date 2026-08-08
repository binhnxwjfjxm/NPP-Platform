import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const source = (path) => readFile(new URL(path, root), 'utf8');

test('Core manual Heroku deploy validates the root start contract and portal-aware entry point', async () => {
  const [workflow, rootPackage, procfile] = await Promise.all([
    source('.github/workflows/heroku-npp-backend-manual.yml'),
    source('package.json'),
    source('Procfile'),
  ]);
  const pkg = JSON.parse(rootPackage);
  assert.equal(procfile.trim(), 'web: npm run start:core-api');
  assert.equal(pkg.scripts?.['start:core-api'], 'node npp-core/api/src/customer-portal-server.js');
  assert.match(workflow, /test "\$\(cat \.\.\/\.\.\/Procfile\)" = "web: npm run start:core-api"/);
  assert.match(workflow, /test -f src\/customer-portal-server\.js/);
  assert.match(workflow, /unexpected_core_api_start_contract/);
  assert.match(workflow, /pkg\.scripts\?\.\["start:core-api"\]/);
});

test('Core production config gate still requires the established server-owned values', async () => {
  const workflow = await source('.github/workflows/heroku-npp-backend-manual.yml');
  for (const marker of ['HEROKU_APP_NAME', 'DATABASE_URL', '/health/live', '/health/ready']) {
    assert.ok(workflow.includes(marker), `missing ${marker}`);
  }
});

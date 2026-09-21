import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('migration 145 reconciles Công Ty runtime privileges and future defaults', async () => {
  const [migration, registry, route] = await Promise.all([
    source('../../database/migrations/shared/145_company_runtime_privileges.sql'),
    source('src/migrations/index.js'),
    source('src/routes/workforce.js'),
  ]);

  assert.match(registry, /145_company_runtime_privileges/);
  assert.match(migration, /grant_company_runtime_access/);
  assert.match(migration, /npp_company_runtime/);
  for (const schema of ['shared', 'sales', 'purchasing', 'inventory', 'logistics', 'accounting', 'reporting']) {
    assert.match(migration, new RegExp(`'${schema}'`));
  }
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES/);
  assert.match(migration, /GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES/);
  assert.match(migration, /GRANT EXECUTE ON ALL FUNCTIONS/);
  assert.match(migration, /ALTER DEFAULT PRIVILEGES[\s\S]*GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES/);
  assert.match(migration, /ALTER DEFAULT PRIVILEGES[\s\S]*GRANT USAGE, SELECT, UPDATE ON SEQUENCES/);
  assert.match(migration, /ALTER DEFAULT PRIVILEGES[\s\S]*GRANT EXECUTE ON FUNCTIONS/);
  assert.doesNotMatch(migration, /mcp_runtime/);

  assert.match(route, /event: 'workforce_route_failed'/);
  assert.match(route, /errorCode: typeof error\?\.code === 'string'/);
  assert.doesNotMatch(route, /errorMessage|error\.message|stack/);
});

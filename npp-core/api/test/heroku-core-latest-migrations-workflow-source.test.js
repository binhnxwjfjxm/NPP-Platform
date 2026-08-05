import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflowUrl = new URL('../../../.github/workflows/heroku-core-latest-migrations-manual.yml', import.meta.url);

test('manual Core migration workflow validates before checkout and scopes workspace steps afterward', async () => {
  const source = await readFile(workflowUrl, 'utf8');

  assert.ok(!source.includes('defaults:\n      run:\n        working-directory: npp-core'));
  assert.match(source, /- name: Validate exact issue command[\s\S]*?- name: Checkout exact main/);
  assert.match(
    source,
    /- name: Install locked dependencies\n        working-directory: npp-core\n        run: npm --prefix \.\. ci --ignore-scripts/,
  );
  assert.match(
    source,
    /- name: Validate Core migration gate\n        working-directory: npp-core[\s\S]*?bash -n api\/scripts\/core-latest-production-gate\.sh/,
  );
  assert.match(source, /api\/test\/core-latest-production-gate-source\.test\.js/);
  assert.match(source, /api\/test\/heroku-core-latest-migrations-workflow-source\.test\.js/);
  assert.match(source, /REQUESTED_ACTION="\$action" bash npp-core\/api\/scripts\/core-latest-production-gate\.sh/);
  assert.ok(!source.includes('cd ..'));
  assert.match(source, /issues\/262\/comments/);
  assert.match(source, /persist-credentials: false/);
});

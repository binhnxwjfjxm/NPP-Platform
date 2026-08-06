import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflowUrl = new URL('../../../.github/workflows/vercel-admin-production-direct.yml', import.meta.url);

test('Admin production smoke verifies the first-party login and retained Basic Auth contract', async () => {
  const workflow = await readFile(workflowUrl, 'utf8');

  assert.match(workflow, /ADMIN_ORIGIN: https:\/\/admin\.nguyenlieuhungphat\.com/);
  assert.match(workflow, /Accept: text\/html/);
  assert.match(workflow, /Accept: application\/json/);
  assert.match(workflow, /browser_status/);
  assert.match(workflow, /browser_redirect/);
  assert.match(workflow, /\$ADMIN_ORIGIN\/login/);
  assert.match(workflow, /Đăng nhập một lần/);
  assert.match(workflow, /challenge[^\n]*401/);
  assert.match(workflow, /curl[^\n]*-u "\$auth"/);
  assert.match(workflow, /\$ADMIN_ORIGIN\/customer-onboarding/);
  assert.doesNotMatch(workflow, /"\$DEPLOYMENT_URL\/"/);
});

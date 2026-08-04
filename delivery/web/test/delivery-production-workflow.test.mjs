import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflowUrl = new URL('../../../.github/workflows/vercel-delivery-production-manual.yml', import.meta.url);
const scriptUrl = new URL('../scripts/deploy-production.sh', import.meta.url);

test('Delivery production workflow is exact-command and manual-only', async () => {
  const [workflow, script] = await Promise.all([
    readFile(workflowUrl, 'utf8'),
    readFile(scriptUrl, 'utf8'),
  ]);

  for (const marker of [
    "github.event.issue.number == 5",
    "github.event.comment.body == '/deploy-vercel-delivery-production'",
    'ref: ${{ env.DEPLOY_REF }}',
    'git rev-parse origin/main',
    'DELIVERY_PROJECT_NAME: npp-delivery',
    'DELIVERY_ROOT_DIRECTORY: delivery/web',
    'DELIVERY_DOMAIN: log.nguyenlieuhungphat.com',
  ]) {
    assert.ok(workflow.includes(marker), `workflow missing ${marker}`);
  }
  assert.doesNotMatch(workflow, /workflow_dispatch:/);

  for (const marker of [
    'DELIVERY_FRONTEND_API_TOKEN',
    'DELIVERY_FRONTEND_WAREHOUSE_IDS',
    'DELIVERY_CORE_API_TOKEN',
    'DELIVERY_WEB_USERS_JSON',
    'deploymentEnabled !== false',
    'api.vercel.com/v11/projects',
    'api.vercel.com/v10/projects/$project_id/domains',
    'vercel@latest build --prod',
    'vercel@latest deploy --prebuilt --prod',
    'Chuyến của tôi',
    '/_next/static/',
    '/health/live',
    '/health/ready',
  ]) {
    assert.ok(script.includes(marker), `script missing ${marker}`);
  }
  assert.doesNotMatch(script, /DATABASE_URL.*GITHUB_OUTPUT/);
  assert.doesNotMatch(script, /DELIVERY_CORE_API_TOKEN.*GITHUB_OUTPUT/);
});

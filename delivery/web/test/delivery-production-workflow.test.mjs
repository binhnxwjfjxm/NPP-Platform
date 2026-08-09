import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflowUrl = new URL('../../../.github/workflows/vercel-delivery-production-manual.yml', import.meta.url);
const scriptUrl = new URL('../scripts/deploy-production.sh', import.meta.url);
const packageUrl = new URL('../package.json', import.meta.url);
const rootLockUrl = new URL('../../../package-lock.json', import.meta.url);

test('Delivery production workflow stays manual-only and deploys canonical workforce-session runtime', async () => {
  const [workflow, script, deliveryPackage, rootLock] = await Promise.all([
    readFile(workflowUrl, 'utf8'),
    readFile(scriptUrl, 'utf8'),
    readFile(packageUrl, 'utf8').then(JSON.parse),
    readFile(rootLockUrl, 'utf8').then(JSON.parse),
  ]);

  for (const marker of [
    "github.event.issue.number == 5",
    "github.event.comment.body == '/deploy-vercel-delivery-production'",
    'ref: ${{ env.DEPLOY_REF }}',
    'git rev-parse origin/main',
    'VERCEL_ORG_ID: team_hBA8rX68UHC8ogvREkOyQlJ2',
    'VERCEL_PROJECT_ID: prj_aqsb62CiXpN1a1u3vU9P8SOKw2Ux',
    'DELIVERY_PROJECT_NAME: npp-delivery',
    'DELIVERY_ROOT_DIRECTORY: delivery/web',
    'DELIVERY_DOMAIN: log.nguyenlieuhungphat.com',
  ]) assert.ok(workflow.includes(marker), `workflow missing ${marker}`);

  assert.doesNotMatch(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /DELIVERY_WEB_USERS_JSON|CORE_WEB_ADMIN_USERNAME|CORE_WEB_ADMIN_PASSWORD|DELIVERY_CORE_API_TOKEN/);

  const deliveryProjectId = workflow.match(/VERCEL_PROJECT_ID:\s*(prj_[A-Za-z0-9]+)/)?.[1];
  assert.equal(deliveryProjectId, 'prj_aqsb62CiXpN1a1u3vU9P8SOKw2Ux');
  for (const forbiddenProjectId of [
    'prj_vFEAzoxesLqNJIfD8uF4q1kytpvk',
    'prj_854SWdJeDEOPezAvvTZzTaRvZUSq',
    'prj_0hp2A8WyUW4zgglShPTzL70hesVC',
    'prj_rXqH83GFDHuEGUcQrrv82JBPWnjU',
  ]) assert.notEqual(deliveryProjectId, forbiddenProjectId);

  assert.equal(rootLock.lockfileVersion, 3);
  const declared = { ...deliveryPackage.dependencies, ...deliveryPackage.devDependencies };
  for (const dependency of Object.keys(declared)) {
    assert.ok(rootLock.packages[`node_modules/${dependency}`], `root lock missing ${dependency}`);
  }

  for (const marker of [
    'CORE_API_INTERNAL_URL',
    'NEXT_PUBLIC_APP_LOGO_URL',
    'deploymentEnabled !== false',
    'api.vercel.com/v11/projects',
    'api.vercel.com/v10/projects/$project_id/domains',
    'vercel@58.0.0 build --prod',
    'vercel@58.0.0 deploy --prebuilt --prod',
    'npm ci --ignore-scripts',
    '/health/live',
    '/health/ready',
    'Welcome to Hung Phat Operations.',
    'auth_source=core-workforce-session',
    'setup_mode=false',
  ]) assert.ok(script.includes(marker), `script missing ${marker}`);

  assert.doesNotMatch(script, /DATABASE_URL|DELIVERY_FRONTEND_API_TOKEN|DELIVERY_CORE_API_TOKEN|DELIVERY_WEB_USERS_JSON|DELIVERY_SETUP_MODE|DELIVERY_SETUP_USERNAME|DELIVERY_SETUP_PASSWORD|x-npp-delivery-employee-id/);
  assert.doesNotMatch(script, /vercel@latest/);
  assert.doesNotMatch(script, /npm install/);
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflowUrl = new URL('../../../.github/workflows/vercel-delivery-production-manual.yml', import.meta.url);
const scriptUrl = new URL('../scripts/deploy-production.sh', import.meta.url);
const packageUrl = new URL('../package.json', import.meta.url);
const rootLockUrl = new URL('../../../package-lock.json', import.meta.url);

test('Delivery production workflow is exact-command and manual-only', async () => {
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
  ]) {
    assert.ok(workflow.includes(marker), `workflow missing ${marker}`);
  }
  assert.doesNotMatch(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(
    workflow,
    /defaults:\s*\n\s*run:\s*\n\s*working-directory:\s*delivery\/web/,
    'Delivery workflow must not require delivery/web before checkout',
  );
  const checkoutIndex = workflow.indexOf('- name: Checkout exact main');
  const firstWorkingDirectoryIndex = workflow.indexOf('working-directory: delivery/web');
  assert.ok(checkoutIndex >= 0, 'workflow missing checkout step');
  assert.ok(
    firstWorkingDirectoryIndex > checkoutIndex,
    'Delivery working directory must only be used after checkout',
  );
  assert.equal(
    workflow.match(/working-directory: delivery\/web/g)?.length,
    3,
    'Delivery workflow must scope the workspace to the three post-checkout run steps',
  );

  const deliveryProjectId = workflow.match(/VERCEL_PROJECT_ID:\s*(prj_[A-Za-z0-9]+)/)?.[1];
  assert.equal(deliveryProjectId, 'prj_aqsb62CiXpN1a1u3vU9P8SOKw2Ux');
  for (const forbiddenProjectId of [
    'prj_vFEAzoxesLqNJIfD8uF4q1kytpvk',
    'prj_854SWdJeDEOPezAvvTZzTaRvZUSq',
    'prj_0hp2A8WyUW4zgglShPTzL70hesVC',
    'prj_rXqH83GFDHuEGUcQrrv82JBPWnjU',
  ]) {
    assert.notEqual(deliveryProjectId, forbiddenProjectId);
  }

  assert.equal(rootLock.lockfileVersion, 3);
  const declared = { ...deliveryPackage.dependencies, ...deliveryPackage.devDependencies };
  for (const dependency of Object.keys(declared)) {
    assert.ok(rootLock.packages[`node_modules/${dependency}`], `root lock missing ${dependency}`);
  }
  assert.equal(rootLock.packages['node_modules/next'].version, '14.2.35');
  assert.equal(rootLock.packages['node_modules/react'].version, '18.3.1');
  assert.equal(rootLock.packages['node_modules/react-dom'].version, '18.3.1');

  for (const marker of [
    'DELIVERY_FRONTEND_API_TOKEN',
    'DELIVERY_FRONTEND_WAREHOUSE_IDS',
    'DELIVERY_CORE_API_TOKEN',
    'DELIVERY_WEB_USERS_JSON',
    'DELIVERY_SETUP_MODE',
    'DELIVERY_SETUP_USERNAME',
    'DELIVERY_SETUP_PASSWORD',
    'setup_mode=$setup_mode',
    'deploymentEnabled !== false',
    'api.vercel.com/v11/projects',
    'api.vercel.com/v10/projects/$project_id/domains',
    'delivery-deployment-meta.json',
    'api.vercel.com/v13/deployments/$deployment_host',
    '.meta.githubCommitSha // empty',
    'index($domain) != null',
    'smoke_url="https://$DELIVERY_DOMAIN"',
    'Delivery custom-domain auth smoke failed',
    'vercel@58.0.0 build --prod',
    'vercel@58.0.0 deploy --prebuilt --prod',
    'npm ci --ignore-scripts',
    'api/logistics/driver/trips?limit=1&offset=0',
    'x-npp-delivery-employee-id',
    '.data.driver | type == "object"',
    '.data.trips | type == "array"',
    'Không tải được chuyến',
    'Chuyến của tôi',
    'Chưa có hồ sơ tài xế đang hoạt động',
    '/_next/static/',
    '/health/live',
    '/health/ready',
  ]) {
    assert.ok(script.includes(marker), `script missing ${marker}`);
  }
  assert.doesNotMatch(script, /\.data\.items/);
  assert.doesNotMatch(script, /"\$deployment_url\/"/);
  assert.doesNotMatch(script, /no_active_driver_profile_for_delivery_bootstrap/);
  assert.doesNotMatch(script, /vercel@latest/);
  assert.doesNotMatch(script, /npm install/);
  assert.doesNotMatch(script, /DATABASE_URL.*GITHUB_OUTPUT/);
  assert.doesNotMatch(script, /DELIVERY_CORE_API_TOKEN.*GITHUB_OUTPUT/);
});

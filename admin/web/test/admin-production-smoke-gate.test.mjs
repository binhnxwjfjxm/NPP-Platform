import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflowUrl = new URL('../../../.github/workflows/vercel-admin-production-manual.yml', import.meta.url);

test('Admin production smoke separates protected deployment reachability from canonical domain behavior', async () => {
  const workflow = await readFile(workflowUrl, 'utf8');

  for (const marker of [
    "github.event.issue.number == 5",
    "github.event.comment.body == '/deploy-vercel-admin-production'",
    'VERCEL_PROJECT_ID: prj_0hp2A8WyUW4zgglShPTzL70hesVC',
    'ADMIN_ROOT_DIRECTORY: admin/web',
    'ADMIN_DOMAIN: admin.nguyenlieuhungphat.com',
    'ADMIN_ORIGIN: https://admin.nguyenlieuhungphat.com',
    'Smoke exact Admin deployment reachability',
    '200|301|302|303|307|308|401|403',
    'Smoke canonical Admin production domain',
    'grep -Fq \'Admin MCP/NPP\'',
    'grep -Fq \'Đăng nhập\'',
    'curl --fail --silent --show-error "$ADMIN_ORIGIN$asset"',
    'test "$domain_ready" = true',
    'test "$verified" = true',
    'vercel@58.0.0 build --prod',
    'vercel@58.0.0 deploy --prebuilt --prod',
  ]) assert.ok(workflow.includes(marker), `workflow missing ${marker}`);

  assert.match(workflow, /\$DEPLOYMENT_URL\/login/);
  assert.doesNotMatch(workflow, /html=.*\$DEPLOYMENT_URL\/login/);
  assert.doesNotMatch(workflow, /\$DEPLOYMENT_URL\$asset/);
  assert.doesNotMatch(workflow, /DATABASE_URL|SUPABASE_SERVICE_ROLE_KEY/);
});

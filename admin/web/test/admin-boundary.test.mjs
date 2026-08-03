import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = async (path) => readFile(new URL(path, root), 'utf8');

test('admin is a standalone manually deployed Vercel frontend', async () => {
  const [pkg, vercel, shell, core, workflow] = await Promise.all([
    read('package.json'),
    read('vercel.json'),
    read('app/admin-shell.tsx'),
    read('lib/core-api.ts'),
    read('../../.github/workflows/vercel-admin-production-manual.yml'),
  ]);
  assert.match(pkg, /admin-mcp-npp-web/);
  assert.match(vercel, /"deploymentEnabled"\s*:\s*false/);
  assert.match(shell, /Admin MCP\/NPP/);
  assert.match(shell, /office\.nguyenlieuhungphat\.com/);
  assert.match(core, /CORE_API_INTERNAL_URL/);
  assert.match(core, /CORE_API_SERVER_TOKEN/);
  assert.doesNotMatch(core, /DATABASE_URL|SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(`${shell}\n${core}`, /npp-core\/web/);

  assert.match(workflow, /\/deploy-vercel-admin-production/);
  assert.match(workflow, /ADMIN_PROJECT_NAME: admin-mcp-npp/);
  assert.match(workflow, /ADMIN_ROOT_DIRECTORY: admin\/web/);
  assert.match(workflow, /ADMIN_DOMAIN: admin\.nguyenlieuhungphat\.com/);
  assert.match(workflow, /NPP_DOMAIN: office\.nguyenlieuhungphat\.com/);
  assert.match(workflow, /MCP_DOMAIN: mcp\.nguyenlieuhungphat\.com/);
  assert.match(workflow, /WEBSITE_DOMAIN: nguyenlieuhungphat\.com/);
  assert.match(workflow, /Create or resolve Admin Vercel project/);
  assert.match(workflow, /Smoke exact Admin deployment/);
  assert.doesNotMatch(workflow, /DATABASE_URL|SUPABASE_SERVICE_ROLE_KEY/);
});

test('admin keeps overview and onboarding approval routes', async () => {
  const [overview, onboarding, actionRoute, addressRoute, middleware] = await Promise.all([
    read('app/page.tsx'),
    read('app/customer-onboarding/page.tsx'),
    read('app/api/customer-onboarding-requests/[id]/[action]/route.ts'),
    read('app/api/customers/[id]/addresses/route.ts'),
    read('middleware.ts'),
  ]);
  assert.match(overview, /Tổng hợp việc cần xử lý/);
  assert.match(onboarding, /Xử lý đề nghị mở mã khách hàng/);
  assert.match(actionRoute, /Idempotency-Key/);
  assert.match(actionRoute, /CROSS_SITE_REQUEST_REJECTED/);
  assert.match(addressRoute, /listCustomerAddresses/);
  assert.match(middleware, /CORE_WEB_ADMIN_USERNAME/);
  assert.match(middleware, /CORE_WEB_ADMIN_PASSWORD/);
});

test('NPP Operations no longer hosts a second Admin implementation', async () => {
  const [management, onboarding, middleware, domains] = await Promise.all([
    read('../../npp-core/web/app/management/page.tsx'),
    read('../../npp-core/web/app/management/customer-onboarding/page.tsx'),
    read('../../npp-core/web/middleware.ts'),
    read('../../docs/operations/frontend-domain-map.md'),
  ]);
  assert.match(management, /admin\.nguyenlieuhungphat\.com/);
  assert.match(management, /redirect\(/);
  assert.match(onboarding, /customer-onboarding/);
  assert.match(onboarding, /redirect\(/);
  assert.doesNotMatch(middleware, /'\/management\/:path\*'/);
  assert.doesNotMatch(middleware, /customer-onboarding-requests/);
  assert.match(domains, /admin\.nguyenlieuhungphat\.com/);
  assert.match(domains, /log\.nguyenlieuhungphat\.com/);
  assert.match(domains, /Chưa tạo project Delivery rỗng/);
});

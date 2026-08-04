import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = async (path) => readFile(new URL(path, root), 'utf8');

async function assertMissing(path) {
  await assert.rejects(read(path), (error) => error && error.code === 'ENOENT');
}

test('admin remains a standalone manually deployed Vercel frontend', async () => {
  const [pkg, vercel, shell, core, workflow, directWorkflow] = await Promise.all([
    read('package.json'),
    read('vercel.json'),
    read('app/admin-shell.tsx'),
    read('lib/core-api.ts'),
    read('../../.github/workflows/vercel-admin-production-manual.yml'),
    read('../../.github/workflows/vercel-admin-production-direct.yml'),
  ]);
  assert.match(pkg, /admin-mcp-npp-web/);
  assert.match(vercel, /"deploymentEnabled"\s*:\s*false/);
  assert.match(shell, /Admin MCP\/NPP/);
  assert.match(shell, /npp-platform\.vercel\.app/);
  assert.match(shell, /NPP_OPERATIONS_URL/);
  assert.match(core, /CORE_API_INTERNAL_URL/);
  assert.match(core, /CORE_API_SERVER_TOKEN/);
  assert.doesNotMatch(core, /DATABASE_URL|SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(`${shell}\n${core}`, /npp-core\/web/);

  assert.match(workflow, /\/deploy-vercel-admin-production/);
  assert.match(workflow, /ADMIN_PROJECT_NAME: admin-mcp-npp/);
  assert.match(workflow, /ADMIN_ROOT_DIRECTORY: admin\/web/);
  assert.match(workflow, /CORE_HEROKU_APP_NAME: hung-phat/);
  assert.match(workflow, /ADMIN_DOMAIN: admin\.nguyenlieuhungphat\.com/);
  assert.doesNotMatch(workflow, /DATABASE_URL|SUPABASE_SERVICE_ROLE_KEY/);

  assert.match(directWorkflow, /\/deploy-vercel-admin-production-direct/);
  assert.match(directWorkflow, /ADMIN_ORIGIN: https:\/\/admin\.nguyenlieuhungphat\.com/);
  assert.match(directWorkflow, /Smoke canonical Admin production domain/);
  assert.match(directWorkflow, /\$ADMIN_ORIGIN\/customer-onboarding/);
  assert.match(directWorkflow, /Tổng hợp và ngoại lệ cấp quản lý/);
  assert.match(directWorkflow, /Ranh giới duyệt ngoại lệ/);
  assert.doesNotMatch(directWorkflow, /-u "\$auth"[^\n]*"\$DEPLOYMENT_URL/);
});

test('admin only shows aggregate data and the management exception boundary', async () => {
  const [overview, exceptionBoundary, shell] = await Promise.all([
    read('app/page.tsx'),
    read('app/customer-onboarding/page.tsx'),
    read('app/admin-shell.tsx'),
  ]);

  assert.match(overview, /Tổng hợp và ngoại lệ cấp quản lý/);
  assert.match(overview, /Admin không tạo mã khách và không xác nhận mọi đơn hàng/);
  assert.match(overview, /Backend hiện chưa phân loại hàng đợi ngoại lệ riêng/);
  assert.match(overview, /npp-platform\.vercel\.app/);
  assert.match(exceptionBoundary, /Ranh giới duyệt ngoại lệ/);
  assert.match(exceptionBoundary, /không hiển thị các nút tạo mã/);
  assert.match(exceptionBoundary, /management\/customer-onboarding/);
  assert.doesNotMatch(exceptionBoundary, /CustomerOnboardingReview|loadPendingOnboarding|listCustomers/);
  assert.match(shell, /Ngoại lệ cấp quản lý/);

  await Promise.all([
    assertMissing('app/customer-onboarding/review.tsx'),
    assertMissing('app/customer-onboarding/review.module.css'),
    assertMissing('app/api/customer-onboarding-requests/[id]/[action]/route.ts'),
    assertMissing('app/api/customers/[id]/addresses/route.ts'),
  ]);
});

test('NPP Operations owns daily order confirmation and customer code work', async () => {
  const [management, onboarding, review, actionRoute, gateway, middleware, domains] = await Promise.all([
    read('../../npp-core/web/app/management/page.tsx'),
    read('../../npp-core/web/app/management/customer-onboarding/page.tsx'),
    read('../../npp-core/web/app/management/customer-onboarding/customer-onboarding-review.tsx'),
    read('../../npp-core/web/app/api/customer-onboarding-requests/[id]/[action]/route.ts'),
    read('../../npp-core/web/lib/customer-onboarding-gateway.ts'),
    read('../../npp-core/web/middleware.ts'),
    read('../../docs/operations/frontend-domain-map.md'),
  ]);

  assert.doesNotMatch(management, /redirect\(/);
  assert.match(management, /Công việc hằng ngày của Sales Admin/);
  assert.match(management, /Đơn chờ xác nhận hằng ngày/);
  assert.match(management, /href="\/sales\/sales-orders"/);
  assert.match(management, /Đề nghị mở hoặc liên kết mã khách/);
  assert.match(management, /href="\/management\/customer-onboarding"/);

  assert.doesNotMatch(onboarding, /redirect\(/);
  assert.match(onboarding, /CustomerOnboardingReview/);
  assert.match(onboarding, /Tạo hoặc liên kết mã khách hàng/);
  assert.match(review, /Duyệt tạo khách mới/);
  assert.match(review, /Liên kết khách đã có/);
  assert.match(review, /Idempotency-Key/);
  assert.match(actionRoute, /CROSS_SITE_REQUEST_REJECTED/);
  assert.match(actionRoute, /mutateCustomerOnboardingRequest/);
  assert.match(gateway, /CORE_API_INTERNAL_URL/);
  assert.match(gateway, /CORE_API_SERVER_TOKEN/);
  assert.doesNotMatch(gateway, /DATABASE_URL|SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(middleware, /'\/management\/:path\*'/);
  assert.match(middleware, /customer-onboarding-requests/);

  assert.match(domains, /npp-platform\.vercel\.app/);
  assert.match(domains, /Tên miền tùy chỉnh là alias/);
  assert.match(domains, /NPP Operations sở hữu công việc hằng ngày/);
  assert.match(domains, /Admin chỉ tổng hợp và duyệt ngoại lệ/);
});

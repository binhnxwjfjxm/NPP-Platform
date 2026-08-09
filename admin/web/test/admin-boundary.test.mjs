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
  assert.match(shell, /className="appMenu desktopAppMenu"/);
  assert.match(shell, /NPP Operations/);
  assert.match(core, /CORE_API_INTERNAL_URL/);
  assert.match(core, /employeeSessionToken/);
  assert.doesNotMatch(core, /CORE_API_SERVER_TOKEN|DATABASE_URL|SUPABASE_SERVICE_ROLE_KEY/);
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

test('admin exposes aggregate Control Tower and drills into NPP without duplicating CRUD', async () => {
  const [overview, controlTower, exceptionBoundary, menu, shell] = await Promise.all([
    read('app/page.tsx'),
    read('lib/control-tower.ts'),
    read('app/customer-onboarding/page.tsx'),
    read('app/menu/page.tsx'),
    read('app/admin-shell.tsx'),
  ]);

  assert.match(overview, /Tổng quan điều hành/);
  assert.match(overview, /Control Tower/);
  assert.match(overview, /Cảnh báo & drill-down/);
  assert.match(overview, /NPP_OPERATIONS_URL/);
  assert.match(overview, /accounting\/cod-reporting/);
  assert.match(overview, /inventory\/reporting/);
  assert.match(overview, /logistics\/reporting/);
  assert.match(overview, /operations\/audit-history/);
  assert.match(overview, /operations\/import-export-history/);
  assert.match(controlTower, /\/api\/reporting\/control-tower/);
  assert.doesNotMatch(overview, /applicationList|Vai trò ứng dụng/);
  assert.doesNotMatch(overview, /requestCore|SELECT\s|INSERT\s|UPDATE\s|DELETE\s/i);

  assert.match(exceptionBoundary, /Ngoại lệ cấp quản lý/);
  assert.match(exceptionBoundary, /Ranh giới duyệt ngoại lệ/);
  assert.match(exceptionBoundary, /không hiển thị tab lọc hoặc nút duyệt giả/);
  assert.doesNotMatch(exceptionBoundary, /filterBar|filterChip/);
  assert.doesNotMatch(exceptionBoundary, /Mở NPP Operations|Mở NPP/);
  assert.doesNotMatch(exceptionBoundary, /CustomerOnboardingReview|loadPendingOnboarding|listCustomers/);

  assert.match(menu, /Ứng dụng liên quan/);
  assert.match(menu, /Admin không tạo mã khách và không xác nhận mọi đơn hàng/);
  assert.match(menu, /Không lưu cache trang quản trị hoặc API/);
  assert.match(menu, /NPP_OPERATIONS_URL/);
  assert.match(shell, /className="adminBottomNav"/);
  assert.match(shell, /href="\/menu"/);
  assert.match(shell, /management/);

  await Promise.all([
    assertMissing('app/customer-onboarding/review.tsx'),
    assertMissing('app/customer-onboarding/review.module.css'),
    assertMissing('app/api/customer-onboarding-requests/[id]/[action]/route.ts'),
    assertMissing('app/api/customers/[id]/addresses/route.ts'),
  ]);
});

test('NPP Operations owns sales operations and customer code work', async () => {
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
  assert.match(management, /Điều hành bán hàng/);
  assert.match(management, /Đơn chờ xác nhận/);
  assert.match(management, /các nguồn/);
  assert.match(management, /href="\/sales\/sales-orders"/);
  assert.match(management, /Đề nghị mở hoặc liên kết mã khách/);
  assert.match(management, /href="\/management\/customer-onboarding"/);

  assert.doesNotMatch(onboarding, /redirect\(/);
  assert.match(onboarding, /CustomerOnboardingReview/);
  assert.match(onboarding, /Tạo hoặc liên kết mã khách hàng/);
  assert.match(review, /Tạo khách mới từ đăng ký/);
  assert.match(review, /Tên khách sẽ tạo/);
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

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('Customer Ordering home content có nguồn dữ liệu Công Ty và ảnh R2 dùng chung', async () => {
  const [migration, programMigration, migrationIndex, repository, service, storage] = await Promise.all([
    read('../../database/migrations/shared/161_customer_ordering_home_content.sql'),
    read('../../database/migrations/shared/162_customer_ordering_home_program_content.sql'),
    read('src/migrations/index.js'),
    read('src/db/repositories/customer-ordering-home-content.js'),
    read('src/services/customer-ordering-home-content.js'),
    read('src/storage/customer-ordering-home-banner.js'),
  ]);
  assert.match(migration, /shared\.customer_ordering_home_content/);
  assert.match(programMigration, /program_content/);
  assert.match(migrationIndex, /162_customer_ordering_home_program_content/);
  assert.match(repository, /banner_image_version/);
  assert.match(repository, /program_content/);
  assert.match(service, /sectionTitle/);
  assert.match(service, /programContent/);
  assert.match(storage, /app-customer\/home\/banner\.webp/);
  assert.match(storage, /r2PublicBaseUrl/);
});

test('Công Ty quản lý nội dung chương trình để Ordering mở popup chi tiết', async () => {
  const workspace = await read('../web/app/settings/customer-ordering-content/customer-ordering-content-workspace.tsx');
  assert.match(workspace, /Nội dung chương trình/);
  assert.match(workspace, /programContent/);
  assert.match(workspace, /maxLength={4000}/);
});

test('Công Ty quản lý tiêu đề và hiển thị, Customer Portal chỉ đọc nội dung công khai', async () => {
  const [adminRoute, portalRoute, server] = await Promise.all([
    read('src/routes/customer-ordering-home-content.js'),
    read('src/routes/customer-portal.js'),
    read('src/server.js'),
  ]);
  assert.match(adminRoute, /coreOrganizationWrite/);
  assert.match(adminRoute, /idempotency-key/);
  assert.match(adminRoute, /CUSTOMER_ORDERING_HOME_BANNER_CONTENT_TYPE/);
  assert.match(portalRoute, /\/api\/customer-portal\/home-content/);
  assert.match(server, /handleCustomerOrderingHomeContentRoutes/);
});


test('migration 161 production chạy exact-main với backup và restore rehearsal', async () => {
  const [script, workflow] = await Promise.all([
    read('scripts/vps-production-migrate-customer-ordering-home-content-161.sh'),
    read('../../.github/workflows/vps-production-migration-161-manual.yml'),
  ]);
  assert.match(workflow, /\/migrate-vps-production-161/);
  assert.match(workflow, /Verify exact origin\/main SHA/);
  assert.match(workflow, /Fresh backup, restore rehearsal, migrate production and verify/);
  assert.match(workflow, /group: vps-production-db-migration/);
  assert.match(script, /pg_dump -Fc/);
  assert.match(script, /pg_restore --exit-on-error/);
  assert.match(script, /160_retail_web_push_subscriptions/);
  assert.match(script, /customer_ordering_home_content/);
  assert.match(script, /RUNTIME_PRIVILEGES=PASS/);
  assert.match(script, /PRODUCTION_RERUN_NOOP=PASS/);
});

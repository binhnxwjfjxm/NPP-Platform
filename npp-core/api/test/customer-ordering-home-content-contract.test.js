import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('Customer Ordering home content có nguồn dữ liệu Công Ty và ảnh R2 dùng chung', async () => {
  const [migration, repository, service, storage] = await Promise.all([
    read('../../database/migrations/shared/161_customer_ordering_home_content.sql'),
    read('src/db/repositories/customer-ordering-home-content.js'),
    read('src/services/customer-ordering-home-content.js'),
    read('src/storage/customer-ordering-home-banner.js'),
  ]);
  assert.match(migration, /shared\.customer_ordering_home_content/);
  assert.match(repository, /banner_image_version/);
  assert.match(service, /sectionTitle/);
  assert.match(storage, /app-customer\/home\/banner\.webp/);
  assert.match(storage, /r2PublicBaseUrl/);
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

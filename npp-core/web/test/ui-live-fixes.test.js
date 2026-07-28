import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), 'utf8');

test('sidebar and product forms keep the live-test UI corrections', async () => {
  const [layout, fixes] = await Promise.all([
    readSource('../app/layout.tsx'),
    readSource('../app/ui-live-fixes.css'),
  ]);

  assert.match(layout, /import '\.\/ui-live-fixes\.css';/);
  assert.match(fixes, /data-collapsed='false'/);
  assert.match(fixes, /button\[aria-expanded='true'\] \+ div/);
  assert.match(fixes, /max-height: none !important/);
  assert.match(fixes, /data-testid='product-form'/);
  assert.match(fixes, /data-testid='category-form'/);
  assert.match(fixes, /data-testid='brand-form'/);
  assert.match(fixes, /variant-sku-input/);
});

test('employee initial load preserves partial results and retries only once', async () => {
  const [page, retry] = await Promise.all([
    readSource('../app/access/employees/page.tsx'),
    readSource('../app/access/employees/employee-initial-retry.tsx'),
  ]);

  assert.match(page, /Promise\.allSettled/);
  assert.match(page, /EmployeeInitialRetry enabled=\{Boolean\(initialError\)\}/);
  assert.match(retry, /sessionStorage\.getItem\(RETRY_KEY\)/);
  assert.match(retry, /router\.refresh\(\)/);
  assert.doesNotMatch(retry, /setInterval/);
});

test('customer creation includes a default address and a Vietnam province selector', async () => {
  const [page, enhanced] = await Promise.all([
    readSource('../app/customers/page.tsx'),
    readSource('../app/customers/customer-workspace-enhanced.tsx'),
  ]);

  assert.match(page, /CustomerWorkspaceEnhanced/);
  assert.match(enhanced, /customers-topbar-create-button/);
  assert.match(enhanced, /customer-province-select/);
  assert.match(enhanced, /\/api\/customers\/\$\{customer\.id\}\/addresses/);
  assert.match(enhanced, /isDefault: true/);
  assert.match(enhanced, /Thành phố Hồ Chí Minh/);
  assert.match(enhanced, /Lưu khách hàng và địa chỉ/);
});

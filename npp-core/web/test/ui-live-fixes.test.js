import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), 'utf8');

test('sidebar submenu expands by content instead of a fixed height cap', async () => {
  const shell = await readSource('../app/components/app-shell.module.css');
  assert.match(shell, /\.subnav\s*\{[\s\S]*display: none/);
  assert.match(shell, /\.subnavOpen\s*\{[\s\S]*display: grid/);
  assert.doesNotMatch(shell, /max-height:\s*260px/);
});

test('product catalog editors are real accessible modals', async () => {
  const [workspace, styles] = await Promise.all([
    readSource('../app/products/product-workspace.tsx'),
    readSource('../app/products/products.module.css'),
  ]);

  assert.match(workspace, /function CatalogModal/);
  assert.match(workspace, /event\.key === 'Escape'/);
  assert.match(workspace, /aria-modal="true"/);
  assert.match(workspace, /testId="product-form"/);
  assert.match(workspace, /testId="category-form"/);
  assert.match(workspace, /testId="brand-form"/);
  assert.match(workspace, /testId="variant-form"/);
  assert.match(workspace, /Quản lý SKU, đơn vị, quy đổi và barcode của sản phẩm\./);
  assert.match(styles, /\.modalBackdrop/);
  assert.match(styles, /\.formActions/);
});

test('employee initial load preserves partial results and retries once', async () => {
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

test('customer creation saves a default address without duplicating the customer on retry', async () => {
  const [workspace, page, layout, addressFields, addressRoute, addressData, packageJson] = await Promise.all([
    readSource('../app/customers/customer-workspace.tsx'),
    readSource('../app/customers/page.tsx'),
    readSource('../app/layout.tsx'),
    readSource('../app/customers/vietnam-administrative-fields.tsx'),
    readSource('../app/api/reference/vietnam-administrative-units/route.ts'),
    readSource('../lib/vietnam-administrative-data.ts'),
    readSource('../package.json'),
  ]);

  assert.match(workspace, /VietnamAdministrativeFields/);
  assert.doesNotMatch(workspace, /const VIETNAM_PROVINCES = \[/);
  assert.match(addressFields, /provinceCode=/);
  assert.match(addressFields, /Xã\/phường\/đặc khu/);
  assert.match(addressRoute, /listVietnamWards/);
  assert.match(addressData, /vietnam-address-database/);
  assert.equal(JSON.parse(packageJson).dependencies['vietnam-address-database'], '1.0.0');
  assert.match(workspace, /customerCreateKey = useRef/);
  assert.match(workspace, /customerAddressKey = useRef/);
  assert.match(workspace, /pendingCreatedCustomer/);
  assert.match(workspace, /`\/api\/customers\/\$\{createdCustomer\.id\}\/addresses`/);
  assert.match(workspace, /testIdPrefix="customer"/);
  assert.match(workspace, /testIdPrefix="customer-address"/);
  assert.match(addressFields, /`\$\{testIdPrefix}-province-select`/);
  assert.match(addressFields, /`\$\{testIdPrefix}-ward-select`/);
  assert.match(workspace, /Lưu khách hàng và địa chỉ/);
  assert.match(workspace, /isDefault: true/);
  assert.match(page, /import CustomerWorkspace from '\.\/customer-workspace';/);
  assert.doesNotMatch(page, /CustomerWorkspaceEnhanced/);
  assert.doesNotMatch(layout, /ui-live-fixes\.css/);
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), 'utf8');

test('sidebar submenu expands by content and exposes every P0-P4 destination', async () => {
  const [styles, shell] = await Promise.all([
    readSource('../app/components/app-shell.module.css'),
    readSource('../app/components/app-shell.tsx'),
  ]);

  assert.match(styles, /\.subnav\s*\{[\s\S]*display: none/);
  assert.match(styles, /\.subnavOpen\s*\{[\s\S]*display: grid/);
  assert.doesNotMatch(styles, /max-height:\s*260px/);

  const requiredNavigationIds = [
    'nav-dashboard',
    'nav-organization-overview',
    'nav-branches',
    'nav-warehouses',
    'nav-locations',
    'nav-customers',
    'nav-suppliers',
    'nav-products',
    'nav-pricing',
    'nav-document-numbering',
    'nav-roles',
    'nav-employees',
    'nav-users',
    'nav-inventory-balances',
    'nav-inventory-policies',
    'nav-inventory-lots',
    'nav-inventory-opening',
  ];
  for (const testId of requiredNavigationIds) {
    assert.match(shell, new RegExp(testId));
  }
  assert.match(shell, /organizationOpen && !collapsed/);
  assert.match(shell, /accessOpen && !collapsed/);
  assert.match(shell, /inventoryOpen && !collapsed/);
});

test('product catalog editors use the shared accessible React modal', async () => {
  const [workspace, modal, modalStyles] = await Promise.all([
    readSource('../app/products/product-workspace.tsx'),
    readSource('../app/components/modal.tsx'),
    readSource('../app/components/modal.module.css'),
  ]);

  assert.match(workspace, /import Modal from '\.\.\/components\/modal'/);
  assert.match(workspace, /open=\{showProductForm\}[\s\S]*?testId="product-form"/);
  assert.match(workspace, /open=\{showVariantForm\}[\s\S]*?testId="variant-form"/);
  assert.match(workspace, /open=\{showCategoryForm\}[\s\S]*?testId="category-form"/);
  assert.match(workspace, /open=\{showBrandForm\}[\s\S]*?testId="brand-form"/);
  assert.doesNotMatch(
    workspace,
    /function\s+\w*Modal\b|const\s+\w*Modal\s*=|modalBackdrop|MutationObserver|document\.(?:querySelector(?:All)?|getElementById|getElementsByClassName|getElementsByTagName)/,
  );
  assert.match(workspace, /Quản lý SKU, đơn vị, quy đổi và barcode của sản phẩm\./);
  assert.doesNotMatch(workspace, /Phase 3\.3D/);
  assert.match(modal, /event\.key === 'Escape'/);
  assert.match(modal, /aria-modal="true"/);
  assert.match(modal, /querySelectorAll<HTMLElement>\(FOCUSABLE\)/);
  assert.match(modalStyles, /\.backdrop/);
  assert.match(modalStyles, /\.footer/);
});

test('initial loads preserve partial data and retry only once', async () => {
  const [employeePage, employeeRetry, rolePage, snapshot, retry, organizationPage] = await Promise.all([
    readSource('../app/access/employees/page.tsx'),
    readSource('../app/access/employees/employee-initial-retry.tsx'),
    readSource('../app/access/roles/page.tsx'),
    readSource('../lib/organization-snapshot.ts'),
    readSource('../app/components/initial-load-retry.tsx'),
    readSource('../app/organization/page.tsx'),
  ]);

  assert.match(employeePage, /Promise\.allSettled/);
  assert.match(employeePage, /EmployeeInitialRetry enabled=\{Boolean\(initialError\)\}/);
  assert.match(employeeRetry, /sessionStorage\.getItem\(RETRY_KEY\)/);
  assert.match(employeeRetry, /router\.refresh\(\)/);
  assert.doesNotMatch(employeeRetry, /setInterval/);

  assert.match(rolePage, /Promise\.allSettled/);
  assert.match(rolePage, /InitialLoadRetry enabled=\{Boolean\(initialError\)\}/);
  assert.match(snapshot, /Promise\.allSettled/);
  assert.match(snapshot, /branchResult\.status === 'fulfilled'/);
  assert.match(snapshot, /warehouseResult\.status === 'fulfilled'/);
  assert.match(snapshot, /locationResult\.status === 'fulfilled'/);
  assert.match(organizationPage, /retryKey="organization-overview"/);
  assert.match(retry, /sessionStorage\.getItem\(storageKey\)/);
  assert.match(retry, /window\.setTimeout/);
  assert.doesNotMatch(retry, /setInterval/);
});

test('customer creation saves a default address without duplicating the customer on retry', async () => {
  const [workspace, page, layout, addressFields, addressRoute, addressData, packageJson, customerE2e] = await Promise.all([
    readSource('../app/customers/customer-workspace.tsx'),
    readSource('../app/customers/page.tsx'),
    readSource('../app/layout.tsx'),
    readSource('../app/customers/vietnam-administrative-fields.tsx'),
    readSource('../app/api/reference/vietnam-administrative-units/route.ts'),
    readSource('../lib/vietnam-administrative-data.ts'),
    readSource('../package.json'),
    readSource('../e2e/customers.spec.ts'),
  ]);

  assert.match(workspace, /VietnamAdministrativeFields/);
  assert.match(page, /listVietnamProvinces/);
  assert.match(page, /initialProvinces=\{initialProvinces\}/);
  assert.match(addressFields, /initialProvinces\?: ProvinceOption\[\]/);
  assert.match(addressFields, /initialProvinces = \[\]/);
  assert.doesNotMatch(workspace, /const VIETNAM_PROVINCES = \[/);
  assert.match(addressFields, /provinceCode=/);
  assert.match(addressFields, /Xã\/phường\/đặc khu/);
  assert.match(addressRoute, /request\.nextUrl\.searchParams\.get\('provinceCode'\)/);
  assert.match(addressRoute, /listVietnamProvinces/);
  assert.match(addressRoute, /listVietnamWards/);
  assert.match(addressData, /vietnam-address-database/);
  assert.equal(JSON.parse(packageJson).dependencies['vietnam-address-database'], '1.0.0');
  assert.match(workspace, /customerCreateKey = useRef/);
  assert.match(workspace, /customerAddressKey = useRef/);
  assert.match(workspace, /pendingCreatedCustomer/);
  assert.match(workspace, /`\/api\/customers\/\$\{createdCustomer\.id\}\/addresses`/);
  assert.match(workspace, /testIdPrefix="customer"/);
  assert.match(workspace, /testIdPrefix="customer-address"/);
  assert.match(addressFields, /`\$\{testIdPrefix\}-province-select`/);
  assert.match(addressFields, /`\$\{testIdPrefix\}-ward-select`/);
  assert.match(customerE2e, /customer-ward-select/);
  assert.match(customerE2e, /customer-address-ward-select/);
  assert.match(workspace, /event\.key !== 'Escape'/);
  assert.match(workspace, /event\.currentTarget === event\.target && busy === null/);
  assert.match(workspace, /Lưu khách hàng và địa chỉ/);
  assert.match(workspace, /isDefault: true/);
  assert.match(page, /import CustomerWorkspace from '\.\/customer-workspace';/);
  assert.doesNotMatch(page, /CustomerWorkspaceEnhanced/);
  assert.doesNotMatch(layout, /ui-live-fixes\.css/);
});

test('users remain internal identities instead of partial password accounts', async () => {
  const workspace = await readSource('../app/access/users/user-workspace.tsx');
  assert.match(workspace, /Tài khoản chưa phải thông tin đăng nhập thật/);
  assert.doesNotMatch(workspace, /type="password"/);
});
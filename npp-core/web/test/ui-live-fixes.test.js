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
  const workspace = await readSource('../app/customers/customer-workspace.tsx');

  assert.match(workspace, /const VIETNAM_PROVINCES = \[/);
  assert.match(workspace, /customerCreateKey = useRef/);
  assert.match(workspace, /customerAddressKey = useRef/);
  assert.match(workspace, /pendingCreatedCustomer/);
  assert.match(workspace, /`\/api\/customers\/\$\{createdCustomer\.id\}\/addresses`/);
  assert.match(workspace, /data-testid="customer-province-select"/);
  assert.match(workspace, /data-testid="customer-address-province-select"/);
  assert.match(workspace, /Lưu khách hàng và địa chỉ/);
  assert.match(workspace, /isDefault: true/);
});

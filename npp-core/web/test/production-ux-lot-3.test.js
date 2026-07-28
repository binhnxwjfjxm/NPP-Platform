import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), 'utf8');

test('opening balances use a CSV file workflow instead of exposing JSON inputs', async () => {
  const [boundary, page] = await Promise.all([
    readSource('../app/inventory/inventory-lot3-boundary.tsx'),
    readSource('../app/inventory/opening-balances/page.tsx'),
  ]);
  assert.match(boundary, /Tải tệp mẫu CSV/);
  assert.match(boundary, /Lưu thành CSV UTF-8/);
  assert.match(boundary, /inventory-opening-rows-input/);
  assert.match(boundary, /setAttribute\('hidden'/);
  assert.match(boundary, /Sẵn sàng kiểm tra/);
  assert.match(page, /InventoryLot3Boundary scope="opening-balances"/);
});

test('lot policy form exposes only backend-supported choices with office descriptions', async () => {
  const [boundary, page] = await Promise.all([
    readSource('../app/inventory/inventory-lot3-boundary.tsx'),
    readSource('../app/inventory/tracking-policies/page.tsx'),
  ]);
  assert.match(boundary, /Không quản lý theo lô/);
  assert.match(boundary, /Bắt buộc quản lý theo lô/);
  assert.match(boundary, /Có thể nhập hạn sử dụng/);
  assert.doesNotMatch(boundary, /FIFO|FEFO/);
  assert.match(page, /đúng khả năng backend hiện có/);
});

test('organization overview is balanced and warehouse types stay fixed', async () => {
  const [styles, boundary, overview, warehouses] = await Promise.all([
    readSource('../app/components/lot3-ui-overrides.css'),
    readSource('../app/organization/organization-lot3-boundary.tsx'),
    readSource('../app/organization/page.tsx'),
    readSource('../app/organization/warehouses/page.tsx'),
  ]);
  assert.match(styles, /grid-template-columns: repeat\(3/);
  assert.match(styles, /@media \(max-width: 760px\)/);
  assert.match(styles, /grid-template-columns: 1fr/);
  assert.match(boundary, /người dùng không thể tự tạo loại mới/);
  assert.match(boundary, /Kho tổng/);
  assert.match(boundary, /Kho hàng lỗi \/ trả lại/);
  assert.match(overview, /OrganizationLot3Boundary scope="overview"/);
  assert.match(warehouses, /OrganizationLot3Boundary scope="warehouses"/);
});

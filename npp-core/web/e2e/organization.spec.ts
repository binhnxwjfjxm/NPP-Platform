import { test, expect } from '@playwright/test';

function uniqueSuffix() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
}

test.describe('Bộ ba quản trị tổ chức', () => {
  test('thêm, sửa, lọc và bật/tắt chi nhánh, kho hàng, vị trí kho', async ({ page }) => {
    const suffix = uniqueSuffix();
    const branchCode = `BR-${suffix}`;
    const warehouseCode = `WH-${suffix}`;
    const locationCode = `LOC-${suffix}`;
    let branchName = `Chi nhánh ${suffix}`;
    let warehouseName = `Kho ${suffix}`;
    let locationName = `Vị trí ${suffix}`;

    await page.goto('/organization/branches');
    await expect(page.getByTestId('branches-page').getByRole('heading', { name: 'Chi nhánh', exact: true })).toBeVisible();
    await expect(page.getByTestId('branches-page')).toBeVisible();

    await page.getByTestId('branches-topbar-create-button').click();
    await page.getByTestId('branch-code-input').fill(branchCode.toLowerCase());
    await page.getByTestId('branch-name-input').fill(branchName);
    await page.getByTestId('branch-address-input').fill(`Địa chỉ ${suffix}`);
    await page.getByTestId('branch-phone-input').fill('0901234567');
    await page.getByTestId('branch-email-input').fill(`branch-${suffix.toLowerCase()}@example.com`);
    await page.getByRole('button', { name: 'Tạo chi nhánh' }).click();

    const branchRow = page.getByTestId(`branch-row-${branchCode}`);
    await expect(branchRow).toBeVisible();
    await expect(branchRow).toContainText(branchName);
    await expect(branchRow).toContainText('Đang hoạt động');

    await page.getByTestId('branches-search-input').fill(branchCode);
    await expect(branchRow).toBeVisible();
    await page.getByTestId('branches-status-filter').selectOption('active');
    await expect(branchRow).toBeVisible();
    await page.getByTestId('branches-status-filter').selectOption('all');
    await page.getByTestId('branches-search-input').fill('');

    const branchNameEdited = `${branchName} đã sửa`;
    await page.getByTestId(`edit-branch-${branchCode}`).click();
    await page.getByTestId('branch-name-input').fill(branchNameEdited);
    await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
    branchName = branchNameEdited;
    await expect(branchRow).toContainText(branchNameEdited);

    await page.getByTestId(`toggle-branch-${branchCode}`).click();
    await page.getByRole('button', { name: 'Xác nhận' }).click();
    await expect(branchRow).toContainText('Ngừng hoạt động');

    await page.getByTestId('branches-status-filter').selectOption('inactive');
    await expect(branchRow).toBeVisible();

    await page.getByTestId(`toggle-branch-${branchCode}`).click();
    await page.getByRole('button', { name: 'Xác nhận' }).click();
    await page.getByTestId('branches-status-filter').selectOption('all');
    await expect(branchRow).toContainText('Đang hoạt động');

    await page.goto('/organization/warehouses');
    await expect(page.getByTestId('warehouses-page').getByRole('heading', { name: 'Kho hàng', exact: true })).toBeVisible();
    await expect(page.getByTestId('warehouses-page')).toBeVisible();

    await page.getByTestId('warehouses-topbar-create-button').click();
    await page.getByTestId('warehouse-branch-select').selectOption({ label: `${branchCode} · ${branchName}` });
    await page.getByTestId('warehouse-code-input').fill(warehouseCode.toLowerCase());
    await page.getByTestId('warehouse-name-input').fill(warehouseName);
    await page.getByTestId('warehouse-type-select').selectOption('distribution');
    await page.getByRole('button', { name: 'Tạo kho' }).click();

    const warehouseRow = page.getByTestId(`warehouse-row-${warehouseCode}`);
    await expect(warehouseRow).toBeVisible();
    await expect(warehouseRow).toContainText(warehouseName);
    await expect(warehouseRow).toContainText(branchName);
    await expect(warehouseRow).toContainText('Đang hoạt động');

    await page.getByTestId('warehouses-search-input').fill(warehouseCode);
    await expect(warehouseRow).toBeVisible();
    await page.getByTestId('warehouses-status-filter').selectOption('active');
    await expect(warehouseRow).toBeVisible();
    await page.getByTestId('warehouses-status-filter').selectOption('all');
    await page.getByTestId('warehouses-search-input').fill('');

    const warehouseNameEdited = `${warehouseName} đã sửa`;
    await page.getByTestId(`edit-warehouse-${warehouseCode}`).click();
    await page.getByTestId('warehouse-name-input').fill(warehouseNameEdited);
    await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
    warehouseName = warehouseNameEdited;
    await expect(warehouseRow).toContainText(warehouseNameEdited);

    await page.getByTestId(`toggle-warehouse-${warehouseCode}`).click();
    await page.getByRole('button', { name: 'Xác nhận' }).click();
    await expect(warehouseRow).toContainText('Ngừng hoạt động');

    await page.getByTestId('warehouses-status-filter').selectOption('inactive');
    await expect(warehouseRow).toBeVisible();

    await page.getByTestId(`toggle-warehouse-${warehouseCode}`).click();
    await page.getByRole('button', { name: 'Xác nhận' }).click();
    await page.getByTestId('warehouses-status-filter').selectOption('all');
    await expect(warehouseRow).toContainText('Đang hoạt động');

    await page.goto('/organization/locations');
    await expect(page.getByTestId('locations-page').getByRole('heading', { name: 'Vị trí kho', exact: true })).toBeVisible();
    await expect(page.getByTestId('locations-page')).toBeVisible();

    await page.getByTestId('locations-topbar-create-button').click();
    await page.getByTestId('location-warehouse-select').selectOption({ label: `${warehouseCode} · ${warehouseName}` });
    await page.getByTestId('location-code-input').fill(locationCode.toLowerCase());
    await page.getByTestId('location-name-input').fill(locationName);
    await page.getByTestId('location-type-select').selectOption('storage');
    await page.getByRole('button', { name: 'Tạo vị trí' }).click();

    const locationRow = page.getByTestId(`location-row-${locationCode}`);
    await expect(locationRow).toBeVisible();
    await expect(locationRow).toContainText(locationName);
    await expect(locationRow).toContainText(warehouseCode);
    await expect(locationRow).toContainText('Đang hoạt động');

    await page.getByTestId('locations-search-input').fill(locationCode);
    await expect(locationRow).toBeVisible();
    await page.getByTestId('locations-status-filter').selectOption('active');
    await expect(locationRow).toBeVisible();
    await page.getByTestId('locations-status-filter').selectOption('all');
    await page.getByTestId('locations-search-input').fill('');

    const locationNameEdited = `${locationName} đã sửa`;
    await page.getByTestId(`edit-location-${locationCode}`).click();
    await page.getByTestId('location-name-input').fill(locationNameEdited);
    await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
    locationName = locationNameEdited;
    await expect(locationRow).toContainText(locationNameEdited);

    await page.getByTestId(`toggle-location-${locationCode}`).click();
    await page.getByRole('button', { name: 'Xác nhận' }).click();
    await expect(locationRow).toContainText('Ngừng hoạt động');

    await page.getByTestId('locations-status-filter').selectOption('inactive');
    await expect(locationRow).toBeVisible();

    await page.getByTestId(`toggle-location-${locationCode}`).click();
    await page.getByRole('button', { name: 'Xác nhận' }).click();
    await page.getByTestId('locations-status-filter').selectOption('all');
    await expect(locationRow).toContainText('Đang hoạt động');
  });
});

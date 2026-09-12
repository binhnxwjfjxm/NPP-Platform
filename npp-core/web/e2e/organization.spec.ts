import { test, expect } from '@playwright/test';

function uniqueSuffix() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
}

test.describe('Bộ ba quản trị tổ chức', () => {
  test('quản lý chi nhánh, kho hàng và khu vực trong sơ đồ kho', async ({ page }) => {
    const suffix = uniqueSuffix();
    const branchCode = `BR-${suffix}`;
    const warehouseCode = `WH-${suffix}`;
    const locationCode = `LOC-${suffix}`;
    let branchName = `Chi nhánh ${suffix}`;
    let warehouseName = `Kho ${suffix}`;
    let locationName = `Khu vực ${suffix}`;

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

    await page.goto('/organization/warehouses?tab=quick');
    const quickSetup = page.getByTestId('warehouse-quick-setup');
    await expect(quickSetup.getByRole('heading', { name: 'Thiết lập nhanh kho hàng', exact: true })).toBeVisible();
    await quickSetup.getByLabel('Chi nhánh quản lý').selectOption({ label: `${branchCode} · ${branchName}` });
    await quickSetup.getByLabel('Mã kho').fill(warehouseCode.toLowerCase());
    await quickSetup.getByLabel('Tên kho').fill(warehouseName);
    await quickSetup.getByLabel('Loại kho').selectOption('distribution');
    await quickSetup.getByRole('button', { name: 'Tạo kho' }).click();
    await expect(page.getByRole('status')).toContainText(`Đã tạo kho ${warehouseCode}`);

    await page.goto('/organization/warehouses');
    await expect(page.getByTestId('warehouses-page').getByRole('heading', { name: 'Kho hàng', exact: true })).toBeVisible();
    const warehouseRow = page.getByTestId(`warehouse-row-${warehouseCode}`);
    await expect(warehouseRow).toBeVisible();
    await expect(warehouseRow).toContainText(warehouseName);
    await expect(warehouseRow).toContainText(branchName);
    await expect(warehouseRow).toContainText('Đang hoạt động');
    await page.getByLabel('Tra cứu kho').fill(warehouseCode);
    await expect(warehouseRow).toBeVisible();
    await page.getByLabel('Trạng thái').selectOption('active');
    await expect(warehouseRow).toBeVisible();
    await page.getByLabel('Trạng thái').selectOption('all');
    await page.getByLabel('Tra cứu kho').fill('');

    const warehouseNameEdited = `${warehouseName} đã sửa`;
    await warehouseRow.getByRole('button', { name: 'Chỉnh sửa' }).click();
    await page.getByRole('dialog').getByLabel('Tên kho').fill(warehouseNameEdited);
    await page.getByRole('dialog').getByRole('button', { name: 'Lưu thay đổi' }).click();
    warehouseName = warehouseNameEdited;
    await expect(warehouseRow).toContainText(warehouseNameEdited);
    await warehouseRow.getByRole('button', { name: 'Ngừng sử dụng' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Xác nhận' }).click();
    await expect(warehouseRow).toContainText('Ngừng hoạt động');
    await page.getByLabel('Trạng thái').selectOption('inactive');
    await expect(warehouseRow).toBeVisible();
    await warehouseRow.getByRole('button', { name: 'Đưa vào sử dụng' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Xác nhận' }).click();
    await page.getByLabel('Trạng thái').selectOption('all');
    await expect(warehouseRow).toContainText('Đang hoạt động');

    await page.goto('/organization/warehouses?tab=layout');
    const layout = page.getByTestId('warehouse-layout-workspace');
    await expect(layout.getByRole('heading', { name: 'Sơ đồ kho', exact: true })).toBeVisible();
    await layout.getByLabel('Kho').selectOption({ label: `${warehouseCode} · ${warehouseName}` });
    await layout.getByRole('button', { name: 'Thêm khu vực' }).click();

    let locationDialog = page.getByRole('dialog');
    await locationDialog.getByLabel('Mã khu vực').fill(locationCode.toLowerCase());
    await locationDialog.getByLabel('Tên khu vực').fill(locationName);
    await locationDialog.getByLabel('Loại khu vực').selectOption('storage');
    await locationDialog.getByRole('button', { name: 'Thêm khu vực' }).click();
    await expect(page.getByRole('status')).toContainText('Đã thêm khu vực vào sơ đồ kho.');

    const locationRow = page.getByTestId('warehouse-layout-table').getByRole('row').filter({ hasText: locationCode });
    await expect(locationRow).toBeVisible();
    await expect(locationRow).toContainText(locationName);
    await expect(locationRow).toContainText('Đang hoạt động');

    const locationNameEdited = `${locationName} đã sửa`;
    await locationRow.getByRole('button', { name: 'Chỉnh sửa' }).click();
    locationDialog = page.getByRole('dialog');
    const locationNameInput = locationDialog.getByLabel('Tên khu vực');
    await locationNameInput.fill(locationNameEdited);
    await locationDialog.getByLabel('Loại khu vực').selectOption('receiving');
    await expect(locationNameInput).toHaveValue(locationNameEdited);
    await expect(locationDialog.getByLabel('Loại khu vực')).toHaveValue('receiving');
    await locationDialog.getByRole('button', { name: 'Lưu thay đổi' }).click();
    locationName = locationNameEdited;
    await expect(locationRow).toContainText(locationNameEdited);
    await expect(locationRow).toContainText('Khu nhận hàng');

    await locationRow.getByRole('button', { name: 'Ngừng sử dụng' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Xác nhận' }).click();
    await expect(locationRow).toContainText('Ngừng hoạt động');
    await locationRow.getByRole('button', { name: 'Đưa vào sử dụng' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Xác nhận' }).click();
    await expect(locationRow).toContainText('Đang hoạt động');
  });
});

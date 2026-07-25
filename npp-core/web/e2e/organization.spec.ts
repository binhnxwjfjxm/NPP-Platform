import { test, expect } from '@playwright/test';

test.describe('Organization and warehouse vertical slice', () => {
  test('creates branch, warehouse and location then changes location status', async ({ page }) => {
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
    const branchCode = `BR-${suffix}`;
    const warehouseCode = `WH-${suffix}`;
    const locationCode = `LOC-${suffix}`;
    const branchName = `Branch ${suffix}`;
    const warehouseName = `Warehouse ${suffix}`;
    const locationName = `Location ${suffix}`;

    const response = await page.goto('/organization');
    expect(response?.status()).toBe(200);
    await expect(page.getByTestId('organization-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Organization & warehouse structure' })).toBeVisible();

    await page.getByTestId('branch-code-input').fill(branchCode.toLowerCase());
    await page.getByTestId('branch-name-input').fill(branchName);
    await page.getByTestId('create-branch').click();
    const branchRow = page.getByTestId(`branch-${branchCode}`);
    await expect(branchRow).toBeVisible();
    await expect(branchRow).toContainText(branchName);
    await expect(branchRow).toContainText('Active');

    await page.getByTestId('warehouse-branch-select').selectOption({ label: `${branchCode} · ${branchName}` });
    await page.getByTestId('warehouse-code-input').fill(warehouseCode.toLowerCase());
    await page.getByTestId('warehouse-name-input').fill(warehouseName);
    await page.getByTestId('warehouse-type-select').selectOption('distribution');
    await page.getByTestId('create-warehouse').click();
    const warehouseRow = page.getByTestId(`warehouse-${warehouseCode}`);
    await expect(warehouseRow).toBeVisible();
    await expect(warehouseRow).toContainText(warehouseName);
    await expect(warehouseRow).toContainText(branchName);

    await page.getByTestId('location-warehouse-select').selectOption({ label: `${warehouseCode} · ${warehouseName}` });
    await page.getByTestId('location-code-input').fill(locationCode.toLowerCase());
    await page.getByTestId('location-name-input').fill(locationName);
    await page.getByTestId('location-type-select').selectOption('storage');
    await page.getByTestId('create-location').click();
    const locationRow = page.getByTestId(`location-${locationCode}`);
    await expect(locationRow).toBeVisible();
    await expect(locationRow).toContainText(locationName);
    await expect(locationRow).toContainText(warehouseName);
    await expect(locationRow).toContainText('Active');

    await page.getByTestId(`toggle-location-${locationCode}`).click();
    await expect(page.getByTestId(`location-${locationCode}`)).toContainText('Inactive');
    await expect(page.getByTestId('organization-error')).toHaveCount(0);
  });
});

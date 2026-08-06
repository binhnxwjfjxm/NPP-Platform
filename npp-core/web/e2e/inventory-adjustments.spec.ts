import { test, expect } from '@playwright/test';

test('NPP exposes governed inventory adjustments under Inventory without horizontal overflow', async ({ page }) => {
  await page.goto('/inventory/adjustments');
  await expect(page.getByRole('heading', { name: 'Điều chỉnh & xử lý tồn' })).toBeVisible();
  await expect(page.getByTestId('nav-inventory-adjustments')).toBeVisible();
  await expect(page.getByTestId('inventory-adjustment-page-actions')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tạo phiếu' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});

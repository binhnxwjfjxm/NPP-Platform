import { test, expect } from '@playwright/test';

test('Công Ty exposes Điều chỉnh tồn as one parent workspace without horizontal overflow', async ({ page }) => {
  await page.goto('/inventory/adjustments');
  await expect(page.getByRole('heading', { name: 'Điều chỉnh tồn' })).toBeVisible();
  await expect(page.getByTestId('nav-inventory-adjustments')).toBeVisible();
  const tabs = page.getByRole('navigation', { name: 'Chức năng Điều chỉnh tồn' });
  await expect(tabs).toBeVisible();
  await expect(tabs.getByRole('link', { name: 'Phiếu điều chỉnh' })).toBeVisible();
  await expect(tabs.getByRole('link', { name: 'Điều chỉnh thủ công' })).toBeVisible();
  await expect(tabs.getByRole('link', { name: 'Điều chỉnh hàng loạt' })).toBeVisible();
  await expect(page.getByTestId('inventory-adjustment-page-actions')).toBeVisible();

  await tabs.getByRole('link', { name: 'Điều chỉnh thủ công' }).click();
  await expect(page.getByRole('heading', { name: 'Lập phiếu điều chỉnh thủ công' })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});

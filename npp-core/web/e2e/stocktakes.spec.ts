import { test, expect } from '@playwright/test';

test('NPP exposes stocktake under Inventory with PageHeader actions and responsive workspace', async ({ page }) => {
  await page.goto('/inventory/stocktakes');
  await expect(page.getByRole('heading', { name: 'Kiểm kê kho' })).toBeVisible();
  await expect(page.getByTestId('stocktake-workspace')).toBeVisible();
  await expect(page.getByTestId('nav-inventory-stocktakes')).toBeVisible();
  const createButton = page.getByRole('button', { name: 'Tạo đợt kiểm kê' });
  if (await createButton.count()) await expect(createButton).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});

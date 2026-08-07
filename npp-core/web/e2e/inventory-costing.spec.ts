import { expect, test } from '@playwright/test';

test('inventory costing foundation has a separate operational workspace', async ({ page }) => {
  await page.goto('/inventory/costing');
  await expect(page.getByRole('heading', { name: /Giá vốn tồn kho/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Dựng lại giá vốn/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Số dư giá vốn/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Đối soát/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Bất thường/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Cost facts/i })).toBeVisible();
});

import { expect, test } from '@playwright/test';

test('inventory costing workspace exposes period lock and reconciliation surfaces', async ({ page }) => {
  await page.goto('/inventory/costing');
  await expect(page.getByRole('heading', { name: /Giá vốn tồn kho/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Dựng lại giá vốn/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Giá trị tồn/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Kỳ giá vốn/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Đối soát/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Chờ xử lý/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Điều chỉnh giá/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Bất thường/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Cost facts/i })).toBeVisible();
  await page.getByRole('button', { name: /Kỳ giá vốn/i }).click();
  await expect(page.getByText(/snapshot bất biến/i)).toBeVisible();
});

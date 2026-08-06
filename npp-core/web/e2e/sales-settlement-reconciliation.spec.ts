import { test, expect } from '@playwright/test';

test('NPP opens Phase 6F reconciliation with standard filters and read-only drill-down', async ({ page }) => {
  await page.goto('/accounting/reconciliation');
  await expect(page.getByRole('heading', { name: 'Đối soát bán hàng & COD' })).toBeVisible();
  const workspace = page.getByTestId('sales-settlement-reconciliation-workspace');
  await expect(workspace).toBeVisible();
  await expect(page.getByRole('form', { name: 'Bộ lọc đối soát' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Đặt lại' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Xuất CSV' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Áp dụng' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Trạng thái đơn, hàng, giao và tiền' })).toBeVisible();
  await expect(page.getByTestId('phase6f-closeout-anomalies')).toBeVisible();
  await expect(page).toHaveURL(/\/accounting\/reconciliation$/);
});

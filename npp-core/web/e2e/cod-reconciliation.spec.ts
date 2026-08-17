import { test, expect } from '@playwright/test';

test('Công Ty mở xác nhận COD kế toán trong tab đối soát', async ({ page }) => {
  await page.goto('/accounting/cod-reconciliation');
  await expect(page.getByRole('heading', { name: 'COD & đối soát' })).toBeVisible();
  const accountingTab = page.getByRole('tab', { name: 'Kế toán xác nhận' });
  await expect(accountingTab).toHaveAttribute('aria-selected', 'true');
  const workspace = page.getByTestId('cod-reconciliation-workspace');
  await expect(workspace).toBeVisible();
  await expect(workspace).toContainText('Bàn giao COD');
  await expect(workspace).toContainText('Đối chiếu và xác nhận');
  await expect(page.getByText(/tiền tài xế đang giữ/).first()).toBeVisible();
  await expect(page).toHaveURL(/\/accounting\/cod-reporting\?tab=accounting$/);
});

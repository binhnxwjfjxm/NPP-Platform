import { test, expect } from '@playwright/test';

test('customer return credit workspace stays separate from warehouse return receipt', async ({ page }) => {
  await page.goto('/accounting/customer-return-credits');
  await expect(page.getByRole('heading', { name: 'Điều chỉnh công nợ hàng trả' })).toBeVisible();
  const workspace = page.getByTestId('customer-return-credit-workspace');
  await expect(workspace).toBeVisible();
  await expect(workspace).toContainText('Credit từ hàng khách trả');
  await expect(workspace).toContainText('Credit chỉ phát sinh');
  await expect(page).toHaveURL(/\/accounting\/customer-return-credits$/);
});

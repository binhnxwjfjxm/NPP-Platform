import { test, expect } from '@playwright/test';

test('NPP opens COD reconciliation as a separate accounting workspace', async ({ page }) => {
  await page.goto('/accounting/cod-reconciliation');
  await expect(page.getByRole('heading', { name: 'Đối soát COD' })).toBeVisible();
  const workspace = page.getByTestId('cod-reconciliation-workspace');
  await expect(workspace).toBeVisible();
  await expect(workspace).toContainText('Bàn giao COD');
  await expect(workspace).toContainText('Đối chiếu và xác nhận');
  await expect(page.getByText(/Tách rõ tiền khách đã trả/)).toBeVisible();
  await expect(page).toHaveURL(/\/accounting\/cod-reconciliation$/);
});

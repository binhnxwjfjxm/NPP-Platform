import { expect, test } from '@playwright/test';

const TOKEN_MARKER = process.env.E2E_BACKEND_API_TOKEN ?? '';
const DATABASE_MARKER = process.env.E2E_DATABASE_URL ?? '';

function expectNoSensitiveData(value: string) {
  expect(value).not.toContain('Authorization');
  expect(value).not.toContain('CORE_API_SERVER_TOKEN');
  expect(value).not.toContain('CORE_API_INTERNAL_URL');
  expect(value).not.toContain('postgresql://');
  if (TOKEN_MARKER) expect(value).not.toContain(TOKEN_MARKER);
  if (DATABASE_MARKER) expect(value).not.toContain(DATABASE_MARKER);
}

test('management overview links to the customer onboarding review screen', async ({ page }) => {
  const overviewResponse = await page.goto('/management');
  expect(overviewResponse?.status()).toBe(200);
  await expect(page.getByTestId('management-overview-page')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Mở màn xử lý' })).toHaveAttribute(
    'href',
    '/management/customer-onboarding',
  );

  const reviewResponse = await page.goto('/management/customer-onboarding');
  expect(reviewResponse?.status()).toBe(200);
  await expect(page.getByTestId('customer-onboarding-review-workspace')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Xử lý đề nghị mở mã khách hàng' })).toBeVisible();
  expectNoSensitiveData(await page.content());
});

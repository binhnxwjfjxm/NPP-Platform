import { expect, test } from '@playwright/test';

const tripId = '30000000-0000-4000-8000-000000000001';
const assignmentOneId = '90000000-0000-4000-8000-000000000001';

test('tài xế ghi giao hàng, thu COD tiền mặt và bàn giao cuối chuyến trên mobile', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Chuyến của tôi' })).toBeVisible();
  await expect(page.getByText('Xin chào, Nguyễn Văn Tài')).toBeVisible();
  await page.getByRole('link', { name: /TRP-20260804-00001/ }).click();
  await expect(page).toHaveURL(new RegExp(`/trips/${tripId}$`));

  const firstAttempt = page.getByTestId(`attempt-form-${assignmentOneId}`);
  await firstAttempt.getByLabel('Giao một phần').check();
  await firstAttempt.getByLabel('Số thực giao Bột nguyên liệu A').fill('1');
  await firstAttempt.getByLabel('Ghi chú').fill('Khách nhận một bao');
  await firstAttempt.getByRole('button', { name: 'Xác nhận kết quả' }).click();

  await expect(page.getByTestId(`attempt-recorded-${assignmentOneId}`)).toBeVisible();
  const codForm = page.getByTestId(`cod-form-${assignmentOneId}`);
  await expect(codForm).toBeVisible();
  await codForm.getByLabel('Tiền mặt').check();
  await codForm.getByLabel('Số tiền thực thu').fill('300000');
  await codForm.getByRole('button', { name: 'Xác nhận tiền COD' }).click();

  const collection = page.getByTestId(`cod-collection-${assignmentOneId}`);
  await expect(collection).toBeVisible();
  await expect(collection).toContainText('Tài xế còn giữ');
  await expect(collection).toContainText('300.000');

  const handover = page.getByTestId('cod-handover-panel');
  await expect(handover).toBeVisible();
  await handover.getByRole('button', { name: 'Lập bàn giao COD' }).click();
  await expect(handover).toContainText('Không còn tiền mặt COD chờ bàn giao');
  await expect(handover).toContainText('submitted');
  await expect(page.getByText(/Delivery không sửa công nợ trực tiếp/)).toBeVisible();
});

test('sai mật khẩu bị từ chối trước khi vào app', async ({ browser }) => {
  const context = await browser.newContext({
    httpCredentials: { username: 'driver-a', password: 'wrong-password' },
  });
  const page = await context.newPage();
  const response = await page.goto('/');
  expect(response?.status()).toBe(401);
  await context.close();
});

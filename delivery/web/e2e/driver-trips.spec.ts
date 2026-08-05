import { expect, test } from '@playwright/test';

const tripId = '30000000-0000-4000-8000-000000000001';
const assignmentOneId = '90000000-0000-4000-8000-000000000001';

test('tài xế xem chuyến và ghi giao một phần trên mobile', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Chuyến của tôi' })).toBeVisible();
  await expect(page.getByText('Xin chào, Nguyễn Văn Tài')).toBeVisible();
  await expect(page.getByRole('link', { name: /TRP-20260804-00001/ })).toBeVisible();
  await expect(page.getByText('Ghi kết quả tại từng phiếu giao')).toBeVisible();
  await expect(page.getByText(/Ảnh hoặc xác nhận người nhận là bằng chứng tùy chọn/)).toBeVisible();
  await expect(page.getByText(/GPS và thu tiền chưa thuộc luồng hiện tại/)).toBeVisible();

  await page.getByRole('link', { name: /TRP-20260804-00001/ }).click();
  await expect(page).toHaveURL(new RegExp(`/trips/${tripId}$`));
  await expect(page.getByRole('heading', { name: 'TRP-20260804-00001' })).toBeVisible();
  await expect(page.getByText('51A-123.45')).toBeVisible();
  await expect(page.getByText('12 Nguyễn Trãi, Quận 5, TP.HCM')).toBeVisible();
  await expect(page.getByText('45 Lê Văn Sỹ, Quận 3, TP.HCM')).toBeVisible();
  await expect(page.getByText('Cửa hàng Minh Tâm')).toBeVisible();
  await expect(page.getByText('DO-0002')).toBeVisible();
  await expect(page.getByTestId(`attempt-form-${assignmentOneId}`)).toBeVisible();
  await expect(page.getByText(/bằng chứng giao hàng là tùy chọn/i)).toBeVisible();
  await expect(page.getByText(/không tự nhập lại kho và chưa xử lý thu tiền/i)).toBeVisible();

  const firstAttempt = page.getByTestId(`attempt-form-${assignmentOneId}`);
  await firstAttempt.getByLabel('Giao một phần').check();
  await firstAttempt.getByLabel('Số thực giao Bột nguyên liệu A').fill('1');
  await firstAttempt.getByLabel('Ghi chú').fill('Khách nhận một bao');
  await firstAttempt.getByRole('button', { name: 'Xác nhận kết quả' }).click();

  const recorded = page.getByTestId(`attempt-recorded-${assignmentOneId}`);
  await expect(recorded).toBeVisible();
  await expect(recorded.getByText('Giao một phần')).toBeVisible();
  await expect(recorded.getByText(/1 \/ 3 BAO/)).toBeVisible();
  await expect(recorded.getByText('Kết quả đã khóa và chỉ đọc.')).toBeVisible();
  await expect(page.getByText('1/2 phiếu')).toBeVisible();
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

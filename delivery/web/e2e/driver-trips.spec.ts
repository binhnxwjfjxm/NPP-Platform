import { expect, test, type Page } from '@playwright/test';

const tripId = '30000000-0000-4000-8000-000000000001';
const assignmentOneId = '90000000-0000-4000-8000-000000000001';

async function signIn(page: Page) {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  await page.getByLabel('Tên đăng nhập').fill('driver-a');
  await page.getByLabel('Mật khẩu').fill('delivery-test-password');
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page).toHaveURL(/\/$/);
}

test('tài xế đăng nhập một lần, reload vẫn giữ phiên và hoàn tất tác nghiệp mobile', async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Chuyến của tôi' })).toBeVisible();
  await expect(page.getByText('Xin chào, Nguyễn Văn Tài')).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Chuyến của tôi' })).toBeVisible();

  const bottomNav = page.getByRole('navigation', { name: 'Điều hướng chính' });
  await expect(bottomNav).toBeVisible();
  await expect(bottomNav.getByText('Hôm nay')).toBeVisible();
  await expect(bottomNav.getByText('Chuyến')).toBeVisible();
  await expect(bottomNav.getByText('Hướng dẫn')).toBeVisible();
  await expect(bottomNav.getByText('Đồng bộ')).toBeVisible();

  await page.getByRole('link', { name: /TRP-20260804-00001/ }).click();
  await expect(page).toHaveURL(new RegExp(`/trips/${tripId}$`));
  await expect(page.getByRole('link', { name: 'Điểm giao' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('link', { name: 'COD' })).toBeVisible();

  const workflow = page.getByTestId(`attempt-workflow-${assignmentOneId}`);
  await workflow.locator('summary').click();
  const firstAttempt = page.getByTestId(`attempt-form-${assignmentOneId}`);
  await firstAttempt.getByLabel('Giao một phần').check();
  await firstAttempt.getByLabel('Số thực giao Bột nguyên liệu A').fill('1');
  await firstAttempt.getByLabel('Ghi chú').fill('Khách nhận một bao');
  await firstAttempt.getByRole('button', { name: 'Xác nhận kết quả' }).click();

  await expect(page.getByTestId(`attempt-recorded-${assignmentOneId}`)).toBeVisible();
  const codWorkflow = page.getByTestId(`cod-workflow-${assignmentOneId}`);
  await codWorkflow.locator('summary').click();
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

test('tài xế đăng xuất từ menu tài khoản, xóa phiên và reload vẫn ở màn đăng nhập', async ({ page }) => {
  await signIn(page);
  await page.getByLabel('Mở menu tài khoản').click();
  await expect(page.getByRole('button', { name: /Đăng xuất/ })).toBeVisible();
  await page.getByRole('button', { name: /Đăng xuất/ }).click();

  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  await expect(page.getByRole('button', { name: 'Đăng nhập' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Điều hướng chính' })).toHaveCount(0);

  await page.reload();
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  await expect(page.getByRole('button', { name: 'Đăng nhập' })).toBeVisible();
});

test('sai mật khẩu ở lại màn đăng nhập và không vào app', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  await page.getByLabel('Tên đăng nhập').fill('driver-a');
  await page.getByLabel('Mật khẩu').fill('wrong-password');
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  await expect(page.getByRole('alert').filter({ hasText: 'chưa đúng' })).toContainText('chưa đúng');
  await expect(page.getByRole('navigation', { name: 'Điều hướng chính' })).toHaveCount(0);
});

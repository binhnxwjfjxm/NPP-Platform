import { expect, test } from '@playwright/test';

function suffix() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

test('document numbering admin uses system identity, enforces one active series and preserves format lock', async ({ page }) => {
  const id = suffix();
  const name = `Hóa đơn E2E ${id}`;

  await page.goto('/document-numbering');
  await expect(page.getByTestId('document-numbering-page')).toBeVisible();

  await page.getByTestId('add-number-series-button').click();
  await expect(page.getByTestId('number-series-code-input')).toHaveCount(0);
  await page.getByTestId('document-type-input').selectOption('INVOICE');
  await page.getByTestId('number-series-name-input').fill(name);
  await page.getByTestId('number-prefix-input').fill('IV-');
  await page.getByTestId('number-template-input').fill('{PREFIX}{YYYY}{MM}-{SEQ}');
  await page.getByTestId('reset-policy-select').selectOption('MONTHLY');
  await page.getByTestId('save-number-series-button').click();

  const row = page.getByRole('row').filter({ hasText: name }).first();
  await expect(row).toBeVisible();
  await expect(page.getByTestId('numbering-notice')).toContainText('Đã tạo quy tắc đánh số');
  await expect(row).not.toContainText(/INVOICE_[0-9A-F]{8}/);

  await page.getByTestId('add-number-series-button').click();
  await page.getByTestId('document-type-input').selectOption('INVOICE');
  await page.getByTestId('number-series-name-input').fill(`Hóa đơn trùng ${id}`);
  await page.getByTestId('number-prefix-input').fill('IV2-');
  await page.getByTestId('number-template-input').fill('{PREFIX}{YYYY}{MM}-{SEQ}');
  await page.getByTestId('reset-policy-select').selectOption('MONTHLY');
  await page.getByTestId('save-number-series-button').click();
  await expect(page.getByTestId('number-series-modal').getByRole('alert')).toContainText('đã có một quy tắc đang sử dụng');
  await page.getByTestId('number-series-modal').getByRole('button', { name: 'Hủy' }).click();

  await row.getByRole('button', { name: 'Chi tiết' }).click();
  const detail = page.getByTestId('number-series-detail');
  await expect(detail).toBeVisible();
  await page.getByTestId('allocation-date-input').fill('2026-07-27');
  await expect(page.getByTestId('allocation-key-input')).toHaveCount(0);
  await page.getByTestId('allocate-test-number-button').click();

  const firstNumber = 'IV-202607-000001';
  await expect(page.getByTestId('allocation-result')).toContainText(firstNumber);
  await expect(page.getByTestId(`allocation-row-${firstNumber}`)).toBeVisible();
  await expect(detail.getByText('Số tiếp theo', { exact: true }).locator('..')).toContainText('2');

  await page.getByTestId('allocate-test-number-button').click();
  const secondNumber = 'IV-202607-000002';
  await expect(page.getByTestId('allocation-result')).toContainText(secondNumber);
  await expect(page.getByTestId(`allocation-row-${firstNumber}`)).toHaveCount(1);
  await expect(page.getByTestId(`allocation-row-${secondNumber}`)).toHaveCount(1);
  await expect(detail.getByText('Số tiếp theo', { exact: true }).locator('..')).toContainText('3');

  await row.getByRole('button', { name: 'Sửa' }).click();
  await expect(page.getByTestId('number-prefix-input')).toBeDisabled();
  await expect(page.getByTestId('number-template-input')).toBeDisabled();
  await expect(page.getByText('Cấu trúc số đã được cố định vì quy tắc này đã có lịch sử cấp số.')).toBeVisible();
});

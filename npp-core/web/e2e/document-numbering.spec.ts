import { expect, test } from '@playwright/test';

function suffix() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

test('document numbering admin creates, allocates, replays and locks a series', async ({ page }) => {
  const id = suffix();
  const code = `SO-${id}`;
  const key = `e2e-number-${id}`;

  await page.goto('/document-numbering');
  await expect(page.getByTestId('document-numbering-page')).toBeVisible();

  await page.getByTestId('add-number-series-button').click();
  await page.getByTestId('number-series-code-input').fill(code);
  await page.getByTestId('document-type-input').selectOption('SALES_ORDER');
  await page.getByTestId('number-series-name-input').fill(`Đơn bán E2E ${id}`);
  await page.getByTestId('number-prefix-input').fill('SO-');
  await page.getByTestId('number-template-input').fill('{PREFIX}{YYYY}{MM}-{SEQ}');
  await page.getByTestId('reset-policy-select').selectOption('MONTHLY');
  await page.getByTestId('sequence-width-input').fill('6');
  await page.getByTestId('start-counter-input').fill('1');
  await page.getByTestId('save-number-series-button').click();

  const row = page.getByTestId(`number-series-row-${code}`);
  await expect(row).toBeVisible();
  await expect(page.getByTestId('numbering-notice')).toContainText('Đã tạo quy tắc đánh số');

  await row.getByTestId(`select-number-series-${code}`).click();
  await expect(page.getByTestId('number-series-detail')).toBeVisible();
  await page.getByTestId('allocation-date-input').fill('2026-07-27');
  await page.getByTestId('allocation-key-input').fill(key);
  await page.getByTestId('allocate-test-number-button').click();

  const expectedNumber = 'SO-202607-000001';
  await expect(page.getByTestId('allocation-result')).toContainText(expectedNumber);
  await expect(page.getByTestId(`allocation-row-${expectedNumber}`)).toBeVisible();
  await expect(page.getByText('Số kế tiếp').locator('..')).toContainText('2');

  await page.getByTestId('allocate-test-number-button').click();
  await expect(page.getByTestId(`allocation-row-${expectedNumber}`)).toHaveCount(1);

  await row.getByRole('button', { name: 'Sửa' }).click();
  await expect(page.getByTestId('number-prefix-input')).toBeDisabled();
  await expect(page.getByTestId('number-template-input')).toBeDisabled();
  await expect(page.getByText('Định dạng đã khóa vì quy tắc này đã phát sinh số chứng từ.')).toBeVisible();
});

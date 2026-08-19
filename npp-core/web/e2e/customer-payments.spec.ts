import { test, expect, type APIRequestContext } from '@playwright/test';

function suffix() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

async function createWarehouse(request: APIRequestContext, code: string) {
  let response = await request.post('/api/organization/branches', {
    headers: { 'Idempotency-Key': `cp-branch-${code}` },
    data: {
      code: `CPB-${code}`,
      name: `Chi nhánh thu tiền ${code}`,
    },
  });
  expect(response.status()).toBe(201);
  const branch = (await response.json()).data;

  response = await request.post('/api/organization/warehouses', {
    headers: { 'Idempotency-Key': `cp-warehouse-${code}` },
    data: {
      branchId: branch.id,
      code: `CPW-${code}`,
      name: `Kho thu tiền ${code}`,
      warehouseType: 'main',
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).data as { id: string; code: string; name: string };
}

async function createCustomerThroughWorkspace(page: import('@playwright/test').Page, code: string) {
  const groupCode = `CPG-${code}`;
  const customerCode = `CPK-${code}`;
  const customerName = `Khách thu tiền ${code}`;

  await page.goto('/customers');
  const workspace = page.getByTestId('customers-page');
  await expect(workspace).toBeVisible();

  await workspace.getByRole('button', { name: 'Nhóm khách hàng', exact: true }).click();
  await page.getByTestId('customer-groups-topbar-create-button').click();
  await page.getByTestId('customer-group-code-input').fill(groupCode);
  await page.getByTestId('customer-group-name-input').fill(`Nhóm thu tiền ${code}`);
  await workspace.getByRole('button', { name: 'Lưu nhóm' }).click();
  await expect(page.getByTestId(`customer-group-row-${groupCode}`)).toBeVisible();

  await workspace.getByRole('button', { name: 'Khách hàng', exact: true }).click();
  await page.getByTestId('customers-topbar-create-button').click();
  const dialog = page.getByRole('dialog', { name: 'Biểu mẫu khách hàng' });
  await page.getByTestId('customer-code-input').fill(customerCode);
  await page.getByTestId('customer-name-input').fill(customerName);
  await dialog.getByLabel('Nhóm khách hàng').selectOption({
    label: `${groupCode} · Nhóm thu tiền ${code}`,
  });
  await page.getByTestId('customer-create-address-label-input').fill('Trụ sở chính');
  await page.getByTestId('customer-province-select').selectOption({ label: 'Hà Nội' });
  await page.getByTestId('customer-ward-select').selectOption({ index: 1 });
  await page.getByTestId('customer-create-address-line1-input').fill(`1 Đường thu tiền ${code}`);
  await dialog.getByRole('button', { name: 'Lưu khách hàng và địa chỉ' }).click();
  await expect(page.getByTestId(`customer-row-${customerCode}`)).toBeVisible();

  return { customerCode, customerName };
}

test('customer payment workspace records money not yet linked to an order and permits cancellation', async ({ page, request }) => {
  const code = suffix();
  const warehouse = await createWarehouse(request, code);
  const customer = await createCustomerThroughWorkspace(page, code);

  await page.goto('/accounting/customer-payments');
  await expect(page.getByTestId('customer-payments-page')).toBeVisible();
  await expect(page.getByTestId('nav-customer-payments')).toBeVisible();

  const form = page.getByTestId('customer-payment-form');
  await form.getByTestId('customer-payment-customer-search').fill(customer.customerCode);
  await form.getByLabel('Khách hàng').selectOption({
    label: `${customer.customerCode} · ${customer.customerName}`,
  });
  await expect(form.getByTestId('customer-payment-order-search')).toBeVisible();
  await form.getByLabel('Đơn vị nhận tiền').selectOption(warehouse.id);
  await form.getByLabel('Số tiền thực nhận').fill('60000');
  await form.getByLabel('Mã giao dịch ngân hàng').fill(`BANK-${code}`);
  await form.getByLabel('Ghi chú').fill('Phiếu thu chưa gắn với đơn từ kiểm thử trình duyệt');
  await form.getByRole('button', { name: 'Lưu phiếu thu' }).click();

  await expect(page.getByRole('status')).toContainText('Đã ghi nhận phiếu thu CP-');
  const paymentTable = page.getByTestId('customer-payments-table');
  const paymentRow = paymentTable.locator('tbody tr').filter({ hasText: customer.customerCode });
  await expect(paymentRow).toHaveCount(1);
  await expect(paymentRow).toContainText('60.000');
  await expect(paymentRow).toContainText('Chưa gắn với đơn');
  await paymentRow.getByRole('button', { name: /^CP-/ }).click();

  const detail = page.getByTestId('customer-payment-detail');
  await expect(detail).toContainText(customer.customerCode);
  await expect(detail).toContainText('Tiền chưa gắn với đơn: 60.000 VND');
  await expect(page.getByTestId('customer-payment-allocations-table')).toContainText('Chưa ghi tiền vào đơn nào');

  const reverseButton = detail.getByRole('button', { name: 'Hủy phiếu thu' });
  await expect(reverseButton).toBeEnabled();
  await detail.getByLabel('Lý do hủy').fill('Hủy phiếu thu chưa gắn với đơn trong kiểm thử trình duyệt');
  await reverseButton.click();

  await expect(page.getByRole('status')).toContainText('Đã hủy phiếu thu CP-');
  await expect(detail).toContainText('Đã hủy');
  await expect(reverseButton).toBeDisabled();
});

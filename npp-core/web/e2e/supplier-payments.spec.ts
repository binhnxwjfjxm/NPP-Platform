import { test, expect, type APIRequestContext } from '@playwright/test';

function suffix() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2,7)}`.toUpperCase();
}

async function createFixture(request: APIRequestContext, code: string) {
  const create = async (path: string, key: string, data: Record<string, unknown>) => {
    const response = await request.post(path,{ headers:{ 'Idempotency-Key':key },data });
    expect(response.status()).toBe(201);
    return (await response.json()).data;
  };
  const branch = await create('/api/organization/branches',`sp-branch-${code}`,{
    code:`SPB-${code}`,name:`Chi nhánh thanh toán ${code}`,
  });
  const warehouse = await create('/api/organization/warehouses',`sp-warehouse-${code}`,{
    branchId:branch.id,code:`SPW-${code}`,name:`Kho thanh toán ${code}`,warehouseType:'main',
  });
  const supplier = await create('/api/suppliers',`sp-supplier-${code}`,{
    code:`SPS-${code}`,name:`Nhà cung cấp thanh toán ${code}`,taxId:`TAX-SP-${code}`,
  });
  return { branch,warehouse,supplier };
}

test('supplier payment workspace records and reverses a posted payment',async({ page,request })=>{
  const code = suffix();
  const fixture = await createFixture(request,code);
  await page.goto('/accounting/supplier-payments');
  await expect(page.getByTestId('supplier-payments-page')).toBeVisible();

  const form = page.getByTestId('supplier-payment-form');
  await form.getByLabel('Nhà cung cấp').selectOption(fixture.supplier.id);
  await form.getByLabel('Kho').selectOption(fixture.warehouse.id);
  await form.getByLabel('Số tiền').fill('125000');
  await form.getByLabel('Tham chiếu ngân hàng').fill(`BANK-${code}`);
  await form.getByLabel('Ghi chú').fill('Thanh toán kiểm thử giao diện');
  await form.getByRole('button',{ name:'Ghi nhận thanh toán' }).click();

  await expect(page.getByRole('status')).toContainText('Đã ghi nhận phiếu SP-');
  const table = page.getByTestId('supplier-payments-table');
  const row = table.locator('tbody tr').filter({ hasText:fixture.supplier.code });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('125.000');
  await row.getByRole('button',{ name:/^SP-/ }).click();

  const detail = page.getByTestId('supplier-payment-detail');
  await expect(detail).toContainText(fixture.supplier.code);
  await detail.getByLabel('Lý do đảo').fill('Đảo phiếu kiểm thử trình duyệt');
  await detail.getByRole('button',{ name:'Đảo phiếu thanh toán' }).click();
  await expect(page.getByRole('status')).toContainText('Đã đảo phiếu SP-');
  await expect(detail).toContainText('Đã đảo');
});

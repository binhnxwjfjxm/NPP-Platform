import { expect, test, type Page, type Route } from '@playwright/test';

const tripId = '55555555-5555-4555-8555-555555555555';
const issueLineId = '99999999-9999-4999-8999-999999999999';

async function fulfill(route: Route, data: unknown, status = 200) {
  await route.fulfill({ status, json: { data, requestId: 'e2e-phase-6e5' } });
}

type ReconciliationScenario = {
  attemptResult: 'delivered_partial' | 'failed';
  deliveredBaseQuantity: string;
  issuedBaseQuantity: string;
  outstandingBaseQuantity: string;
};

async function mockReconciliationApis(
  page: Page,
  scenario: ReconciliationScenario = {
    attemptResult: scenario.attemptResult,
    deliveredBaseQuantity: '1.000000000000',
    issuedBaseQuantity: '3.000000000000',
    outstandingBaseQuantity: '2.000000000000',
  },
) {
  let returned = false;
  let closed = false;
  const tripList = () => [{
    id: tripId,
    number: 'TRP-20260805-00001',
    warehouseCode: 'KHO-CHINH',
    warehouseName: 'Kho chính',
    licensePlate: '51C-12345',
    driverName: 'Nguyễn Văn Tài',
    status: closed ? 'closed' : 'dispatched',
  }];
  const detail = () => ({
    id: tripId,
    number: 'TRP-20260805-00001',
    status: closed ? 'closed' : 'dispatched',
    warehouseCode: 'KHO-CHINH',
    warehouseName: 'Kho chính',
    licensePlate: '51C-12345',
    driverName: 'Nguyễn Văn Tài',
    canClose: returned && !closed,
    closedAt: closed ? '2026-08-05T04:30:00.000Z' : null,
    lines: [{
      assignmentId: '88888888-8888-4888-8888-888888888888',
      stopSequence: 1,
      deliveryOrderId: '77777777-7777-4777-8777-777777777777',
      deliveryOrderNumber: 'DO-202608-000010',
      customerCode: 'KH-001',
      customerName: 'Cửa hàng Minh Anh',
      attemptId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      attemptResult: 'delivered_partial',
      inventoryIssueLineId: issueLineId,
      sku: 'BOT-001',
      itemName: 'Bột nguyên liệu',
      unitCode: 'KG',
      locationCode: 'A-01',
      lotCode: 'LOT-01',
      issuedBaseQuantity: scenario.issuedBaseQuantity,
      deliveredBaseQuantity: scenario.deliveredBaseQuantity,
      returnedBaseQuantity: returned ? scenario.outstandingBaseQuantity : '0.000000000000',
      outstandingBaseQuantity: returned ? '0.000000000000' : scenario.outstandingBaseQuantity,
    }],
    receipts: returned ? [{
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      inventoryMovementId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      receivedAt: '2026-08-05T04:00:00.000Z',
      note: 'Kho đã đếm và nhận lại',
      lines: [{
        inventoryIssueLineId: issueLineId,
        returnedBaseQuantity: scenario.outstandingBaseQuantity,
        sku: 'BOT-001',
      }],
    }] : [],
  });

  await page.route('**/api/logistics/trips?status=all', (route) => fulfill(route, tripList()));
  await page.route(`**/api/logistics/trips/${tripId}/reconciliation`, (route) => fulfill(route, detail()));
  await page.route(`**/api/logistics/trips/${tripId}/return-receipts`, async (route) => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers()['idempotency-key']).toMatch(/^trip-reconciliation-receive-/);
    const body = route.request().postDataJSON();
    expect(body.lines).toEqual([{
      inventoryIssueLineId: issueLineId,
      returnedBaseQuantity: scenario.outstandingBaseQuantity,
    }]);
    returned = true;
    await fulfill(route, { trip: detail(), receiptId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', replayed: false });
  });
  await page.route(`**/api/logistics/trips/${tripId}/close`, async (route) => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers()['idempotency-key']).toMatch(/^trip-reconciliation-close-/);
    closed = true;
    await fulfill(route, { trip: detail(), replayed: false });
  });
}

test('điều phối nhận hàng về kho rồi mới đóng chuyến', async ({ page }) => {
  await mockReconciliationApis(page);
  await page.goto('/logistics/trip-reconciliation');

  await expect(page.getByTestId('trip-reconciliation-workspace')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Đối soát cuối chuyến' })).toBeVisible();
  await page.getByRole('button', { name: /TRP-20260805-00001/ }).click();

  await expect(page.getByText('DO-202608-000010')).toBeVisible();
  await expect(page.getByText('Giao một phần')).toBeVisible();
  await expect(page.getByText('2.000000000000', { exact: true })).toBeVisible();
  await expect(page.getByText('Chưa thể đóng: còn 1 dòng hàng trên xe chưa được kho nhận lại.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Chốt đối soát & đóng chuyến' })).toBeDisabled();

  const quantity = page.getByLabel('Số lượng nhận lại BOT-001');
  await expect(quantity).toHaveValue('2.000000000000');
  await page.getByLabel('Ghi chú').first().fill('Kho đã đếm và nhận lại');
  await page.getByRole('button', { name: 'Xác nhận nhập hàng về kho' }).click();

  await expect(page.getByRole('status')).toContainText('Đã ghi nhận hàng quay về kho');
  await expect(page.getByText('Đủ điều kiện đóng')).toBeVisible();
  await expect(page.getByText('Lịch sử kho nhận lại')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Chốt đối soát & đóng chuyến' })).toBeEnabled();

  await page.getByRole('button', { name: 'Chốt đối soát & đóng chuyến' }).click();
  await expect(page.getByRole('status')).toContainText('Chuyến đã được đóng');
  await expect(page.getByText(/Đã đóng chuyến lúc/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Xác nhận nhập hàng về kho' })).toHaveCount(0);
});

test('một mặt hàng không giao được vẫn phải nhận lại kho trước khi đóng chuyến', async ({ page }) => {
  await mockReconciliationApis(page, {
    attemptResult: 'failed',
    deliveredBaseQuantity: '0.000000000000',
    issuedBaseQuantity: '1.000000000000',
    outstandingBaseQuantity: '1.000000000000',
  });
  await page.goto('/logistics/trip-reconciliation');

  await page.getByRole('button', { name: /TRP-20260805-00001/ }).click();

  await expect(page.getByText('Không giao được')).toBeVisible();
  await expect(page.getByText('1.000000000000', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Chốt đối soát & đóng chuyến' })).toBeDisabled();

  const quantity = page.getByLabel('Số lượng nhận lại BOT-001');
  await expect(quantity).toHaveValue('1.000000000000');
  await page.getByRole('button', { name: 'Xác nhận nhập hàng về kho' }).click();

  await expect(page.getByRole('status')).toContainText('Đã ghi nhận hàng quay về kho');
  await expect(page.getByRole('button', { name: 'Chốt đối soát & đóng chuyến' })).toBeEnabled();
});

import { expect, test, type Page, type Route } from '@playwright/test';

const tripId = '55555555-5555-4555-8555-555555555555';
const assignmentId = '88888888-8888-4888-8888-888888888888';

async function fulfill(route: Route, data: unknown, status = 200) {
  await route.fulfill({ status, json: { data, requestId: 'e2e-phase-6e4' } });
}

async function mockAttemptApis(page: Page) {
  await page.route('**/api/logistics/trips?status=all', (route) => fulfill(route, [{
    id: tripId,
    number: 'TRP-20260804-00001',
    warehouseId: '11111111-1111-4111-8111-111111111111',
    warehouseCode: 'KHO-CHINH',
    warehouseName: 'Kho chính',
    vehicleId: '33333333-3333-4333-8333-333333333333',
    vehicleCode: 'XE-01',
    licensePlate: '51C-12345',
    primaryDriverId: '44444444-4444-4444-8444-444444444444',
    driverCode: 'TX-01',
    driverName: 'Nguyễn Văn Tài',
    plannedStartAt: '2026-08-05T01:00:00.000Z',
    dispatchedAt: '2026-08-05T01:15:00.000Z',
    status: 'dispatched',
    stopCount: 1,
    assignmentCount: 2,
  }]));
  await page.route(`**/api/logistics/trips/${tripId}/attempts`, async (route) => {
    expect(route.request().method()).toBe('GET');
    await fulfill(route, {
      trip: {
        id: tripId,
        number: 'TRP-20260804-00001',
        status: 'dispatched',
        warehouseId: '11111111-1111-4111-8111-111111111111',
      },
      attempts: [{
        id: '99999999-9999-4999-8999-999999999999',
        tripId,
        stopId: '66666666-6666-4666-8666-666666666666',
        stopSequence: 1,
        assignmentId,
        deliveryOrderId: '77777777-7777-4777-8777-777777777777',
        deliveryOrderNumber: 'DO-202608-000010',
        customerCode: 'KH-001',
        customerName: 'Cửa hàng Minh Anh',
        driverProfileId: '44444444-4444-4444-8444-444444444444',
        result: 'delivered_partial',
        attemptedAt: '2026-08-05T03:00:00.000Z',
        reasonCode: null,
        note: 'Khách nhận một phần',
        rescheduledFor: null,
      }],
    });
  });
}

test('điều phối chỉ đọc kết quả lần giao và thấy hàng còn trên xe', async ({ page }) => {
  await mockAttemptApis(page);
  await page.goto('/logistics/delivery-attempts');

  await expect(page.getByTestId('delivery-attempt-workspace')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Theo dõi kết quả lần giao' })).toBeVisible();
  await expect(page.getByText('Đọc kết quả tài xế đã ghi; không ghi thay tài xế và không tự nhập hàng về kho.')).toBeVisible();

  await page.getByTestId(`attempt-trip-${tripId}`).click();
  const summary = page.getByTestId('attempt-summary-list');
  await expect(summary).toContainText('DO-202608-000010');
  await expect(summary).toContainText('Cửa hàng Minh Anh');
  await expect(summary).toContainText('Giao một phần');
  await expect(summary).toContainText('Khách nhận một phần');
  await expect(page.getByText('1/2 phiếu')).toBeVisible();
  await expect(page.getByText(/không tạo Inventory IN/)).toBeVisible();

  await expect(page.getByRole('button', { name: /ghi kết quả|giao đủ|giao một phần|không giao được|hẹn giao lại/i })).toHaveCount(0);
});

import { test, expect, type Page, type Route } from '@playwright/test';

const warehouseId = '11111111-1111-4111-8111-111111111111';
const vehicleId = '33333333-3333-4333-8333-333333333333';
const driverId = '44444444-4444-4444-8444-444444444444';
const tripId = '55555555-5555-4555-8555-555555555555';
const stopId = '66666666-6666-4666-8666-666666666666';
const deliveryOrderId = '77777777-7777-4777-8777-777777777777';
const assignmentId = '88888888-8888-4888-8888-888888888888';
const issueId = '99999999-9999-4999-8999-999999999999';
const movementId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const dispatchId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

async function fulfill(route: Route, data: unknown, status = 200) {
  await route.fulfill({ status, json: { data, requestId: 'e2e-phase-6e2' } });
}

type State = {
  status: 'locked' | 'dispatched';
  dispatchedAt: string | null;
  receiverName: string | null;
  key: string | null;
  payload: Record<string, unknown> | null;
};

function tripListItem(state: State) {
  return {
    id: tripId,
    number: 'TRP-20260804-00001',
    warehouseId,
    warehouseCode: 'KHO-CHINH',
    warehouseName: 'Kho chính',
    vehicleId,
    vehicleCode: 'XE-01',
    licensePlate: '51C-12345',
    primaryDriverId: driverId,
    driverCode: 'TX-01',
    driverName: 'Nguyễn Văn Tài',
    plannedStartAt: '2026-08-05T01:00:00.000Z',
    status: state.status,
    stopCount: 1,
    assignmentCount: 1,
  };
}

function tripDetail(state: State) {
  return {
    ...tripListItem(state),
    dispatchId: state.status === 'dispatched' ? dispatchId : null,
    handoverReceiverName: state.receiverName,
    handoverNote: state.status === 'dispatched' ? 'Đã kiểm đủ kiện hàng' : null,
    dispatchedAt: state.dispatchedAt,
    dispatchedBy: state.status === 'dispatched' ? 'test:bootstrap' : null,
    stops: [{
      id: stopId,
      sequence: 1,
      customerId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      customerAddressId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      address: { fullAddress: '12 Nguyễn Trãi, Quận 1' },
      plannedArrivalAt: null,
      assignments: [{
        assignmentId,
        deliveryOrderId,
        deliveryOrderNumber: 'DO-202608-000010',
        customerCode: 'KH-001',
        customerName: 'Cửa hàng Minh Anh',
      }],
    }],
    dispatchItems: state.status === 'dispatched' ? [{
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      dispatchId,
      assignmentId,
      stopId,
      deliveryOrderId,
      deliveryOrderNumber: 'DO-202608-000010',
      customerCode: 'KH-001',
      customerName: 'Cửa hàng Minh Anh',
      inventoryIssueId: issueId,
      inventoryIssueStatus: 'POSTED',
      inventoryMovementId: movementId,
      movementType: 'SALES_DELIVERY_ISSUE',
      documentDate: '2026-08-05',
      postedAt: state.dispatchedAt,
    }] : [],
  };
}

async function mockDispatchApis(page: Page, state: State) {
  await page.route('**/api/logistics/trips?status=all', (route) => fulfill(route, [tripListItem(state)]));
  await page.route(`**/api/logistics/trips/${tripId}/dispatch`, async (route) => {
    if (route.request().method() === 'POST') {
      state.key = route.request().headers()['idempotency-key'] || null;
      state.payload = route.request().postDataJSON() as Record<string, unknown>;
      state.status = 'dispatched';
      state.dispatchedAt = String(state.payload.dispatchedAt);
      state.receiverName = String(state.payload.handoverReceiverName);
      await fulfill(route, { ok: true, replayed: false, trip: tripDetail(state) });
      return;
    }
    await fulfill(route, tripDetail(state));
  });
}

test('kho bàn giao chuyến đã khóa, ghi Inventory OUT và chuyển sang read-only', async ({ page }) => {
  const state: State = {
    status: 'locked',
    dispatchedAt: null,
    receiverName: null,
    key: null,
    payload: null,
  };
  await mockDispatchApis(page, state);
  await page.goto('/logistics/dispatch');

  await expect(page.getByTestId('trip-dispatch-workspace')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Bàn giao và cho xe xuất phát' })).toBeVisible();
  await expect(page.getByRole('button', { name: /giao thành công|giao thất bại|POD|GPS|COD/i })).toHaveCount(0);

  await page.getByTestId(`dispatch-trip-${tripId}`).click();
  await expect(page.getByTestId('dispatch-form')).toBeVisible();
  await expect(page.getByText('DO-202608-000010', { exact: false })).toBeVisible();

  await page.getByTestId('handover-receiver').fill('Nguyễn Văn Tài');
  await page.getByTestId('dispatch-time').fill('2026-08-05T08:00');
  await page.getByTestId('dispatch-trip-button').click();

  await expect(page.getByTestId('dispatched-read-only')).toBeVisible();
  await expect(page.getByTestId('dispatch-movement-list')).toContainText('DO-202608-000010');
  await expect(page.getByTestId('dispatch-movement-list')).toContainText(movementId);
  await expect(page.getByText('Đã bàn giao 1 phiếu và cho chuyến xuất phát.')).toBeVisible();
  await expect(page.getByTestId('dispatch-trip-button')).toHaveCount(0);

  expect(state.key).toMatch(/^web-trip-dispatch-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(state.key).toMatch(/^[A-Za-z0-9._-]{1,128}$/);
  expect(state.key).not.toContain(':');
  expect(state.payload?.handoverReceiverName).toBe('Nguyễn Văn Tài');
  expect(String(state.payload?.dispatchedAt)).toMatch(/^2026-08-05T/);
});

import { test, expect, type Page, type Route } from '@playwright/test';

const warehouseId = '11111111-1111-4111-8111-111111111111';
const routeId = '22222222-2222-4222-8222-222222222222';
const vehicleId = '33333333-3333-4333-8333-333333333333';
const driverId = '44444444-4444-4444-8444-444444444444';
const tripId = '55555555-5555-4555-8555-555555555555';
const stopId = '66666666-6666-4666-8666-666666666666';
const deliveryOrderId = '77777777-7777-4777-8777-777777777777';

async function fulfill(route: Route, data: unknown, status = 200) {
  await route.fulfill({ status, json: { data, requestId: 'e2e-g1-lifecycle' } });
}

type State = { status: 'draft' | 'planned' | 'locked'; revision: number };

function trip(state: State) {
  return {
    id: tripId,
    number: 'TRP-20260813-00001',
    warehouseId,
    warehouseCode: 'KHO-CHINH',
    warehouseName: 'Kho chính',
    deliveryRouteId: routeId,
    routeCode: 'TUYEN-Q1',
    routeName: 'Tuyến Quận 1',
    vehicleId,
    vehicleCode: 'XE-01',
    licensePlate: '51C-12345',
    primaryDriverId: driverId,
    driverCode: 'TX-01',
    driverName: 'Nguyễn Văn Tài',
    plannedStartAt: '2026-08-13T01:00:00.000Z',
    status: state.status,
    note: 'G1 lifecycle',
    revision: String(state.revision),
    stopCount: 1,
    assignmentCount: 1,
    stops: [{
      id: stopId,
      sequence: 1,
      customerId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      customerAddressId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      address: { fullAddress: '12 Nguyễn Trãi, Quận 1' },
      plannedArrivalAt: null,
      assignments: [{
        assignmentId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        deliveryOrderId,
        deliveryOrderNumber: 'DO-202608-000010',
        customerCode: 'KH-001',
        customerName: 'Cửa hàng Minh Anh',
        requestedDeliveryDate: '2026-08-13',
        collectionPolicy: 'PREPAID',
      }],
    }],
  };
}

async function mockApis(page: Page, state: State) {
  await page.route('**/api/logistics/warehouses', (route) => fulfill(route, [
    { id: warehouseId, code: 'KHO-CHINH', name: 'Kho chính' },
  ]));
  await page.route('**/api/logistics/routes?**', (route) => fulfill(route, [
    { id: routeId, code: 'TUYEN-Q1', name: 'Tuyến Quận 1', defaultWarehouseId: warehouseId, isActive: true },
  ]));
  await page.route('**/api/logistics/vehicles?**', (route) => fulfill(route, [
    { id: vehicleId, code: 'XE-01', licensePlate: '51C-12345', vehicleType: 'Xe tải nhỏ', operationalStatus: 'AVAILABLE', isActive: true },
  ]));
  await page.route('**/api/logistics/drivers?**', (route) => fulfill(route, [
    { id: driverId, code: 'TX-01', name: 'Nguyễn Văn Tài', phone: '0900000000', isActive: true },
  ]));
  await page.route('**/api/logistics/eligible-delivery-orders**', (route) => fulfill(route, [
    {
      id: deliveryOrderId,
      number: 'DO-202608-000010',
      salesOrderId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
      warehouseId,
      warehouseCode: 'KHO-CHINH',
      warehouseName: 'Kho chính',
      customerId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      customerAddressId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      customerCode: 'KH-001',
      customerName: 'Cửa hàng Minh Anh',
      destination: { fullAddress: '12 Nguyễn Trãi, Quận 1' },
      requestedDeliveryDate: '2026-08-13',
      collectionPolicy: 'PREPAID',
      lineCount: 1,
      totalBaseQuantity: '3.000000000000',
    },
  ]));
  await page.route('**/api/logistics/trips', (route) => fulfill(route, [trip(state)]));
  await page.route(`**/api/logistics/trips/${tripId}`, (route) => fulfill(route, trip(state)));
  await page.route(`**/api/logistics/trips/${tripId}/*`, async (route) => {
    const action = route.request().url().split('/').at(-1);
    if (action === 'reopen') state.status = 'draft';
    state.revision += 1;
    await fulfill(route, { ok: true, replayed: false, trip: trip(state) });
  });
}

test('G1 planned chỉ đọc; reopen mới cho sửa và gán chuyến lại', async ({ page }) => {
  const state: State = { status: 'planned', revision: 2 };
  await mockApis(page, state);
  await page.goto('/logistics/trips');

  await page.getByRole('button', { name: /TRP-20260813-00001/ }).first().click();
  await expect(page.getByTestId('planned-read-only')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Lưu kế hoạch' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Bỏ khỏi chuyến' })).toHaveCount(0);
  await expect(page.getByLabel('Đưa điểm giao lên')).toHaveCount(0);
  await expect(page.getByTestId('trip-vehicle')).toBeDisabled();
  await expect(page.getByTestId('trip-driver')).toBeDisabled();
  await expect(page.getByTestId('reopen-trip-button')).toBeVisible();
  await expect(page.getByTestId('lock-trip-button')).toBeVisible();

  await page.getByTestId('assignment-tab').click();
  await page.getByTestId('assignment-route').selectOption(routeId);
  await expect(page.getByTestId('assignment-trip').locator(`option[value="${tripId}"]`)).toHaveCount(0);

  await page.getByTestId('planning-tab').click();
  await page.getByRole('button', { name: /TRP-20260813-00001/ }).first().click();
  await page.getByTestId('reopen-trip-button').click();
  await expect(page.getByTestId('planned-read-only')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Lưu kế hoạch' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Bỏ khỏi chuyến' })).toBeVisible();
  await expect(page.getByTestId('trip-vehicle')).toBeEnabled();
  await expect(page.getByTestId('trip-driver')).toBeEnabled();

  await page.getByTestId('assignment-tab').click();
  await page.getByTestId('assignment-route').selectOption(routeId);
  await expect(page.getByTestId('assignment-trip').locator(`option[value="${tripId}"]`)).toHaveCount(1);
});

import { test, expect, type Page, type Route } from '@playwright/test';

const warehouseId = '11111111-1111-4111-8111-111111111111';
const routeId = '22222222-2222-4222-8222-222222222222';
const vehicleId = '33333333-3333-4333-8333-333333333333';
const driverId = '44444444-4444-4444-8444-444444444444';
const tripId = '55555555-5555-4555-8555-555555555555';
const stopId = '66666666-6666-4666-8666-666666666666';
const deliveryOrderId = '77777777-7777-4777-8777-777777777777';
const assignmentId = '88888888-8888-4888-8888-888888888888';

async function fulfill(route: Route, data: unknown, status = 200) {
  await route.fulfill({ status, json: { data, requestId: 'e2e-phase-6e1' } });
}

type State = {
  created: boolean;
  assigned: boolean;
  status: 'draft' | 'planned' | 'locked';
  revision: number;
  keys: string[];
};

function eligibleOrder() {
  return {
    id: deliveryOrderId,
    number: 'DO-202608-000010',
    salesOrderId: '99999999-9999-4999-8999-999999999999',
    warehouseId,
    warehouseCode: 'KHO-CHINH',
    warehouseName: 'Kho chính',
    customerId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    customerAddressId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    customerCode: 'KH-001',
    customerName: 'Cửa hàng Minh Anh',
    destination: { fullAddress: '12 Nguyễn Trãi, Quận 1' },
    requestedDeliveryDate: '2026-08-05',
    collectionPolicy: 'PREPAID',
    lineCount: 1,
    totalBaseQuantity: '3.000000000000',
  };
}

function trip(state: State) {
  return {
    id: tripId,
    number: 'TRP-20260804-00001',
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
    plannedStartAt: '2026-08-05T01:00:00.000Z',
    status: state.status,
    note: 'Chuyến sáng',
    revision: String(state.revision),
    stopCount: state.assigned ? 1 : 0,
    assignmentCount: state.assigned ? 1 : 0,
    stops: state.assigned ? [{
      id: stopId,
      sequence: 1,
      customerId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      customerAddressId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      address: { fullAddress: '12 Nguyễn Trãi, Quận 1' },
      plannedArrivalAt: null,
      assignments: [{
        assignmentId,
        deliveryOrderId,
        deliveryOrderNumber: 'DO-202608-000010',
        customerCode: 'KH-001',
        customerName: 'Cửa hàng Minh Anh',
        requestedDeliveryDate: '2026-08-05',
        collectionPolicy: 'PREPAID',
      }],
    }] : [],
  };
}

async function mockLogisticsApis(page: Page, state: State) {
  await page.route('**/api/logistics/routes?**', (route) => fulfill(route, [{
    id: routeId,
    code: 'TUYEN-Q1',
    name: 'Tuyến Quận 1',
    defaultWarehouseId: warehouseId,
    isActive: true,
  }]));
  await page.route('**/api/logistics/vehicles?**', (route) => fulfill(route, [{
    id: vehicleId,
    code: 'XE-01',
    licensePlate: '51C-12345',
    vehicleType: 'Xe tải nhỏ',
    operationalStatus: 'AVAILABLE',
    isActive: true,
  }]));
  await page.route('**/api/logistics/drivers?**', (route) => fulfill(route, [{
    id: driverId,
    code: 'TX-01',
    name: 'Nguyễn Văn Tài',
    phone: '0900000000',
    isActive: true,
  }]));
  await page.route('**/api/logistics/eligible-delivery-orders**', (route) => {
    fulfill(route, state.assigned ? [] : [eligibleOrder()]);
  });
  await page.route('**/api/logistics/trips', async (route) => {
    if (route.request().method() === 'POST') {
      state.created = true;
      state.keys.push(route.request().headers()['idempotency-key'] || '');
      await fulfill(route, { ok: true, replayed: false, trip: trip(state) }, 201);
      return;
    }
    await fulfill(route, state.created ? [trip(state)] : []);
  });
  await page.route(`**/api/logistics/trips/${tripId}`, async (route) => {
    if (route.request().method() === 'PUT') {
      state.revision += 1;
      state.keys.push(route.request().headers()['idempotency-key'] || '');
      await fulfill(route, { ok: true, replayed: false, trip: trip(state) });
      return;
    }
    await fulfill(route, trip(state));
  });
  await page.route(`**/api/logistics/trips/${tripId}/*`, async (route) => {
    const action = route.request().url().split('/').at(-1);
    state.keys.push(route.request().headers()['idempotency-key'] || '');
    if (action === 'assign') state.assigned = true;
    if (action === 'plan') state.status = 'planned';
    if (action === 'lock') state.status = 'locked';
    if (action === 'reopen') state.status = 'draft';
    if (action === 'unassign') state.assigned = false;
    state.revision += 1;
    await fulfill(route, { ok: true, replayed: false, trip: trip(state) });
  });
}

test('điều phối viên tạo, gán, lập và khóa chuyến; locked state chỉ đọc', async ({ page }) => {
  const state: State = { created: false, assigned: false, status: 'draft', revision: 1, keys: [] };
  await mockLogisticsApis(page, state);
  await page.goto('/logistics/trips');

  await expect(page.getByTestId('trip-planning-workspace')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Điều phối giao hàng' })).toBeVisible();
  await expect(page.getByRole('button', { name: /dispatch|xuất kho|ghi kết quả giao|POD/i })).toHaveCount(0);

  await page.getByTestId('create-trip-button').click();
  await expect(page.getByText('TRP-20260804-00001', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('DO-202608-000010', { exact: true }).first()).toBeVisible();

  await page.getByTestId(`assign-${deliveryOrderId}`).click();
  await expect(page.getByTestId('trip-stop-list')).toContainText('12 Nguyễn Trãi');
  await expect(page.getByTestId('trip-stop-list')).toContainText('DO-202608-000010');

  await page.getByTestId('plan-trip-button').click();
  await expect(page.getByText('Đã lập kế hoạch', { exact: true }).first()).toBeVisible();
  await page.getByTestId('lock-trip-button').click();

  await expect(page.getByTestId('locked-read-only')).toBeVisible();
  await expect(page.getByTestId('locked-read-only')).toContainText('chỉ được đọc');
  await expect(page.getByRole('button', { name: 'Lưu kế hoạch' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Gán vào chuyến' })).toHaveCount(0);
  expect(state.keys).toHaveLength(4);
  for (const key of state.keys) expect(key).toMatch(/^web-logistics-/);
});

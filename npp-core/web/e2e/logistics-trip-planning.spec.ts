import { test, expect, type Page, type Route } from '@playwright/test';

const warehouseId = '11111111-1111-4111-8111-111111111111';
const emptyWarehouseId = '10101010-1010-4010-8010-101010101010';
const routeId = '22222222-2222-4222-8222-222222222222';
const vehicleId = '33333333-3333-4333-8333-333333333333';
const driverId = '44444444-4444-4444-8444-444444444444';
const employeeId = '12121212-1212-4121-8121-121212121212';
const tripId = '55555555-5555-4555-8555-555555555555';
const stopId = '66666666-6666-4666-8666-666666666666';
const deliveryOrderIdA = '77777777-7777-4777-8777-777777777777';
const deliveryOrderIdB = '88888888-8888-4888-8888-888888888888';
const missingNumberOrderId = '99999999-9999-4999-8999-999999999999';

async function fulfill(route: Route, data: unknown, status = 200) {
  await route.fulfill({ status, json: { data, requestId: 'e2e-trip-batch' } });
}

async function fulfillError(route: Route, code: string, message: string, status = 400) {
  await route.fulfill({ status, json: { error: { code, message, retryable: status >= 500, details: {} }, requestId: 'e2e-trip-batch' } });
}

type State = {
  created: boolean;
  assignedIds: string[];
  status: 'draft' | 'planned' | 'locked';
  revision: number;
  keys: string[];
  assignPayloads: Array<{ deliveryOrderIds?: string[] }>;
  failNextAssign?: boolean;
};

function eligibleOrders() {
  return [
    {
      id: deliveryOrderIdA, number: 'DO-202608-000010', salesOrderId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', warehouseId,
      warehouseCode: 'KHO-CHINH', warehouseName: 'Kho chính', customerId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      customerAddressId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', customerCode: 'KH-001', customerName: 'Cửa hàng Minh Anh',
      destination: { fullAddress: '12 Nguyễn Trãi, Quận 1' }, requestedDeliveryDate: '2026-08-05', collectionPolicy: 'PREPAID', lineCount: 1, totalBaseQuantity: '3.000000000000',
    },
    {
      id: deliveryOrderIdB, number: 'DO-202608-000011', salesOrderId: 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa', warehouseId,
      warehouseCode: 'KHO-CHINH', warehouseName: 'Kho chính', customerId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      customerAddressId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', customerCode: 'KH-001', customerName: 'Cửa hàng Minh Anh',
      destination: { fullAddress: '12 Nguyễn Trãi, Quận 1' }, requestedDeliveryDate: '2026-08-05', collectionPolicy: 'PREPAID', lineCount: 1, totalBaseQuantity: '2.000000000000',
    },
    {
      id: missingNumberOrderId, number: null, salesOrderId: 'aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa', warehouseId,
      warehouseCode: 'KHO-CHINH', warehouseName: 'Kho chính', customerId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      customerAddressId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', customerCode: 'KH-002', customerName: 'Khách thiếu numbering',
      destination: { fullAddress: '20 Lê Lợi, Quận 1' }, requestedDeliveryDate: '2026-08-05', collectionPolicy: 'PREPAID', lineCount: 1, totalBaseQuantity: '1.000000000000',
    },
  ];
}

function trip(state: State) {
  const assigned = eligibleOrders().filter((order) => state.assignedIds.includes(order.id));
  return {
    id: tripId, number: 'TRP-20260804-00001', warehouseId, warehouseCode: 'KHO-CHINH', warehouseName: 'Kho chính',
    deliveryRouteId: routeId, routeCode: 'TUYEN-Q1', routeName: 'Tuyến Quận 1', vehicleId, vehicleCode: 'XE-01', licensePlate: '51C-12345',
    primaryDriverId: driverId, driverCode: 'TX-01', driverName: 'Nguyễn Văn Tài', plannedStartAt: '2026-08-05T01:00:00.000Z',
    status: state.status, note: 'Chuyến sáng', revision: String(state.revision), stopCount: assigned.length ? 1 : 0, assignmentCount: assigned.length,
    stops: assigned.length ? [{
      id: stopId, sequence: 1, customerId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', customerAddressId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      address: { fullAddress: '12 Nguyễn Trãi, Quận 1' }, plannedArrivalAt: null,
      assignments: assigned.map((order, index) => ({
        assignmentId: `eeeeeeee-eeee-4eee-8ee${index}-eeeeeeeeeee${index}`,
        deliveryOrderId: order.id,
        deliveryOrderNumber: order.number,
        customerCode: order.customerCode,
        customerName: order.customerName,
        requestedDeliveryDate: order.requestedDeliveryDate,
        collectionPolicy: order.collectionPolicy,
      })),
    }] : [],
  };
}

function makeState(overrides: Partial<State> = {}): State {
  return { created: true, assignedIds: [], status: 'draft', revision: 1, keys: [], assignPayloads: [], ...overrides };
}

async function mockLogisticsApis(page: Page, state: State) {
  await page.route('**/api/logistics/warehouses', (route) => fulfill(route, [
    { id: warehouseId, code: 'KHO-CHINH', name: 'Kho chính' },
    { id: emptyWarehouseId, code: 'KHO-MOI', name: 'Kho mới chưa phát sinh' },
  ]));
  await page.route('**/api/logistics/routes?**', (route) => fulfill(route, [{ id: routeId, code: 'TUYEN-Q1', name: 'Tuyến Quận 1', defaultWarehouseId: warehouseId, isActive: true }]));
  await page.route('**/api/logistics/vehicles?**', (route) => fulfill(route, [{ id: vehicleId, code: 'XE-01', licensePlate: '51C-12345', vehicleType: 'Xe tải nhỏ', operationalStatus: 'AVAILABLE', isActive: true }]));
  await page.route('**/api/logistics/drivers?**', (route) => fulfill(route, [{ id: driverId, employeeId, code: 'TX-01', name: 'Nguyễn Văn Tài', phone: '0900000000', isActive: true }]));
  await page.route('**/api/logistics/eligible-delivery-orders**', (route) => fulfill(route, eligibleOrders().filter((order) => !state.assignedIds.includes(order.id))));
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
    const key = route.request().headers()['idempotency-key'] || '';
    state.keys.push(key);
    if (action === 'assign') {
      const payload = route.request().postDataJSON() as { deliveryOrderIds?: string[] };
      state.assignPayloads.push(payload);
      if (state.failNextAssign) {
        state.failNextAssign = false;
        await fulfillError(route, 'DELIVERY_TRIP_TRANSACTION_FAILED', 'Thử lại thao tác gán chuyến', 503);
        return;
      }
      state.assignedIds = [...(payload.deliveryOrderIds ?? [])];
    }
    if (action === 'plan') state.status = 'planned';
    if (action === 'lock') state.status = 'locked';
    if (action === 'reopen') state.status = 'draft';
    if (action === 'unassign') {
      const payload = route.request().postDataJSON() as { deliveryOrderId?: string };
      state.assignedIds = state.assignedIds.filter((id) => id !== payload.deliveryOrderId);
    }
    state.revision += 1;
    await fulfill(route, { ok: true, replayed: false, assignmentCount: action === 'assign' ? state.assignedIds.length : undefined, trip: trip(state) });
  });
}

test('canonical warehouse selector includes active warehouse without balance/order/trip', async ({ page }) => {
  const state = makeState({ created: false });
  await mockLogisticsApis(page, state);
  await page.goto('/logistics/trips');
  const selector = page.getByTestId('trip-warehouse');
  await expect(selector).toBeVisible();
  await expect(selector.locator(`option[value="${emptyWarehouseId}"]`)).toHaveText('KHO-MOI · Kho mới chưa phát sinh');
  await selector.selectOption(emptyWarehouseId);
  await expect(selector).toHaveValue(emptyWarehouseId);
});

test('Gán chuyến đi đúng Tuyến → Chuyến → tích nhiều đơn → một batch request và chỉ hiện TRP/DO canonical', async ({ page }) => {
  const state = makeState();
  await mockLogisticsApis(page, state);
  await page.goto('/logistics/trips');

  await expect(page.getByTestId('planning-tab')).toBeVisible();
  await page.getByTestId('assignment-tab').click();
  await page.getByTestId('assignment-route').selectOption(routeId);
  await page.getByTestId('assignment-trip').selectOption(tripId);

  await expect(page.getByText('TRP-20260804-00001', { exact: true })).toBeVisible();
  await expect(page.getByText('DO-202608-000010', { exact: true })).toBeVisible();
  await expect(page.getByText('DO-202608-000011', { exact: true })).toBeVisible();
  await expect(page.getByText('Thiếu mã phiếu giao', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Phiếu giao thiếu mã canonical')).toBeDisabled();

  await page.getByLabel('Chọn DO-202608-000010').check();
  await page.getByLabel('Chọn DO-202608-000011').check();
  await expect(page.getByTestId('assign-selected-orders')).toHaveText('Gán 2 đơn');
  await page.getByTestId('assign-selected-orders').click();

  expect(state.assignPayloads).toEqual([{ deliveryOrderIds: [deliveryOrderIdA, deliveryOrderIdB] }]);
  const assignKey = state.keys.at(-1) || '';
  expect(assignKey).toMatch(/^[A-Za-z0-9._-]{1,128}$/);
  expect(assignKey).not.toContain(':');
  await expect(page.getByText('Đã gán 2 phiếu giao vào chuyến TRP-20260804-00001.')).toBeVisible();

  const visibleText = await page.locator('body').innerText();
  expect(visibleText).not.toContain(tripId);
  expect(visibleText).not.toContain(deliveryOrderIdA);
  expect(visibleText).not.toContain(deliveryOrderIdB);
  expect(visibleText).not.toContain(missingNumberOrderId);
});

test('batch retry giữ nguyên Idempotency-Key sau lỗi retryable', async ({ page }) => {
  const state = makeState({ failNextAssign: true });
  await mockLogisticsApis(page, state);
  await page.goto('/logistics/trips');
  await page.getByTestId('assignment-tab').click();
  await page.getByTestId('assignment-route').selectOption(routeId);
  await page.getByTestId('assignment-trip').selectOption(tripId);
  await page.getByLabel('Chọn DO-202608-000010').check();

  await page.getByTestId('assign-selected-orders').click();
  await expect(page.getByText('Thử lại thao tác gán chuyến')).toBeVisible();
  await page.getByTestId('assign-selected-orders').click();
  await expect(page.getByText('Đã gán 1 phiếu giao vào chuyến TRP-20260804-00001.')).toBeVisible();

  expect(state.assignPayloads).toHaveLength(2);
  expect(state.assignPayloads[0]).toEqual(state.assignPayloads[1]);
  expect(state.keys.at(-2)).toBe(state.keys.at(-1));
  expect(state.keys.at(-1)).toMatch(/^[A-Za-z0-9._-]{1,128}$/);
});

test('điều phối viên tạo chuyến, gán batch, lập và khóa; locked state chỉ đọc', async ({ page }) => {
  const state = makeState({ created: false });
  await mockLogisticsApis(page, state);
  await page.goto('/logistics/trips');
  await expect(page.getByTestId('trip-planning-workspace')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Điều phối giao hàng' })).toBeVisible();
  await expect(page.getByRole('button', { name: /dispatch|xuất kho|ghi kết quả giao|POD/i })).toHaveCount(0);

  await page.getByTestId('create-trip-button').click();
  await expect(page.getByText('TRP-20260804-00001', { exact: true }).first()).toBeVisible();
  await page.getByTestId('assignment-tab').click();
  await page.getByTestId('assignment-route').selectOption(routeId);
  await page.getByTestId('assignment-trip').selectOption(tripId);
  await page.getByLabel('Chọn DO-202608-000010').check();
  await page.getByTestId('assign-selected-orders').click();

  await page.getByTestId('planning-tab').click();
  await page.getByRole('button', { name: /TRP-20260804-00001/ }).first().click();
  await expect(page.getByTestId('trip-stop-list')).toContainText('12 Nguyễn Trãi');
  await page.getByTestId('plan-trip-button').click();
  await expect(page.getByText('Đã lập kế hoạch', { exact: true }).first()).toBeVisible();
  await page.getByTestId('lock-trip-button').click();
  await expect(page.getByTestId('locked-read-only')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Lưu kế hoạch' })).toHaveCount(0);
  for (const key of state.keys) expect(key).toMatch(/^[A-Za-z0-9._-]{1,128}$/);
});

test('vehicle và driver dùng đúng contract; driver bắt buộc chọn canonical employee', async ({ page }) => {
  const state = makeState({ created: false });
  await mockLogisticsApis(page, state);
  let vehiclePayload: Record<string, unknown> | null = null;
  let driverPayload: Record<string, unknown> | null = null;
  let employees = [{ id: employeeId, code: 'NV-002', fullName: 'Tài xế mới', jobTitle: 'Tài xế', phone: '0900000002', branchId: null, isActive: true }];
  await page.route('**/api/logistics/vehicles', async (route) => {
    vehiclePayload = route.request().postDataJSON();
    await fulfillError(route, 'INVALID_VEHICLE', 'Vehicle payload is invalid');
  });
  await page.route('**/api/logistics/driver-employees?**', (route) => fulfill(route, employees));
  await page.route('**/api/logistics/drivers', async (route) => {
    driverPayload = route.request().postDataJSON();
    employees = [];
    await fulfill(route, { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', employeeId, code: 'NV-002', name: 'Tài xế mới', phone: '0900000002', isActive: true }, 201);
  });
  await page.goto('/logistics/trips');

  await page.getByLabel('Mã xe').fill('XE-02');
  await page.getByLabel('Biển số').fill('51C-99999');
  await expect(page.getByTestId('create-vehicle')).toBeDisabled();
  await page.getByLabel('Loại xe').fill('Xe tải');
  await page.getByTestId('create-vehicle').click();
  await expect(page.getByText('Vehicle payload is invalid')).toBeVisible();
  await expect(page.getByText('Kiểm tra biển số theo hợp đồng API.')).toBeVisible();
  expect(vehiclePayload).toEqual({ code: 'XE-02', licensePlate: '51C-99999', vehicleType: 'Xe tải' });

  await expect(page.getByLabel('Mã tài xế')).toHaveCount(0);
  await expect(page.getByLabel('Tên tài xế')).toHaveCount(0);
  const employeeSelect = page.getByTestId('driver-employee');
  await employeeSelect.focus();
  await expect(employeeSelect.locator(`option[value="${employeeId}"]`)).toHaveText('NV-002 · Tài xế mới · Tài xế');
  await employeeSelect.selectOption(employeeId);
  await expect(page.getByTestId('driver-employee-canonical')).toContainText('NV-002 · Tài xế mới · 0900000002');
  await page.getByLabel('Thông tin bằng lái').fill('B2-002');
  await page.getByTestId('create-driver').click();
  await expect(page.getByText('Đã liên kết nhân sự với hồ sơ tài xế.')).toBeVisible();
  expect(driverPayload).toEqual({ employeeId, licenseReference: 'B2-002' });
  await expect(employeeSelect.locator(`option[value="${employeeId}"]`)).toHaveCount(0);
});

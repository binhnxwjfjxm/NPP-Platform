import { test, expect, type Route } from '@playwright/test';

const warehouseId = '11111111-1111-4111-8111-111111111111';
const vehicleId = '33333333-3333-4333-8333-333333333333';
const driverId = '44444444-4444-4444-8444-444444444444';
const tripId = '55555555-5555-4555-8555-555555555555';

async function fulfill(route: Route, data: unknown, status = 200) {
  await route.fulfill({ status, json: { data, requestId: 'e2e-g2-no-auto-assignment' } });
}

function draftTrip() {
  return {
    id: tripId,
    number: 'TRP-20260813-00001',
    warehouseId,
    warehouseCode: 'KHO-CHINH',
    warehouseName: 'Kho chính',
    deliveryRouteId: null,
    routeCode: null,
    routeName: null,
    vehicleId: null,
    vehicleCode: null,
    licensePlate: null,
    primaryDriverId: null,
    driverCode: null,
    driverName: null,
    plannedStartAt: null,
    status: 'draft' as const,
    note: null,
    revision: '1',
    stopCount: 0,
    assignmentCount: 0,
    stops: [],
  };
}

test('G2 giữ xe và tài xế trống qua load/reload, chỉ dùng lựa chọn explicit và create gửi null khi để trống', async ({ page }) => {
  let created = false;
  let createObserved = false;
  let createdVehicleId: unknown;
  let createdPrimaryDriverId: unknown;

  await page.route('**/api/logistics/warehouses', (route) => fulfill(route, [
    { id: warehouseId, code: 'KHO-CHINH', name: 'Kho chính' },
  ]));
  await page.route('**/api/logistics/routes?**', (route) => fulfill(route, []));
  await page.route('**/api/logistics/vehicles?**', (route) => fulfill(route, [
    { id: vehicleId, code: 'XE-01', licensePlate: '51C-12345', vehicleType: 'Xe tải nhỏ', operationalStatus: 'AVAILABLE', isActive: true },
  ]));
  await page.route('**/api/logistics/drivers?**', (route) => fulfill(route, [
    { id: driverId, code: 'TX-01', name: 'Nguyễn Văn Tài', phone: '0900000000', isActive: true },
  ]));
  await page.route('**/api/logistics/eligible-delivery-orders**', (route) => fulfill(route, []));
  await page.route(`**/api/logistics/trips/${tripId}`, (route) => fulfill(route, draftTrip()));
  await page.route('**/api/logistics/trips', async (route) => {
    if (route.request().method() === 'POST') {
      const payload = route.request().postDataJSON() as { vehicleId?: unknown; primaryDriverId?: unknown };
      createdVehicleId = payload.vehicleId;
      createdPrimaryDriverId = payload.primaryDriverId;
      createObserved = true;
      created = true;
      await fulfill(route, { trip: draftTrip() }, 201);
      return;
    }
    await fulfill(route, created ? [draftTrip()] : []);
  });

  await page.goto('/logistics/trips');

  const vehicle = page.getByTestId('trip-vehicle');
  const driver = page.getByTestId('trip-driver');
  await expect(vehicle).toHaveValue('');
  await expect(driver).toHaveValue('');

  await vehicle.selectOption(vehicleId);
  await driver.selectOption(driverId);
  await page.getByRole('button', { name: 'Tải lại' }).click();
  await expect(vehicle).toHaveValue(vehicleId);
  await expect(driver).toHaveValue(driverId);

  await vehicle.selectOption('');
  await driver.selectOption('');
  await page.getByRole('button', { name: 'Tải lại' }).click();
  await expect(vehicle).toHaveValue('');
  await expect(driver).toHaveValue('');

  await page.getByTestId('create-trip-button').click();
  expect(createObserved).toBe(true);
  expect(createdVehicleId).toBeNull();
  expect(createdPrimaryDriverId).toBeNull();
});

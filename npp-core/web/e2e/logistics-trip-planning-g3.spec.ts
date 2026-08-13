import { test, expect, type Route } from '@playwright/test';

const warehouseAId = '11111111-1111-4111-8111-111111111111';
const warehouseBId = '22222222-2222-4222-8222-222222222222';
const routeAId = '33333333-3333-4333-8333-333333333333';

async function fulfill(route: Route, data: unknown, status = 200) {
  await route.fulfill({ status, json: { data, requestId: 'e2e-g3-route-warehouse' } });
}

test('G3 route warehouse is explicit and trips only use routes from the selected warehouse', async ({ page }) => {
  let createdRouteWarehouseId: unknown;

  await page.route('**/api/logistics/warehouses', (route) => fulfill(route, [
    { id: warehouseAId, code: 'KHO-A', name: 'Kho A' },
    { id: warehouseBId, code: 'KHO-B', name: 'Kho B' },
  ]));
  await page.route('**/api/logistics/routes?**', (route) => fulfill(route, [
    { id: routeAId, code: 'R-A', name: 'Tuyen Kho A', defaultWarehouseId: warehouseAId, defaultWarehouseCode: 'KHO-A', defaultWarehouseName: 'Kho A', isActive: true },
  ]));
  await page.route('**/api/logistics/routes', async (route) => {
    createdRouteWarehouseId = (route.request().postDataJSON() as { defaultWarehouseId?: unknown }).defaultWarehouseId;
    await fulfill(route, { id: '44444444-4444-4444-8444-444444444444', code: 'R-B', name: 'Tuyen Kho B', defaultWarehouseId: warehouseBId, isActive: true }, 201);
  });
  await page.route('**/api/logistics/vehicles?**', (route) => fulfill(route, []));
  await page.route('**/api/logistics/drivers?**', (route) => fulfill(route, []));
  await page.route('**/api/logistics/eligible-delivery-orders**', (route) => fulfill(route, []));
  await page.route('**/api/logistics/trips', (route) => fulfill(route, []));

  await page.goto('/logistics/trips');

  await page.getByLabel('Mã tuyến').fill('R-B');
  await page.getByLabel('Tên tuyến').fill('Tuyen Kho B');
  await page.getByTestId('route-warehouse').selectOption(warehouseBId);
  await page.getByTestId('create-route').click();
  expect(createdRouteWarehouseId).toBe(warehouseBId);

  const tripWarehouse = page.getByTestId('trip-warehouse').first();
  const tripRoute = page.getByTestId('trip-route').first();
  await expect(tripWarehouse).toHaveValue(warehouseAId);
  await expect(tripRoute.locator(`option[value="${routeAId}"]`)).toHaveCount(1);
  await tripRoute.selectOption(routeAId);
  await tripWarehouse.selectOption(warehouseBId);
  await expect(tripRoute).toHaveValue('');
  await expect(tripRoute.locator(`option[value="${routeAId}"]`)).toHaveCount(0);
});

import { test, expect, type Page, type Route } from '@playwright/test';

type DeliveryOrderStatus = 'draft' | 'ready_to_dispatch' | 'cancelled';

type MockState = {
  status: DeliveryOrderStatus | null;
  cancellationReason: string | null;
  createKey: string | null;
  confirmKey: string | null;
  cancelKey: string | null;
};

const deliveryOrderId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const salesOrderId = '11111111-1111-4111-8111-111111111111';
const salesOrderVersionId = '22222222-2222-4222-8222-222222222222';
const allocationId = '33333333-3333-4333-8333-333333333333';
const warehouseId = '44444444-4444-4444-8444-444444444444';

const eligibility = {
  fulfillmentAllocationId: allocationId,
  fulfillmentDemandId: '55555555-5555-4555-8555-555555555555',
  salesOrderId,
  salesOrderNumber: 'SO-202608-000001',
  salesOrderVersionId,
  salesOrderLineId: '66666666-6666-4666-8666-666666666666',
  inventoryReservationId: '77777777-7777-4777-8777-777777777777',
  warehouseId,
  warehouseCode: 'KHO-CHINH',
  warehouseName: 'Kho chính',
  handoverMode: 'DELIVERY' as const,
  customerId: '88888888-8888-4888-8888-888888888888',
  customerCode: 'KH-001',
  customerName: 'Cửa hàng Minh Anh',
  customerAddressId: '99999999-9999-4999-8999-999999999999',
  destination: {
    label: 'Điểm bán Minh Anh',
    addressLine1: '12 Nguyễn Trãi',
    district: 'Quận 1',
    province: 'TP.HCM',
    countryCode: 'VN',
  },
  requestedDeliveryDate: '2026-08-05',
  collectionPolicy: 'COLLECT_ON_DELIVERY',
  locationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  locationCode: 'A-01-01',
  locationName: 'Kệ A-01-01',
  baseVariantId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  lotId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  lotCode: 'LOT-A-001',
  expiryDate: '2026-10-01',
  sku: 'BOT-A-25KG',
  itemName: 'Bột nguyên liệu A',
  unitCode: 'BAO',
  packedBaseQuantity: '3.000000000000',
  claimedBaseQuantity: '0.000000000000',
  availableForDeliveryOrderBaseQuantity: '3.000000000000',
  backorderedBaseQuantity: '1.000000000000',
};

function detail(state: MockState) {
  const status = state.status ?? 'draft';
  return {
    id: deliveryOrderId,
    number: status === 'ready_to_dispatch' ? 'DO-202608-000001' : null,
    salesOrderId,
    salesOrderNumber: 'SO-202608-000001',
    salesOrderVersionId,
    customerId: eligibility.customerId,
    customerAddressId: eligibility.customerAddressId,
    customerCode: eligibility.customerCode,
    customerName: eligibility.customerName,
    warehouseId,
    warehouseCode: eligibility.warehouseCode,
    warehouseName: eligibility.warehouseName,
    handoverMode: eligibility.handoverMode,
    destination: eligibility.destination,
    requestedDeliveryDate: eligibility.requestedDeliveryDate,
    collectionPolicy: eligibility.collectionPolicy,
    status,
    note: null,
    revision: status === 'draft' ? '1' : '2',
    lineCount: 1,
    totalBaseQuantity: '3.000000000000',
    confirmedAt: status === 'ready_to_dispatch' ? '2026-08-04T08:00:00.000Z' : null,
    confirmedBy: status === 'ready_to_dispatch' ? 'e2e-user' : null,
    cancelledAt: status === 'cancelled' ? '2026-08-04T08:00:00.000Z' : null,
    cancelledBy: status === 'cancelled' ? 'e2e-user' : null,
    cancellationReason: state.cancellationReason,
    createdAt: '2026-08-04T07:30:00.000Z',
    createdBy: 'e2e-user',
    updatedAt: '2026-08-04T08:00:00.000Z',
    updatedBy: 'e2e-user',
    lines: [{
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      lineNumber: 1,
      salesOrderId,
      salesOrderVersionId,
      salesOrderLineId: eligibility.salesOrderLineId,
      fulfillmentDemandId: eligibility.fulfillmentDemandId,
      fulfillmentAllocationId: allocationId,
      inventoryReservationId: eligibility.inventoryReservationId,
      warehouseId,
      locationId: eligibility.locationId,
      locationCode: eligibility.locationCode,
      locationName: eligibility.locationName,
      baseVariantId: eligibility.baseVariantId,
      lotId: eligibility.lotId,
      lotCode: eligibility.lotCode,
      expiryDate: eligibility.expiryDate,
      sku: eligibility.sku,
      itemName: eligibility.itemName,
      unitCode: eligibility.unitCode,
      packedBaseQuantitySnapshot: eligibility.packedBaseQuantity,
      deliveryBaseQuantity: '3.000000000000',
    }],
    events: [],
  };
}

async function fulfill(route: Route, data: unknown, status = 200) {
  await route.fulfill({ status, json: { data, requestId: 'e2e-delivery-order' } });
}

async function mockDeliveryOrderApis(page: Page, state: MockState) {
  await page.route('**/api/delivery-orders/eligibility**', async (route) => {
    await fulfill(route, state.status === null || state.status === 'cancelled' ? [eligibility] : []);
  });

  await page.route('**/api/delivery-orders?**', async (route) => {
    await fulfill(route, state.status === null ? [] : [detail(state)]);
  });

  await page.route('**/api/delivery-orders', async (route) => {
    if (route.request().method() === 'GET') {
      await fulfill(route, state.status === null ? [] : [detail(state)]);
      return;
    }
    state.createKey = route.request().headers()['idempotency-key'] ?? null;
    const body = route.request().postDataJSON() as {
      lines?: Array<{ fulfillmentAllocationId?: string; quantity?: string }>;
    };
    expect(body.lines).toEqual([{ fulfillmentAllocationId: allocationId, quantity: '3.000000000000' }]);
    state.status = 'draft';
    state.cancellationReason = null;
    await fulfill(route, { ok: true, replayed: false, deliveryOrder: detail(state) }, 201);
  });

  await page.route(`**/api/delivery-orders/${deliveryOrderId}`, async (route) => {
    await fulfill(route, detail(state));
  });

  await page.route(`**/api/delivery-orders/${deliveryOrderId}/confirm`, async (route) => {
    state.confirmKey = route.request().headers()['idempotency-key'] ?? null;
    state.status = 'ready_to_dispatch';
    await fulfill(route, { ok: true, replayed: false, deliveryOrder: detail(state) }, 201);
  });

  await page.route(`**/api/delivery-orders/${deliveryOrderId}/cancel`, async (route) => {
    state.cancelKey = route.request().headers()['idempotency-key'] ?? null;
    const body = route.request().postDataJSON() as { reason?: string };
    state.cancellationReason = body.reason ?? null;
    state.status = 'cancelled';
    await fulfill(route, { ok: true, replayed: false, deliveryOrder: detail(state) }, 201);
  });
}

async function createDraft(page: Page, state: MockState) {
  await page.goto('/inventory/delivery-orders');
  await expect(page.getByTestId('delivery-order-workspace')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Bàn giao giao nhận', exact: true })).toBeVisible();
  await expect(page.getByTestId('inventory-handover-shortcut')).toHaveText('Chuẩn bị hàng');
  await expect(page.getByText('SO-202608-000001', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('BOT-A-25KG — Bột nguyên liệu A', { exact: true })).toBeVisible();
  await expect(page.getByText('LOT-A-001', { exact: false })).toBeVisible();
  await expect(page.getByText('Còn thiếu 1', { exact: false })).toBeVisible();

  await page.getByTestId('delivery-order-create').click();
  await expect(page.getByTestId('delivery-order-notice')).toContainText('Đã tạo Delivery Order nháp');
  await expect(page.getByTestId(`delivery-order-${deliveryOrderId}`)).toContainText('Chứng từ nháp');
  expect(state.createKey).toMatch(/^create-do-/);
}

test.describe('Bàn giao giao nhận', () => {
  test('tạo từ packed lineage và xác nhận sẵn sàng bàn giao qua proxy thật', async ({ page }) => {
    const state: MockState = {
      status: null,
      cancellationReason: null,
      createKey: null,
      confirmKey: null,
      cancelKey: null,
    };
    await mockDeliveryOrderApis(page, state);
    await createDraft(page, state);

    await page.getByTestId('delivery-order-confirm').click();
    await expect(page.getByTestId('delivery-order-notice')).toContainText('Đã xác nhận chứng từ');
    await expect(page.getByTestId(`delivery-order-${deliveryOrderId}`)).toContainText('Sẵn sàng bàn giao');
    await expect(page.getByText('DO-202608-000001', { exact: true }).first()).toBeVisible();
    expect(state.confirmKey).toMatch(/^confirm-/);

    const content = await page.content();
    expect(content).not.toMatch(/tài xế|chuyến xe|\bPOD\b|\bCOD\b|xuất kho/i);
  });

  test('hủy draft có lý do và trả phần packed về hàng đợi', async ({ page }) => {
    const state: MockState = {
      status: null,
      cancellationReason: null,
      createKey: null,
      confirmKey: null,
      cancelKey: null,
    };
    await mockDeliveryOrderApis(page, state);
    await createDraft(page, state);

    await page.getByLabel('Lý do hủy nháp').fill('Khách đổi thời điểm nhận hàng');
    await page.getByTestId('delivery-order-cancel').click();
    await expect(page.getByTestId('delivery-order-notice')).toContainText('phần packed đã trở lại hàng đợi');
    await expect(page.getByText('Lý do hủy: Khách đổi thời điểm nhận hàng')).toBeVisible();
    await expect(page.getByTestId(`delivery-eligible-${salesOrderId}`)).toBeVisible();
    expect(state.cancelKey).toMatch(/^cancel-/);
  });
});

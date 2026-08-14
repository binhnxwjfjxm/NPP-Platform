import { test, expect, type Page, type Route } from '@playwright/test';

type DeliveryStatus = 'ready_to_dispatch' | 'handed_over';

type DeliveryState = {
  status: DeliveryStatus;
  movementId: string | null;
  receiverName: string | null;
  handoverKey: string | null;
  handoverBody: Record<string, unknown> | null;
};

const deliveryOrderId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const customerReturnId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const returnLineId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const issueLineId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

async function fulfill(route: Route, data: unknown, status = 200) {
  await route.fulfill({ status, json: { data, requestId: 'e2e-phase-6d4' } });
}

function deliveryOrder(state: DeliveryState, mode: 'PICKUP' | 'DELIVERY') {
  return {
    id: deliveryOrderId,
    number: 'DO-202608-000001',
    salesOrderId: '11111111-1111-4111-8111-111111111111',
    salesOrderNumber: 'SO-202608-000001',
    customerCode: 'KH-001',
    customerName: 'Cửa hàng Minh Anh',
    warehouseCode: 'KHO-CHINH',
    warehouseName: 'Kho chính',
    handoverMode: mode,
    status: state.status,
    revision: state.status === 'ready_to_dispatch' ? '2' : '3',
    lineCount: 1,
    totalBaseQuantity: '3.000000000000',
    inventoryIssueId: state.movementId ? 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' : null,
    inventoryIssueStatus: state.movementId ? 'POSTED' : null,
    inventoryMovementId: state.movementId,
    receiverName: state.receiverName,
    lines: [{
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      fulfillmentAllocationId: '22222222-2222-4222-8222-222222222222',
      locationCode: 'A-01-01',
      lotCode: 'LOT-A-001',
      sku: 'BOT-A-25KG',
      itemName: 'Bột nguyên liệu A',
      unitCode: 'BAO',
      deliveryBaseQuantity: '3.000000000000',
      issuedBaseQuantity: state.movementId ? '3.000000000000' : null,
      inventoryMovementLineId: state.movementId ? '99999999-9999-4999-8999-999999999999' : null,
    }],
  };
}

async function mockDeliveryApis(page: Page, state: DeliveryState, mode: 'PICKUP' | 'DELIVERY') {
  await page.route('**/api/delivery-orders/eligibility**', (route) => fulfill(route, []));
  await page.route(`**/api/delivery-orders/${deliveryOrderId}/pickup-handover`, async (route) => {
    state.handoverKey = route.request().headers()['idempotency-key'] ?? null;
    state.handoverBody = route.request().postDataJSON() as Record<string, unknown>;
    state.status = 'handed_over';
    state.movementId = '33333333-3333-4333-8333-333333333333';
    state.receiverName = String(state.handoverBody.receiverName ?? '');
    await fulfill(route, {
      ok: true,
      replayed: false,
      issue: {
        id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        deliveryOrderId,
        status: 'POSTED',
        issueSourceType: 'PICKUP_HANDOVER',
        inventoryMovementId: state.movementId,
      },
    }, 201);
  });
  await page.route(`**/api/delivery-orders/${deliveryOrderId}/manual-handover`, async (route) => {
    state.handoverKey = route.request().headers()['idempotency-key'] ?? null;
    state.handoverBody = route.request().postDataJSON() as Record<string, unknown>;
    state.status = 'handed_over';
    state.movementId = '44444444-4444-4444-8444-444444444444';
    state.receiverName = String(state.handoverBody.receiverName ?? '');
    await fulfill(route, {
      ok: true,
      replayed: false,
      issue: {
        id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        deliveryOrderId,
        status: 'POSTED',
        issueSourceType: 'MANUAL_HANDOVER',
        inventoryMovementId: state.movementId,
      },
      receivableDocument: { id: '55555555-5555-4555-8555-555555555555' },
    }, 201);
  });
  await page.route(`**/api/delivery-orders/${deliveryOrderId}`, (route) => fulfill(route, deliveryOrder(state, mode)));
  await page.route('**/api/delivery-orders?**', (route) => fulfill(route, [deliveryOrder(state, mode)]));
  await page.route('**/api/delivery-orders', (route) => fulfill(route, [deliveryOrder(state, mode)]));
}

test.describe('Phase 6D.4 Delivery Order inventory boundary', () => {
  test('PICKUP xác nhận người nhận rồi mới ghi xuất kho', async ({ page }) => {
    const state: DeliveryState = {
      status: 'ready_to_dispatch',
      movementId: null,
      receiverName: null,
      handoverKey: null,
      handoverBody: null,
    };
    await mockDeliveryApis(page, state, 'PICKUP');
    await page.goto('/inventory/delivery-orders');

    await expect(page.getByTestId('delivery-order-workspace')).toBeVisible();
    await expect(page.getByText('Sẵn sàng bàn giao', { exact: true }).first()).toBeVisible();
    await page.getByLabel('Người nhận tại quầy').fill('Nguyễn Văn Nhận');
    await page.getByLabel('Ghi chú bàn giao').fill('Đã đối chiếu hàng tại quầy');
    await page.getByTestId('delivery-order-pickup-handover').click();

    await expect(page.getByTestId('delivery-order-notice')).toContainText('ghi xuất kho');
    await expect(page.getByText('Đã bàn giao', { exact: true }).first()).toBeVisible();
    expect(state.handoverKey).toMatch(/^delivery-order-pickup-handover-/);
    expect(state.handoverBody).toMatchObject({
      receiverName: 'Nguyễn Văn Nhận',
      receiverNote: 'Đã đối chiếu hàng tại quầy',
    });
    expect(String(state.handoverBody?.handedOverAt)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('DELIVERY có thể xác nhận giao thủ công và ghi fact bàn giao riêng', async ({ page }) => {
    const state: DeliveryState = {
      status: 'ready_to_dispatch',
      movementId: null,
      receiverName: null,
      handoverKey: null,
      handoverBody: null,
    };
    await mockDeliveryApis(page, state, 'DELIVERY');
    await page.goto('/inventory/delivery-orders');

    await expect(page.getByTestId('delivery-manual-handover-panel')).toContainText('giao thủ công');
    await page.getByLabel('Người nhận giao thủ công').fill('Trần Minh Khách');
    await page.getByLabel('Ghi chú giao thủ công').fill('Khách nhận trực tiếp ngoài chuyến');
    await page.getByTestId('delivery-order-manual-handover').click();

    await expect(page.getByTestId('delivery-order-notice')).toContainText('công nợ theo lượng thực giao');
    await expect(page.getByText('Đã bàn giao', { exact: true }).first()).toBeVisible();
    expect(state.handoverKey).toMatch(/^delivery-order-manual-handover-/);
    expect(state.handoverKey).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(state.handoverBody).toMatchObject({
      receiverName: 'Trần Minh Khách',
      receiverNote: 'Khách nhận trực tiếp ngoài chuyến',
    });
    expect(String(state.handoverBody?.handedOverAt)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

type ReturnStatus = 'draft' | 'received';

type ReturnState = {
  status: ReturnStatus | null;
  createKey: string | null;
  receiveKey: string | null;
  createBody: Record<string, unknown> | null;
  receiveBody: Record<string, unknown> | null;
};

const eligibility = {
  issueLineId,
  issueId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  inventoryMovementId: '33333333-3333-4333-8333-333333333333',
  inventoryMovementLineId: '99999999-9999-4999-8999-999999999999',
  deliveryOrderId,
  deliveryOrderNumber: 'DO-202608-000001',
  salesOrderId: '11111111-1111-4111-8111-111111111111',
  salesOrderNumber: 'SO-202608-000001',
  deliveryOrderLineId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  salesOrderLineId: '44444444-4444-4444-8444-444444444444',
  customerId: '55555555-5555-4555-8555-555555555555',
  customerCode: 'KH-001',
  customerName: 'Cửa hàng Minh Anh',
  warehouseId: '66666666-6666-4666-8666-666666666666',
  warehouseCode: 'KHO-CHINH',
  warehouseName: 'Kho chính',
  locationId: '77777777-7777-4777-8777-777777777777',
  locationCode: 'A-01-01',
  baseVariantId: '88888888-8888-4888-8888-888888888888',
  lotId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  lotCode: 'LOT-A-001',
  sku: 'BOT-A-25KG',
  itemName: 'Bột nguyên liệu A',
  unitCode: 'BAO',
  issuedBaseQuantity: '3.000000000000',
  claimedReturnBaseQuantity: '0.000000000000',
  availableReturnBaseQuantity: '3.000000000000',
};

function customerReturn(state: ReturnState) {
  const received = state.status === 'received';
  return {
    id: customerReturnId,
    number: received ? 'CR-202608-000001' : null,
    customerCode: 'KH-001',
    customerName: 'Cửa hàng Minh Anh',
    warehouseCode: 'KHO-CHINH',
    warehouseName: 'Kho chính',
    status: state.status ?? 'draft',
    note: 'Khách trả một phần',
    revision: received ? '2' : '1',
    lineCount: 1,
    requestedBaseQuantity: '2.000000000000',
    acceptedBaseQuantity: received ? '1.000000000000' : '0.000000000000',
    inventoryMovementId: received ? '12121212-1212-4121-8121-121212121212' : null,
    lines: [{
      id: returnLineId,
      lineNumber: 1,
      deliveryOrderNumber: 'DO-202608-000001',
      salesOrderNumber: 'SO-202608-000001',
      locationCode: 'A-01-01',
      lotCode: 'LOT-A-001',
      sku: 'BOT-A-25KG',
      itemName: 'Bột nguyên liệu A',
      unitCode: 'BAO',
      requestedBaseQuantity: '2.000000000000',
      acceptedBaseQuantity: received ? '1.000000000000' : '0.000000000000',
      reasonCode: 'QUALITY_COMPLAINT',
      reasonNote: 'Bao bì bị lỗi',
    }],
  };
}

async function mockReturnApis(page: Page, state: ReturnState) {
  await page.route('**/api/customer-returns/eligibility**', (route) => fulfill(route, state.status === null ? [eligibility] : []));
  await page.route(`**/api/customer-returns/${customerReturnId}/receive`, async (route) => {
    state.receiveKey = route.request().headers()['idempotency-key'] ?? null;
    state.receiveBody = route.request().postDataJSON() as Record<string, unknown>;
    state.status = 'received';
    await fulfill(route, { ok: true, replayed: false, customerReturn: customerReturn(state) }, 201);
  });
  await page.route(`**/api/customer-returns/${customerReturnId}`, (route) => fulfill(route, customerReturn(state)));
  await page.route('**/api/customer-returns?**', (route) => fulfill(route, state.status === null ? [] : [customerReturn(state)]));
  await page.route('**/api/customer-returns', async (route) => {
    if (route.request().method() === 'GET') {
      await fulfill(route, state.status === null ? [] : [customerReturn(state)]);
      return;
    }
    state.createKey = route.request().headers()['idempotency-key'] ?? null;
    state.createBody = route.request().postDataJSON() as Record<string, unknown>;
    state.status = 'draft';
    await fulfill(route, { ok: true, replayed: false, customerReturn: customerReturn(state) }, 201);
  });
}

test.describe('Phase 6D.4 Hàng khách trả', () => {
  test('phiếu nháp không tăng tồn; nhận kho explicit mới ghi Inventory IN', async ({ page }) => {
    const state: ReturnState = {
      status: null,
      createKey: null,
      receiveKey: null,
      createBody: null,
      receiveBody: null,
    };
    await mockReturnApis(page, state);
    await page.goto('/inventory/customer-returns');

    await expect(page.getByTestId('customer-return-workspace')).toBeVisible();
    await expect(page.getByText('BOT-A-25KG — Bột nguyên liệu A', { exact: true }).first()).toBeVisible();
    await page.getByLabel('Số lượng khách trả').fill('2');
    await page.getByLabel('Lý do chi tiết').fill('Bao bì bị lỗi');
    await page.getByTestId('customer-return-create').click();

    await expect(page.getByTestId('customer-return-notice')).toContainText('tồn kho chưa thay đổi');
    await expect(page.getByText('Nháp chờ nhận', { exact: true }).first()).toBeVisible();
    expect(state.createKey).toMatch(/^customer-return-create-return-/);
    expect(state.createBody).toMatchObject({
      lines: [{ issueLineId, quantity: '2', reasonCode: 'DAMAGED_OR_UNWANTED', reasonNote: 'Bao bì bị lỗi' }],
    });

    await page.getByLabel('Thực nhận BOT-A-25KG').fill('1');
    await page.getByTestId('customer-return-receive').click();
    await expect(page.getByTestId('customer-return-notice')).toContainText('ghi Inventory IN');
    await expect(page.getByText('Đã nhận vào kho', { exact: true }).first()).toBeVisible();
    expect(state.receiveKey).toMatch(/^customer-return-return-receive-/);
    expect(state.receiveBody).toMatchObject({
      expectedRevision: '1',
      lines: [{ customerReturnLineId: returnLineId, acceptedQuantity: '1' }],
    });
  });
});

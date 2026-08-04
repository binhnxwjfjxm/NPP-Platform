import { test, expect, type Page } from '@playwright/test';

type Allocation = {
  id: string;
  fulfillmentDemandId: string;
  salesOrderId: string;
  salesOrderVersionId: string;
  salesOrderLineId: string;
  warehouseId: string;
  locationId: string;
  locationCode: string;
  locationName: string;
  baseVariantId: string;
  lotId: string;
  lotCode: string;
  expiryDate: string;
  inventoryReservationId: string;
  allocationSequence: number;
  allocationPolicy: 'FEFO';
  policyRank: number;
  manualOverrideReason: null;
  allocatedBaseQuantity: string;
  pickedBaseQuantity: string;
  packedBaseQuantity: string;
  state: 'ACTIVE' | 'COMPLETED';
  createdAt: string;
  updatedAt: string;
};

async function mockFulfillmentApis(page: Page) {
  const demandId = '11111111-1111-4111-8111-111111111111';
  const allocationId = '22222222-2222-4222-8222-222222222222';
  let fulfillmentStatus = 'reserved';
  let allocatedBaseQuantity = '0.000000000000';
  let pickedBaseQuantity = '0.000000000000';
  let packedBaseQuantity = '0.000000000000';
  let allocation: Allocation | null = null;

  const work = () => ({
    fulfillmentDemandId: demandId,
    salesOrderId: '33333333-3333-4333-8333-333333333333',
    orderNumber: 'SO-260804-000001',
    fulfillmentStatus,
    requestedDeliveryDate: '2026-08-05',
    sourceType: 'MANUAL',
    customerCode: 'KH-001',
    customerName: 'Cửa hàng Minh Anh',
    warehouseId: '44444444-4444-4444-8444-444444444444',
    warehouseCode: 'KHO-CHINH',
    warehouseName: 'Kho chính',
    salesOrderVersionId: '55555555-5555-4555-8555-555555555555',
    salesOrderLineId: '66666666-6666-4666-8666-666666666666',
    lineNumber: 1,
    itemName: 'Bột nguyên liệu A',
    sku: 'BOT-A-25KG',
    unitCode: 'BAO',
    baseVariantId: '77777777-7777-4777-8777-777777777777',
    orderedBaseQuantity: '3.000000000000',
    reservedBaseQuantity: '3.000000000000',
    backorderedBaseQuantity: '0.000000000000',
    allocatedBaseQuantity,
    pickedBaseQuantity,
    packedBaseQuantity,
    allocationCount: allocation ? 1 : 0,
    createdAt: '2026-08-04T03:00:00.000Z',
    updatedAt: '2026-08-04T03:00:00.000Z',
  });

  await page.route('**/api/inventory/fulfillment-work**', async (route) => {
    await route.fulfill({
      status: 200,
      json: { data: [work()], requestId: 'e2e-fulfillment-work' },
    });
  });

  await page.route(`**/api/inventory/fulfillment-demands/${demandId}/suggestions`, async (route) => {
    await route.fulfill({
      status: 200,
      json: {
        data: {
          demand: work(),
          remainingBaseQuantity: allocation ? '0.000000000000' : '3.000000000000',
          candidates: [{
            rank: 1,
            warehouseId: work().warehouseId,
            locationId: '88888888-8888-4888-8888-888888888888',
            locationCode: 'A-01-01',
            locationName: 'Kệ A-01-01',
            baseVariantId: work().baseVariantId,
            lotId: '99999999-9999-4999-8999-999999999999',
            lotCode: 'LOT-A-001',
            expiryDate: '2026-10-01',
            firstReceivedAt: '2026-07-01T00:00:00.000Z',
            availableBaseQuantity: allocation ? '0.000000000000' : '3.000000000000',
            allocationPolicy: 'FEFO',
            lotTrackingMode: 'REQUIRED',
            expiryTrackingMode: 'REQUIRED',
            locationRequired: true,
          }],
          suggestedPlan: allocation ? [] : [{
            locationId: '88888888-8888-4888-8888-888888888888',
            lotId: '99999999-9999-4999-8999-999999999999',
            allocationPolicy: 'FEFO',
            policyRank: 1,
            manualOverrideReason: null,
            quantity: '3.000000000000',
          }],
          allocations: allocation ? [allocation] : [],
        },
        requestId: 'e2e-fulfillment-suggestion',
      },
    });
  });

  await page.route(`**/api/inventory/fulfillment-demands/${demandId}/allocate`, async (route) => {
    allocation = {
      id: allocationId,
      fulfillmentDemandId: demandId,
      salesOrderId: work().salesOrderId,
      salesOrderVersionId: work().salesOrderVersionId,
      salesOrderLineId: work().salesOrderLineId,
      warehouseId: work().warehouseId,
      locationId: '88888888-8888-4888-8888-888888888888',
      locationCode: 'A-01-01',
      locationName: 'Kệ A-01-01',
      baseVariantId: work().baseVariantId,
      lotId: '99999999-9999-4999-8999-999999999999',
      lotCode: 'LOT-A-001',
      expiryDate: '2026-10-01',
      inventoryReservationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      allocationSequence: 1,
      allocationPolicy: 'FEFO',
      policyRank: 1,
      manualOverrideReason: null,
      allocatedBaseQuantity: '3.000000000000',
      pickedBaseQuantity: '0.000000000000',
      packedBaseQuantity: '0.000000000000',
      state: 'ACTIVE',
      createdAt: '2026-08-04T03:01:00.000Z',
      updatedAt: '2026-08-04T03:01:00.000Z',
    };
    fulfillmentStatus = 'allocated';
    allocatedBaseQuantity = '3.000000000000';
    await route.fulfill({
      status: 201,
      json: {
        data: {
          ok: true,
          replayed: false,
          allocation: {
            fulfillmentDemandId: demandId,
            salesOrderId: work().salesOrderId,
            orderNumber: work().orderNumber,
            reservedBaseQuantity: '3.000000000000',
            allocatedBaseQuantity,
            allocations: [allocation],
          },
        },
        requestId: 'e2e-fulfillment-allocate',
      },
    });
  });

  await page.route(`**/api/inventory/fulfillment-allocations/${allocationId}/pick`, async (route) => {
    pickedBaseQuantity = '3.000000000000';
    fulfillmentStatus = 'picked';
    allocation = allocation ? {
      ...allocation,
      pickedBaseQuantity,
      updatedAt: '2026-08-04T03:02:00.000Z',
    } : allocation;
    await route.fulfill({
      status: 201,
      json: {
        data: { ok: true, replayed: false, allocation },
        requestId: 'e2e-fulfillment-pick',
      },
    });
  });

  await page.route(`**/api/inventory/fulfillment-allocations/${allocationId}/pack`, async (route) => {
    packedBaseQuantity = '3.000000000000';
    fulfillmentStatus = 'packed';
    allocation = allocation ? {
      ...allocation,
      packedBaseQuantity,
      state: 'COMPLETED',
      updatedAt: '2026-08-04T03:03:00.000Z',
    } : allocation;
    await route.fulfill({
      status: 201,
      json: {
        data: { ok: true, replayed: false, allocation },
        requestId: 'e2e-fulfillment-pack',
      },
    });
  });
}

test.describe('Chuẩn bị hàng', () => {
  test('nằm trong nhóm Kho và đi đúng luồng phân bổ, soạn, đóng gói', async ({ page }) => {
    await mockFulfillmentApis(page);
    await page.goto('/inventory/fulfillment');

    await expect(page.getByTestId('fulfillment-workspace')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Chuẩn bị hàng', exact: true })).toBeVisible();
    await expect(page.getByTestId('inventory-menu-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('nav-inventory-fulfillment')).toBeVisible();
    await expect(page.getByText('SO-260804-000001', { exact: true })).toBeVisible();
    await expect(page.getByText('BOT-A-25KG — Bột nguyên liệu A', { exact: true })).toBeVisible();
    await expect(page.getByText('LOT-A-001', { exact: false })).toBeVisible();
    await expect(page.getByText('FEFO', { exact: false })).toBeVisible();

    await page.getByTestId('fulfillment-auto-allocate').click();
    await expect(page.getByTestId('fulfillment-notice')).toContainText('Đã phân bổ');
    await expect(page.getByTestId(`fulfillment-allocation-22222222-2222-4222-8222-222222222222`)).toBeVisible();
    await expect(page.getByText('Đã phân bổ', { exact: true }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Soạn 3', exact: true }).click();
    await expect(page.getByTestId('fulfillment-notice')).toContainText('Đã xác nhận soạn');
    await expect(page.getByText('Đã soạn', { exact: true }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Đóng gói 3', exact: true }).click();
    await expect(page.getByTestId('fulfillment-notice')).toContainText('Đã xác nhận đóng gói');
    await expect(page.getByText('Đã đóng gói', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Đã đóng gói', { exact: true }).last()).toBeVisible();

    const content = await page.content();
    expect(content).not.toMatch(/tài xế|chuyến xe|\bPOD\b|\bCOD\b/i);
  });
});

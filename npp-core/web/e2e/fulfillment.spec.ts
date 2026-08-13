import { test, expect, type Page } from '@playwright/test';

const DEMAND_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_DEMAND_ID = '11111111-1111-4111-8111-222222222222';
const ALLOCATION_ID = '22222222-2222-4222-8222-222222222222';
const SALES_ORDER_ID = '33333333-3333-4333-8333-333333333333';

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
  let fulfillmentStatus = 'reserved';
  let allocatedBaseQuantity = '0.000000000000';
  let pickedBaseQuantity = '0.000000000000';
  let packedBaseQuantity = '0.000000000000';
  let allocation: Allocation | null = null;

  const work = () => ({
    fulfillmentDemandId: DEMAND_ID,
    salesOrderId: SALES_ORDER_ID,
    orderNumber: 'SO-260804-000001',
    orderTotal: '80000',
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

  const secondWork = () => ({
    ...work(),
    fulfillmentDemandId: SECOND_DEMAND_ID,
    salesOrderLineId: '66666666-6666-4666-8666-777777777777',
    lineNumber: 2,
    itemName: 'Phụ gia B',
    sku: 'PHUGIA-B',
    unitCode: 'THUNG',
    baseVariantId: '77777777-7777-4777-8777-888888888888',
    orderedBaseQuantity: '2.000000000000',
    reservedBaseQuantity: '2.000000000000',
    allocatedBaseQuantity: '0.000000000000',
    pickedBaseQuantity: '0.000000000000',
    packedBaseQuantity: '0.000000000000',
    allocationCount: 0,
  });

  await page.route('**/api/inventory/fulfillment-work**', async (route) => {
    await route.fulfill({ status: 200, json: { data: [work(), secondWork()], requestId: 'e2e-fulfillment-work' } });
  });

  await page.route(`**/api/inventory/fulfillment-demands/${DEMAND_ID}/suggestions`, async (route) => {
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

  await page.route(`**/api/inventory/fulfillment-demands/${SECOND_DEMAND_ID}/suggestions`, async (route) => {
    await route.fulfill({
      status: 200,
      json: {
        data: { demand: secondWork(), remainingBaseQuantity: '2.000000000000', candidates: [], suggestedPlan: [], allocations: [] },
        requestId: 'e2e-fulfillment-suggestion-second',
      },
    });
  });

  await page.route(`**/api/inventory/fulfillment-demands/${DEMAND_ID}/allocate`, async (route) => {
    allocation = {
      id: ALLOCATION_ID,
      fulfillmentDemandId: DEMAND_ID,
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
      json: { data: { ok: true, replayed: false, allocation: { allocations: [allocation] } }, requestId: 'e2e-fulfillment-allocate' },
    });
  });

  await page.route(`**/api/inventory/fulfillment-allocations/${ALLOCATION_ID}/pick`, async (route) => {
    pickedBaseQuantity = '3.000000000000';
    fulfillmentStatus = 'picked';
    allocation = allocation ? { ...allocation, pickedBaseQuantity, updatedAt: '2026-08-04T03:02:00.000Z' } : allocation;
    await route.fulfill({ status: 201, json: { data: { ok: true, replayed: false, allocation }, requestId: 'e2e-fulfillment-pick' } });
  });

  await page.route(`**/api/inventory/fulfillment-allocations/${ALLOCATION_ID}/pack`, async (route) => {
    packedBaseQuantity = '3.000000000000';
    fulfillmentStatus = 'packed';
    allocation = allocation ? { ...allocation, packedBaseQuantity, state: 'COMPLETED', updatedAt: '2026-08-04T03:03:00.000Z' } : allocation;
    await route.fulfill({ status: 201, json: { data: { ok: true, replayed: false, allocation }, requestId: 'e2e-fulfillment-pack' } });
  });
}

test.describe('Chuẩn bị hàng', () => {
  test('danh sách đơn gọn, preview ERP theo dòng sản phẩm và giữ đúng luồng kho', async ({ page }) => {
    await mockFulfillmentApis(page);
    await page.goto('/inventory/fulfillment');

    await expect(page.getByTestId('fulfillment-workspace')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Chuẩn bị hàng', exact: true })).toBeVisible();
    await expect(page.getByTestId('inventory-menu-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('nav-inventory-fulfillment')).toBeVisible();

    const orderRow = page.getByTestId(`fulfillment-order-${SALES_ORDER_ID}`);
    await expect(orderRow).toHaveCount(1);
    await expect(orderRow).toContainText('SO-260804-000001');
    await expect(orderRow).toContainText('80.000');
    await expect(orderRow).not.toContainText('Bột nguyên liệu A');
    await expect(orderRow).not.toContainText('BOT-A-25KG');
    await expect(orderRow).not.toContainText('Phụ gia B');

    const table = page.getByTestId('fulfillment-product-table');
    await expect(table.getByText('Bột nguyên liệu A', { exact: true })).toBeVisible();
    await expect(table.getByText('BOT-A-25KG', { exact: true })).toBeVisible();
    await expect(table.getByText('Phụ gia B', { exact: true })).toBeVisible();
    await expect(table.getByText('PHUGIA-B', { exact: true })).toBeVisible();

    await page.getByTestId(`fulfillment-product-${SECOND_DEMAND_ID}`).click();
    const selectedProduct = page.getByTestId('fulfillment-selected-product');
    await expect(selectedProduct.getByRole('heading', { name: 'Phụ gia B', exact: true })).toBeVisible();
    await expect(selectedProduct).toContainText('PHUGIA-B');

    await page.getByTestId('fulfillment-search').fill('PHUGIA-B');
    await expect(page.getByTestId(`fulfillment-order-${SALES_ORDER_ID}`)).toHaveCount(1);
    await page.getByTestId('fulfillment-search').fill('');

    await page.getByTestId(`fulfillment-product-${DEMAND_ID}`).click();
    await expect(selectedProduct.getByRole('heading', { name: 'Bột nguyên liệu A', exact: true })).toBeVisible();
    await expect(page.getByText('A-01-01', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('LOT-A-001', { exact: true }).first()).toBeVisible();

    const initialContent = await page.content();
    expect(initialContent).not.toMatch(/\bFEFO\b|\bFIFO\b|fulfillment demand|allocation policy/i);

    await page.getByTestId('fulfillment-auto-allocate').click();
    await expect(page.getByTestId('fulfillment-notice')).toContainText('Đã phân bổ');
    await expect(page.getByTestId(`fulfillment-allocation-${ALLOCATION_ID}`)).toBeVisible();

    await page.getByRole('button', { name: 'Soạn 3', exact: true }).click();
    await expect(page.getByTestId('fulfillment-notice')).toContainText('Đã xác nhận soạn');

    await page.getByRole('button', { name: 'Đóng gói 3', exact: true }).click();
    await expect(page.getByTestId('fulfillment-notice')).toContainText('Đã xác nhận đóng gói');
    await expect(page.getByText('Đã đóng gói', { exact: true }).first()).toBeVisible();

    const content = await page.content();
    expect(content).not.toMatch(/tài xế|chuyến xe|\bPOD\b|\bCOD\b|\bFEFO\b|\bFIFO\b/i);
  });
});

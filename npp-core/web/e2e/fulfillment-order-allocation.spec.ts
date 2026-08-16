import { test, expect } from '@playwright/test';

const SALES_ORDER_ID = '33333333-3333-4333-8333-333333333333';
const DEMAND_ONE = '11111111-1111-4111-8111-111111111111';
const DEMAND_TWO = '11111111-1111-4111-8111-222222222222';
const WAREHOUSE_ID = '44444444-4444-4444-8444-444444444444';

function workItem(demandId: string, lineNumber: number, itemName: string, sku: string, quantity: string) {
  return {
    fulfillmentDemandId: demandId,
    salesOrderId: SALES_ORDER_ID,
    orderNumber: 'SO-260816-000001',
    orderSubtotal: '120000',
    orderDiscountTotal: '0',
    orderTaxTotal: '0',
    orderTotal: '120000',
    salesChannelCode: 'OFFICE',
    salesChannelName: 'Công Ty',
    fulfillmentStatus: 'reserved',
    requestedDeliveryDate: '2026-08-17',
    sourceType: 'MANUAL',
    customerCode: 'KH-001',
    customerName: 'Cửa hàng Minh Anh',
    warehouseId: WAREHOUSE_ID,
    warehouseCode: 'KHO-CHINH',
    warehouseName: 'Kho chính',
    salesOrderVersionId: '55555555-5555-4555-8555-555555555555',
    salesOrderLineId: lineNumber === 1
      ? '66666666-6666-4666-8666-666666666666'
      : '66666666-6666-4666-8666-777777777777',
    lineNumber,
    itemName,
    sku,
    unitCode: 'THUNG',
    baseVariantId: lineNumber === 1
      ? '77777777-7777-4777-8777-777777777777'
      : '77777777-7777-4777-8777-888888888888',
    orderedBaseQuantity: quantity,
    reservedBaseQuantity: quantity,
    backorderedBaseQuantity: '0.000000000000',
    allocatedBaseQuantity: '0.000000000000',
    pickedBaseQuantity: '0.000000000000',
    packedBaseQuantity: '0.000000000000',
    allocationCount: 0,
    createdAt: '2026-08-16T10:00:00.000Z',
    updatedAt: '2026-08-16T10:00:00.000Z',
  };
}

test('Phân bổ toàn đơn gửi một request và trả rõ dòng đủ / cần xử lý riêng', async ({ page }) => {
  const first = workItem(DEMAND_ONE, 1, 'Bột nguyên liệu A', 'BOT-A', '3.000000000000');
  const second = workItem(DEMAND_TWO, 2, 'Phụ gia B', 'PHUGIA-B', '2.000000000000');
  let orderAllocateCalls = 0;
  let lineAllocateCalls = 0;

  await page.route('**/api/inventory/fulfillment-work**', async (route) => {
    await route.fulfill({ status: 200, json: { data: [first, second], requestId: 'work' } });
  });

  for (const item of [first, second]) {
    await page.route(`**/api/inventory/fulfillment-demands/${item.fulfillmentDemandId}/suggestions`, async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          data: {
            demand: item,
            remainingBaseQuantity: item.reservedBaseQuantity,
            candidates: [],
            suggestedPlan: [],
            allocations: [],
          },
          requestId: 'suggestion',
        },
      });
    });
  }

  await page.route('**/api/inventory/fulfillment-demands/*/allocate', async (route) => {
    lineAllocateCalls += 1;
    await route.fulfill({ status: 500, json: { error: { message: 'Không được gọi phân bổ từng dòng' } } });
  });

  await page.route(`**/api/inventory/fulfillment-orders/${SALES_ORDER_ID}/allocate`, async (route) => {
    orderAllocateCalls += 1;
    const key = route.request().headers()['idempotency-key'];
    expect(key).toMatch(/^[A-Za-z0-9._-]{1,128}$/);
    expect(route.request().postDataJSON()).toEqual({ mode: 'AUTO' });
    await route.fulfill({
      status: 200,
      json: {
        data: {
          ok: true,
          replayed: false,
          salesOrderId: SALES_ORDER_ID,
          summary: { totalLines: 2, readyLines: 1, shortageLines: 0, needsAttentionLines: 1 },
          lines: [
            {
              fulfillmentDemandId: DEMAND_ONE,
              salesOrderLineId: first.salesOrderLineId,
              lineNumber: 1,
              sku: first.sku,
              itemName: first.itemName,
              unitCode: first.unitCode,
              reservedBaseQuantity: first.reservedBaseQuantity,
              allocatedBaseQuantity: first.reservedBaseQuantity,
              remainingToAllocateBaseQuantity: '0.000000000000',
              shortageBaseQuantity: '0.000000000000',
              outcome: 'READY',
              reasonCode: null,
              message: 'Đủ hàng và đã phân bổ, có thể chuyển sang soạn hàng.',
            },
            {
              fulfillmentDemandId: DEMAND_TWO,
              salesOrderLineId: second.salesOrderLineId,
              lineNumber: 2,
              sku: second.sku,
              itemName: second.itemName,
              unitCode: second.unitCode,
              reservedBaseQuantity: second.reservedBaseQuantity,
              allocatedBaseQuantity: '0.000000000000',
              remainingToAllocateBaseQuantity: second.reservedBaseQuantity,
              shortageBaseQuantity: '0.000000000000',
              outcome: 'NEEDS_ATTENTION',
              reasonCode: 'NO_ALLOCATABLE_STOCK',
              message: 'Chưa có vị trí/lô phù hợp cho phần hàng đã giữ; cần xử lý riêng.',
            },
          ],
        },
        requestId: 'order-allocate',
      },
    });
  });

  await page.goto('/inventory/fulfillment');
  const button = page.getByTestId('fulfillment-auto-allocate-order');
  await expect(button).toBeVisible();
  await expect(button).toHaveText('Phân bổ toàn đơn');
  await button.click();

  await expect(page.getByTestId('fulfillment-order-allocation-summary')).toContainText('1 dòng đủ');
  await expect(page.getByTestId('fulfillment-order-allocation-summary')).toContainText('1 dòng cần xử lý riêng');
  await expect(page.getByTestId(`fulfillment-product-${DEMAND_ONE}`)).toContainText('Đủ để soạn');
  await expect(page.getByTestId(`fulfillment-product-${DEMAND_TWO}`)).toContainText('Cần xử lý riêng');
  expect(orderAllocateCalls).toBe(1);
  expect(lineAllocateCalls).toBe(0);
});

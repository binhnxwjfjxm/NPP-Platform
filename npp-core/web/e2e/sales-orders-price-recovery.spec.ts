import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

const ORDER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CHANNEL_ID = '11111111-1111-4111-8111-111111111111';
const VARIANT_ID = '22222222-2222-4222-8222-222222222222';

function suffix() {
  return Date.now().toString(36).toUpperCase().slice(-10);
}

async function createWarehouse(request: APIRequestContext, token: string) {
  const branchResponse = await request.post('/api/organization/branches', {
    headers: { 'Idempotency-Key': `so-recovery-branch-${token}` },
    data: { code: `SRB-${token}`, name: `Chi nhánh recovery ${token}` },
  });
  expect(branchResponse.status()).toBe(201);
  const branch = (await branchResponse.json()).data;
  const warehouseResponse = await request.post('/api/organization/warehouses', {
    headers: { 'Idempotency-Key': `so-recovery-warehouse-${token}` },
    data: {
      branchId: branch.id,
      code: `SRW-${token}`,
      name: `Kho recovery ${token}`,
      warehouseType: 'main',
    },
  });
  expect(warehouseResponse.status()).toBe(201);
  return (await warehouseResponse.json()).data as { id: string };
}

function orderEnvelope(
  payload: Record<string, unknown>,
  status: 'draft' | 'confirmed',
  revision: string,
) {
  const now = '2026-08-01T00:00:00.000Z';
  const lines = Array.isArray(payload.lines) ? payload.lines as Array<Record<string, unknown>> : [];
  return {
    data: {
      id: ORDER_ID,
      number: status === 'confirmed' ? 'SO-260801-000001' : null,
      status,
      currentVersionNumber: '1',
      sourceType: 'MANUAL',
      sourceId: null,
      sourceOutletId: null,
      customerMode: 'WALK_IN',
      customerId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      customerCode: 'WALK-IN',
      customerName: 'Khách vãng lai',
      walkInDisplayName: null,
      walkInPhone: null,
      customerAddressId: null,
      warehouseId: String(payload.warehouseId ?? ''),
      warehouseCode: 'SRW-E2E',
      warehouseName: 'Kho recovery E2E',
      salesChannelId: String(payload.salesChannelId ?? CHANNEL_ID),
      salesChannelCode: 'FIELD',
      salesChannelName: 'Bán hàng thị trường',
      deliveryMode: 'PICKUP',
      collectionPolicy: 'COLLECT_ON_DELIVERY',
      fulfillmentStatus: 'unallocated',
      deliveryStatus: 'not_required',
      settlementStatus: 'not_due',
      currency: 'VND',
      requestedDeliveryDate: null,
      note: null,
      revision,
      confirmedAt: status === 'confirmed' ? now : null,
      confirmedBy: status === 'confirmed' ? 'bootstrap:e2e' : null,
      cancelledAt: null,
      cancelledBy: null,
      cancellationReason: null,
      createdAt: now,
      updatedAt: now,
      createdBy: 'bootstrap:e2e',
      updatedBy: 'bootstrap:e2e',
      versions: [{
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        versionNumber: '1',
        status,
        customerMode: 'WALK_IN',
        customerId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        customerCode: 'WALK-IN',
        customerName: 'Khách vãng lai',
        walkInDisplayName: null,
        walkInPhone: null,
        customerAddressId: null,
        customerAddress: null,
        warehouseId: String(payload.warehouseId ?? ''),
        warehouseCode: 'SRW-E2E',
        warehouseName: 'Kho recovery E2E',
        salesChannelId: String(payload.salesChannelId ?? CHANNEL_ID),
        salesChannelCode: 'FIELD',
        salesChannelName: 'Bán hàng thị trường',
        deliveryMode: 'PICKUP',
        sourceType: 'MANUAL',
        sourceId: null,
        sourceOutletId: null,
        collectionPolicy: 'COLLECT_ON_DELIVERY',
        currency: 'VND',
        requestedDeliveryDate: null,
        note: null,
        subtotal: '9100',
        discountTotal: '0',
        taxTotal: '728',
        total: '9828',
        documentDiscountMode: 'NONE',
        documentDiscountValue: '0',
        documentDiscountReason: null,
        amendmentReason: null,
        basedOnVersionNumber: null,
        priceOverrideReason: null,
        revision,
        createdAt: now,
        createdBy: 'bootstrap:e2e',
        confirmedAt: status === 'confirmed' ? now : null,
        confirmedBy: status === 'confirmed' ? 'bootstrap:e2e' : null,
        lines: lines.map((line, index) => ({
          id: `dddddddd-dddd-4ddd-8ddd-${String(index + 1).padStart(12, '0')}`,
          lineNumber: index + 1,
          variantId: String(line.variantId),
          sku: 'SKU-RECOVERY',
          itemName: 'Sản phẩm recovery',
          unitId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          unitCode: 'THUNG',
          conversionToBase: '1',
          quantity: String(line.quantity),
          baseQuantity: String(line.quantity),
          priceListId: null,
          priceRuleId: null,
          priceSource: 'PRICE_ENGINE',
          baseUnitPrice: '10000',
          systemUnitPrice: String(line.expectedSystemUnitPriceMinor ?? '9100'),
          unitPrice: String(line.expectedSystemUnitPriceMinor ?? '9100'),
          manualOverrideReason: null,
          pricingTrace: [],
          discountMode: 'TOTAL_AMOUNT',
          discountValue: '0',
          discountAmount: '0',
          taxMode: 'EXCLUSIVE',
          taxRate: '8',
          taxAmount: '728',
          lineSubtotal: '9100',
          lineTotal: '9828',
          note: null,
        })),
      }],
    },
    requestId: `e2e-recovery-${status}-${revision}`,
  };
}

async function mockRecoveryApis(page: Page) {
  let systemPrice = '9000';
  let savedPayload: Record<string, unknown> = {};
  let createCount = 0;
  let updateCount = 0;
  let confirmCount = 0;
  let updateExpectedRevision: unknown = null;

  await page.route('**/api/sales-orders/entry-settings', async (route) => {
    await route.fulfill({
      status: 200,
      json: {
        data: {
          walkInConfigured: true,
          walkInBootstrapSupported: true,
          defaultTaxMode: 'EXCLUSIVE',
          defaultTaxRate: '8',
          salesChannels: [{ id: CHANNEL_ID, code: 'FIELD', name: 'Bán hàng thị trường' }],
          defaultSalesChannelId: CHANNEL_ID,
          permissions: { canPriceOverride: true, canDiscountOverride: true, canConfirm: true },
        },
        requestId: 'e2e-recovery-entry',
      },
    });
  });

  await page.route('**/api/sales-orders/sku-search**', async (route) => {
    await route.fulfill({
      status: 200,
      json: {
        data: [{
          id: VARIANT_ID,
          productId: '33333333-3333-4333-8333-333333333333',
          productCode: 'SP-RECOVERY',
          productName: 'Sản phẩm recovery',
          sku: 'SKU-RECOVERY',
          variantName: 'Quy cách recovery',
          barcode: '8930000000001',
          unitId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          unitCode: 'THUNG',
          unitName: 'Thùng',
          conversionToBase: '1',
          allowsFractional: false,
          defaultTaxMode: 'EXCLUSIVE',
          defaultTaxRate: '8',
          eligibility: { selectable: true, code: 'ELIGIBLE', message: 'Có thể chọn để bán.' },
        }],
        requestId: 'e2e-recovery-sku',
      },
    });
  });

  await page.route('**/api/pricing/resolve', async (route) => {
    const body = route.request().postDataJSON() as { quantity: string; channelId: string };
    await route.fulfill({
      status: 200,
      json: {
        data: {
          variant: { id: VARIANT_ID, sku: 'SKU-RECOVERY' },
          currencyCode: 'VND',
          quantity: body.quantity,
          priceAt: '2026-08-01T00:00:00.000Z',
          channelId: body.channelId,
          customerId: null,
          customerGroupId: null,
          baseUnitPriceMinor: '10000',
          systemUnitPriceMinor: systemPrice,
          finalUnitPriceMinor: systemPrice,
          lineTotalMinor: systemPrice,
          resolutionFingerprint: `pricing-recovery-${systemPrice}`,
          steps: [
            { kind: 'BASE', priceListCode: 'BASE-VND', priceListType: 'BASE', afterUnitPriceMinor: '10000' },
            { kind: 'RULE', priceListCode: 'FIELD', priceListType: 'CHANNEL', beforeUnitPriceMinor: '10000', afterUnitPriceMinor: systemPrice, priority: 200, stackingMode: 'EXCLUSIVE' },
          ],
        },
        requestId: `e2e-recovery-price-${systemPrice}`,
      },
    });
  });

  await page.route(/\/api\/sales-orders$/, async (route) => {
    createCount += 1;
    savedPayload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 201, json: orderEnvelope(savedPayload, 'draft', '1') });
  });

  await page.route(new RegExp(`/api/sales-orders/${ORDER_ID}/draft$`), async (route) => {
    updateCount += 1;
    savedPayload = route.request().postDataJSON() as Record<string, unknown>;
    updateExpectedRevision = savedPayload.expectedRevision;
    await route.fulfill({ status: 200, json: orderEnvelope(savedPayload, 'draft', '2') });
  });

  await page.route(new RegExp(`/api/sales-orders/${ORDER_ID}/confirm$`), async (route) => {
    confirmCount += 1;
    if (confirmCount === 1) {
      systemPrice = '9100';
      await route.fulfill({
        status: 409,
        json: {
          error: {
            code: 'SALES_PRICE_CHANGED',
            message: 'System price changed',
            retryable: false,
            details: {},
          },
          requestId: 'e2e-recovery-mismatch',
        },
      });
      return;
    }
    await route.fulfill({ status: 200, json: orderEnvelope(savedPayload, 'confirmed', '3') });
  });

  return {
    snapshot: () => ({ createCount, updateCount, confirmCount, updateExpectedRevision }),
  };
}

test.describe('Sales Order price mismatch recovery', () => {
  test('reuses the committed draft instead of creating an orphan after confirm mismatch', async ({ page, request }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const warehouse = await createWarehouse(request, suffix());
    const recovery = await mockRecoveryApis(page);

    await page.goto('/sales/sales-orders');
    await page.getByRole('button', { name: 'Tạo đơn bán hàng', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Biểu mẫu đơn bán hàng' });
    await dialog.getByRole('button', { name: 'Khách vãng lai', exact: true }).click();
    await dialog.getByTestId('sales-channel-select').selectOption(CHANNEL_ID);
    await dialog.getByLabel('Kho xuất *').selectOption(warehouse.id);

    const search = dialog.getByPlaceholder('Tên sản phẩm, mã hàng, SKU hoặc barcode');
    await search.fill('SKU-RECOVERY');
    const option = dialog.getByRole('listbox').locator('button').filter({ hasText: 'SKU-RECOVERY' }).first();
    await expect(option).toBeVisible();
    await option.click();
    await expect(dialog.getByTestId('sales-order-line-1')).toBeVisible();

    await dialog.getByRole('button', { name: 'Lưu và xác nhận', exact: true }).click();
    const pricingMismatchAlert = dialog.getByRole('alert').filter({ hasText: 'Hệ thống đã tính lại' });
    await expect(pricingMismatchAlert).toContainText('Giá hệ thống đã thay đổi');
    await expect.poll(() => recovery.snapshot().confirmCount).toBe(1);
    expect(recovery.snapshot().createCount).toBe(1);
    expect(recovery.snapshot().updateCount).toBe(0);

    await dialog.getByRole('button', { name: 'Lưu và xác nhận', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Đã lưu, xác nhận và cấp số đơn bán hàng', { exact: true })).toBeVisible();

    expect(recovery.snapshot()).toEqual({
      createCount: 1,
      updateCount: 1,
      confirmCount: 2,
      updateExpectedRevision: '1',
    });
  });
});

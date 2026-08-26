import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

function suffix() {
  return Date.now().toString(36).toUpperCase().slice(-10);
}

async function createWarehouse(request: APIRequestContext, token: string) {
  const branchResponse = await request.post('/api/organization/branches', {
    headers: { 'Idempotency-Key': `so-branch-${token}` },
    data: { code: `SOB-${token}`, name: `Chi nhánh SO ${token}` },
  });
  expect(branchResponse.status()).toBe(201);
  const branch = (await branchResponse.json()).data;
  const warehouseResponse = await request.post('/api/organization/warehouses', {
    headers: { 'Idempotency-Key': `so-warehouse-${token}` },
    data: {
      branchId: branch.id,
      code: `SOW-${token}`,
      name: `Kho SO ${token}`,
      warehouseType: 'main',
    },
  });
  expect(warehouseResponse.status()).toBe(201);
  return (await warehouseResponse.json()).data as { id: string; code: string; name: string };
}

function variantId(index: number) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function orderEnvelope(payload: Record<string, unknown>, status: 'draft' | 'confirmed') {
  const now = '2026-07-31T00:00:00.000Z';
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const warehouseId = String(payload.warehouseId ?? '');
  const salesChannelId = String(payload.salesChannelId ?? '');
  const lines = Array.isArray(payload.lines) ? payload.lines as Array<Record<string, unknown>> : [];
  return {
    data: {
      id,
      number: status === 'confirmed' ? 'SO-260731-000001' : null,
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
      warehouseId,
      warehouseCode: 'SOW-E2E',
      warehouseName: 'Kho SO E2E',
      salesChannelId,
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
      revision: status === 'confirmed' ? '2' : '1',
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
        warehouseId,
        warehouseCode: 'SOW-E2E',
        warehouseName: 'Kho SO E2E',
        salesChannelId,
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
        subtotal: '162171',
        discountTotal: '8109',
        taxTotal: '12325',
        total: '166387',
        documentDiscountMode: String(payload.documentDiscountMode ?? 'NONE'),
        documentDiscountValue: String(payload.documentDiscountValue ?? '0'),
        documentDiscountReason: String(payload.documentDiscountReason ?? '') || null,
        amendmentReason: null,
        basedOnVersionNumber: null,
        priceOverrideReason: null,
        revision: status === 'confirmed' ? '2' : '1',
        createdAt: now,
        createdBy: 'bootstrap:e2e',
        confirmedAt: status === 'confirmed' ? now : null,
        confirmedBy: status === 'confirmed' ? 'bootstrap:e2e' : null,
        lines: lines.map((line, index) => ({
          id: variantId(index + 101),
          lineNumber: index + 1,
          variantId: String(line.variantId),
          sku: `SKU-${index + 1}`,
          itemName: `Quy cách ${index + 1}`,
          unitId: variantId(index + 201),
          unitCode: 'THUNG',
          conversionToBase: '1',
          quantity: String(line.quantity),
          baseQuantity: String(line.quantity),
          priceListId: null,
          priceRuleId: null,
          priceSource: line.manualUnitPriceMinor ? 'MANUAL_OVERRIDE' : 'PRICE_ENGINE',
          baseUnitPrice: '10000',
          systemUnitPrice: String(line.expectedSystemUnitPriceMinor ?? '9000'),
          unitPrice: String(line.manualUnitPriceMinor ?? line.expectedSystemUnitPriceMinor ?? '9000'),
          manualOverrideReason: String(line.manualReason ?? '') || null,
          pricingTrace: [],
          discountMode: String(line.discountMode ?? 'TOTAL_AMOUNT'),
          discountValue: String(line.discountValue ?? '0'),
          discountAmount: '0',
          taxMode: String(line.taxMode ?? 'EXCLUSIVE'),
          taxRate: String(line.taxRate ?? '8'),
          taxAmount: '0',
          lineSubtotal: '9000',
          lineTotal: '9000',
          note: null,
        })),
      }],
    },
    requestId: `e2e-so-${status}`,
  };
}

async function mockCommercialApis(page: Page) {
  const channelId = '11111111-1111-4111-8111-111111111111';
  let savedPayload: Record<string, unknown> = {};
  await page.route('**/api/sales-orders/entry-settings', async (route) => {
    await route.fulfill({
      status: 200,
      json: {
        data: {
          walkInConfigured: true,
          walkInBootstrapSupported: true,
          defaultTaxMode: 'EXCLUSIVE',
          defaultTaxRate: '8',
          salesChannels: [{ id: channelId, code: 'FIELD', name: 'Bán hàng thị trường' }],
          defaultSalesChannelId: channelId,
          defaultWarehouseId: null,
          permissions: {
            canPriceOverride: true,
            canDiscountOverride: true,
            canConfirm: true,
          },
        },
        requestId: 'e2e-so-entry',
      },
    });
  });

  await page.route('**/api/sales-orders/sku-search**', async (route) => {
    const url = new URL(route.request().url());
    const search = url.searchParams.get('search') ?? 'SKU-1';
    const digits = Number(search.replace(/\D/g, '')) || 1;
    await route.fulfill({
      status: 200,
      json: {
        data: [{
          id: variantId(digits),
          productId: `22222222-2222-4222-8222-${String(digits).padStart(12, '0')}`,
          productCode: `SP-${digits}`,
          productName: `Sản phẩm ${digits}`,
          sku: `SKU-${digits}`,
          variantName: `Quy cách ${digits}`,
          barcode: `893000${String(digits).padStart(6, '0')}`,
          unitId: `33333333-3333-4333-8333-${String(digits).padStart(12, '0')}`,
          unitCode: 'THUNG',
          unitName: 'Thùng',
          conversionToBase: '1',
          allowsFractional: false,
          defaultTaxMode: 'EXCLUSIVE',
          defaultTaxRate: '8',
          eligibility: { selectable: true, code: 'ELIGIBLE', message: 'Có thể chọn để bán.' },
          pricePreview: { status: 'RESOLVED', unitPriceMinor: String(9_000 + digits), message: null },
          inventoryPreview: { status: 'TRACKED', onHandQuantity: '12', availableQuantity: '10', unitCode: 'THUNG' },
        }],
        requestId: `e2e-so-sku-${digits}`,
      },
    });
  });

  await page.route('**/api/pricing/resolve', async (route) => {
    const body = route.request().postDataJSON() as {
      variantId: string;
      quantity: string;
      channelId: string;
    };
    const systemPrice = String(9_000 + Number(body.variantId.slice(-2)));
    await route.fulfill({
      status: 200,
      json: {
        data: {
          variant: { id: body.variantId, sku: body.variantId },
          currencyCode: 'VND',
          quantity: body.quantity,
          priceAt: '2026-07-31T00:00:00.000Z',
          channelId: body.channelId,
          customerId: null,
          customerGroupId: null,
          baseUnitPriceMinor: '10000',
          systemUnitPriceMinor: systemPrice,
          finalUnitPriceMinor: systemPrice,
          lineTotalMinor: systemPrice,
          resolutionFingerprint: `pricing-${body.variantId}-${body.quantity}-${body.channelId}`,
          steps: [
            { kind: 'BASE', priceListCode: 'BASE-VND', priceListType: 'BASE', afterUnitPriceMinor: '10000' },
            { kind: 'RULE', priceListCode: 'FIELD', priceListType: 'CHANNEL', beforeUnitPriceMinor: '10000', afterUnitPriceMinor: systemPrice, priority: 200, stackingMode: 'EXCLUSIVE' },
            { kind: 'SKIPPED', priceListCode: 'LOWER', reason: 'lower_priority' },
          ],
        },
        requestId: 'e2e-so-pricing',
      },
    });
  });

  await page.route(/\/api\/sales-orders$/, async (route) => {
    savedPayload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 201, json: orderEnvelope(savedPayload, 'draft') });
  });
  await page.route(/\/api\/sales-orders\/[^/]+\/confirm$/, async (route) => {
    await route.fulfill({ status: 200, json: orderEnvelope(savedPayload, 'confirmed') });
  });
}

test.describe('Sales Order commercial controls', () => {
  test('scrolls the real modal body and completes permissioned save/confirm at 1366x768', async ({ page, request }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const warehouse = await createWarehouse(request, suffix());
    await mockCommercialApis(page);

    await page.goto('/sales/sales-orders');
    await page.getByRole('button', { name: 'Tạo đơn bán hàng', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Biểu mẫu đơn bán hàng' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Khách vãng lai', exact: true }).click();
    await dialog.getByTestId('sales-channel-select').selectOption('11111111-1111-4111-8111-111111111111');
    await dialog.getByLabel('Kho xuất *').selectOption(warehouse.id);

    const search = dialog.getByPlaceholder('Tên sản phẩm, mã hàng, SKU hoặc barcode');
    for (let index = 1; index <= 18; index += 1) {
      await search.fill(`SKU-${index}`);
      const option = dialog.getByRole('listbox').locator('button').filter({ hasText: `SKU-${index}` }).first();
      await expect(option).toBeVisible();
      await option.click();
      await expect(dialog.getByTestId(`sales-order-line-${index}`)).toBeVisible();
    }

    const firstLine = dialog.getByTestId('sales-order-line-1');
    const directPrice = firstLine.getByLabel('Đơn giá SKU-1');
    await directPrice.fill('8500');
    await expect(firstLine.getByText('Giá đã sửa', { exact: true })).toBeVisible();
    await firstLine.getByRole('button', { name: /^Dùng lại giá hệ thống/ }).click();
    await expect(directPrice).toHaveValue('9001');
    await directPrice.fill('0');
    await expect(directPrice).toHaveValue('0');

    await firstLine.getByLabel('Cách CK SKU-1').selectOption('PERCENT');
    await firstLine.getByLabel('Chiết khấu SKU-1').fill('5');
    await expect(dialog.getByTestId('document-discount-mode')).toBeDisabled();

    const body = dialog.getByTestId('sales-order-scroll-body');
    const header = dialog.locator('header').first();
    const footer = dialog.locator('footer').last();
    const before = await Promise.all([header.boundingBox(), footer.boundingBox()]);
    const dimensions = await body.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      scrollTop: element.scrollTop,
    }));
    expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);

    await body.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await expect(dialog.getByTestId('sales-order-scroll-sentinel')).toBeVisible();
    const after = await Promise.all([header.boundingBox(), footer.boundingBox()]);
    expect(after[0]?.y).toBe(before[0]?.y);
    expect(after[1]?.y).toBe(before[1]?.y);
    await expect(dialog.getByRole('button', { name: 'Lưu nháp', exact: true })).toBeVisible();

    await body.evaluate((element) => { element.scrollTop = 0; });
    await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBe(0);
    const modalOverflow = await dialog.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(modalOverflow.scrollWidth).toBeLessThanOrEqual(modalOverflow.clientWidth);

    await dialog.getByRole('button', { name: 'Lưu và xác nhận', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Đã lưu, xác nhận và cấp số đơn bán hàng', { exact: true })).toBeVisible();
  });
});

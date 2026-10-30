import { test, expect, type APIRequestContext } from '@playwright/test';
import { createIdempotencyKey } from '@npp/contracts';

async function createFixture(request: APIRequestContext, suffix: string) {
  const productResponse = await request.post('/api/products', {
    headers: { 'Idempotency-Key': createIdempotencyKey('pricing-e2e-product') },
    data: { code: `P-${suffix}`, name: `Sản phẩm giá ${suffix}` },
  });
  expect(productResponse.status()).toBe(201);
  const product = (await productResponse.json()).data;

  const variantResponse = await request.post(`/api/products/${product.id}/variants`, {
    headers: { 'Idempotency-Key': createIdempotencyKey('pricing-e2e-variant') },
    data: { sku: `SKU-${suffix}`, name: `SKU giá ${suffix}`, variantKind: 'BASE', isInventoryBase: true, isSellable: true },
  });
  expect(variantResponse.status()).toBe(201);
  const variant = (await variantResponse.json()).data;

  const unitResponse = await request.post('/api/units', {
    headers: { 'Idempotency-Key': createIdempotencyKey('pricing-e2e-unit') },
    data: { code: `EA-${suffix}`, name: `Đơn vị ${suffix}`, unitKind: 'COUNT', allowsFractional: false },
  });
  expect(unitResponse.status()).toBe(201);
  const unit = (await unitResponse.json()).data;

  const assignment = await request.patch(`/api/products/${product.id}/variants/${variant.id}/unit`, {
    data: { unitId: unit.id, conversionToBase: '1', expectedUpdatedAt: variant.updated_at },
  });
  expect(assignment.status()).toBe(200);
  return { product, variant: (await assignment.json()).data };
}

test.describe('Giá bán', () => {
  test('quản trị giá nền, giá kênh, kiểm tra giá và điều chỉnh thủ công', async ({ page, request }) => {
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
    const fixture = await createFixture(request, suffix);
    const channelCode = `VENUE-${suffix}`;
    const baseCode = `BASE-${suffix}`;
    const channelListCode = `CHANNEL-${suffix}`;

    await page.goto('/pricing');
    await expect(page.getByTestId('pricing-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Giá bán', exact: true })).toBeVisible();

    await page.getByTestId('add-sales-channel-button').click();
    await expect(page.getByTestId('pricing-channel-modal')).toBeVisible();
    await page.getByTestId('channel-code-input').fill(channelCode.toLowerCase());
    await page.getByTestId('channel-name-input').fill(`Kênh quán ${suffix}`);
    await page.getByTestId('save-channel-button').click();
    await expect(page.getByTestId(`channel-row-${channelCode}`)).toBeVisible();

    await page.getByTestId('pricing-lists-tab').click();
    await page.getByTestId('add-price-list-button').click();
    await expect(page.getByTestId('pricing-list-modal')).toBeVisible();
    await page.getByTestId('price-list-code-input').fill(baseCode.toLowerCase());
    await page.getByTestId('price-list-name-input').fill(`Giá nền ${suffix}`);
    await page.getByTestId('save-price-list-button').click();
    await expect(page.getByTestId(`price-list-row-${baseCode}`)).toBeVisible();

    await page.getByTestId('pricing-items-tab').click();
    await page.getByTestId('add-price-item-button').click();
    await expect(page.getByTestId('pricing-item-modal')).toBeVisible();
    await page.getByTestId('item-product-select').selectOption({ label: `${fixture.product.code} — ${fixture.product.name}` });
    await page.getByTestId('item-variant-select').selectOption({ label: `${fixture.variant.sku} — ${fixture.variant.name}` });
    await page.getByTestId('item-amount-input').fill('10000');
    await page.getByTestId('save-price-item-button').click();
    await expect(page.getByTestId(`price-item-row-${fixture.variant.sku}`)).toContainText('10.000');

    await page.getByTestId('pricing-lists-tab').click();
    await page.getByTestId('add-price-list-button').click();
    await page.getByTestId('price-list-type-select').selectOption('CHANNEL');
    await page.getByTestId('price-list-code-input').fill(channelListCode.toLowerCase());
    await page.getByTestId('price-list-name-input').fill(`Giá kênh ${suffix}`);
    await page.getByTestId('price-list-priority-input').fill('200');
    await page.getByTestId('price-list-channel-multi-select').getByRole('checkbox', { name: `Kênh quán ${suffix}` }).check();
    await page.getByTestId('save-price-list-button').click();
    await expect(page.getByTestId(`price-list-row-${channelListCode}`)).toBeVisible();

    await page.getByTestId('pricing-items-tab').click();
    await page.getByTestId('add-price-item-button').click();
    await page.getByTestId('item-product-select').selectOption({ label: `${fixture.product.code} — ${fixture.product.name}` });
    await page.getByTestId('item-variant-select').selectOption({ label: `${fixture.variant.sku} — ${fixture.variant.name}` });
    await page.getByTestId('item-amount-input').fill('9000');
    await page.getByTestId('save-price-item-button').click();
    await expect(page.getByTestId(`price-item-row-${fixture.variant.sku}`)).toContainText('9.000');

    await page.getByTestId('pricing-resolver-tab').click();
    await page.getByTestId('resolver-product-select').selectOption({ label: `${fixture.product.code} — ${fixture.product.name}` });
    await page.getByTestId('resolver-variant-select').selectOption({ label: `${fixture.variant.sku} — ${fixture.variant.name}` });
    await page.getByTestId('resolver-quantity-input').fill('2');
    await page.getByTestId('resolver-channel-select').selectOption({ label: `${channelCode} — Kênh quán ${suffix}` });
    await page.getByTestId('resolve-price-button').click();
    await expect(page.getByTestId('resolved-unit-price')).toContainText('9.000');
    await expect(page.getByTestId('resolved-line-total')).toContainText('18.000');
    await expect(page.getByTestId('pricing-step-base')).toBeVisible();
    await expect(page.getByTestId('pricing-step-rule')).toBeVisible();

    await page.getByLabel('Giá điều chỉnh thủ công (₫)').fill('7777');
    await page.getByLabel('Lý do điều chỉnh').fill('Giá được quản lý duyệt');
    await page.getByTestId('resolve-price-button').click();
    await expect(page.getByTestId('resolved-unit-price')).toContainText('7.777');
    await expect(page.getByTestId('resolved-line-total')).toContainText('15.554');
    await expect(page.getByTestId('pricing-step-manual_override')).toBeVisible();
  });
  test('chỉ hiển thị chọn khách cụ thể ở loại bảng giá có hỗ trợ', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.getByTestId('pricing-page')).toBeVisible();
    await page.getByTestId('pricing-lists-tab').click();
    await page.getByTestId('add-price-list-button').click();
    const modal = page.getByTestId('pricing-list-modal');
    const type = modal.getByTestId('price-list-type-select');
    const customer = modal.getByTestId('price-list-customer-select');

    await expect(customer).toHaveCount(0);
    await type.selectOption('CHANNEL');
    await expect(modal.getByTestId('price-list-channel-multi-select')).toBeVisible();
    await expect(customer).toHaveCount(0);
    await type.selectOption('CUSTOMER_GROUP');
    await expect(modal.getByTestId('price-list-group-multi-select')).toBeVisible();
    await expect(modal.getByTestId('price-list-channel-multi-select')).toBeVisible();
    await expect(customer).toHaveCount(0);

    // Các loại được phép chỉ định khách riêng vẫn giữ khả năng này.
    for (const kind of ['CUSTOMER', 'PROMOTION', 'CUSTOM']) {
      await type.selectOption(kind);
      await expect(customer).toBeVisible();
      await expect(customer).toBeEnabled();
    }
    await type.selectOption('BASE');
    await expect(customer).toHaveCount(0);
  });

  test('điều chỉnh trực tiếp giá trùng: checkbox gửi đủ 2 ID và thời điểm cập nhật, lưu thành công', async ({ page, request }) => {
    const suffix = `CF-${Date.now().toString(36).toUpperCase()}`;
    const fixture = await createFixture(request, suffix);
    const sku = fixture.variant.sku;
    const listCode = `DEAL-${suffix}`;
    const newList = await request.post('/api/price-lists', {
      headers: { 'Idempotency-Key': createIdempotencyKey('pricing-conflict-list') },
      data: { code: listCode, name: 'Giá đại lý thử nghiệm', listType: 'CUSTOM' },
    });
    expect(newList.status(), await newList.text()).toBe(201);
    const list = (await newList.json()).data;

    const priceRows = [
      { amountMinor: '565000', effectiveFrom: null },
      { amountMinor: '525000', effectiveFrom: '2026-10-09T13:46:52.000Z' },
    ];
    const seeded = [];
    for (const price of priceRows) {
      const response = await request.post(`/api/price-lists/${list.id}/items`, {
        headers: { 'Idempotency-Key': createIdempotencyKey('pricing-conflict-seed') },
        data: {
          variantId: fixture.variant.id, adjustmentType: 'FIXED_PRICE',
          amountMinor: price.amountMinor, minQuantity: '0',
          effectiveFrom: price.effectiveFrom, effectiveTo: null, isActive: true,
        },
      });
      expect(response.status(), await response.text()).toBe(201);
      seeded.push((await response.json()).data);
    }

    await page.goto('/pricing?view=all');
    await expect(page.getByTestId('open-bulk-pricing')).toBeVisible();
    await page.getByTestId('open-bulk-pricing').click();
    const modal = page.getByTestId('bulk-pricing-modal');
    await modal.getByLabel('Bảng giá').selectOption(list.id);
    await expect(modal.getByText('Đang tải dữ liệu…')).toHaveCount(0);
    await modal.getByLabel('Nhập / dán SKU').fill(sku);
    await modal.getByRole('button', { name: 'Thêm SKU' }).click();
    await modal.getByLabel(`Giá mới SKU ${sku}`).fill('530000');
    const collision = modal.getByTestId(`pricing-conflict-${sku}`);
    await expect(collision).toContainText('525.000');
    await expect(collision).toContainText('565.000');
    await expect(modal.getByTestId('apply-bulk-pricing')).toBeDisabled();
    await collision.getByRole('checkbox').check();
    await expect(modal.getByTestId('apply-bulk-pricing')).toBeEnabled();

    const post = page.waitForRequest((req) => req.url().endsWith('/api/pricing/import') && req.method() === 'POST');
    await modal.getByTestId('apply-bulk-pricing').click();
    const sent = (await post).postDataJSON();
    const actualConfirmed = sent.items[0].resolveConflicts;
    expect(actualConfirmed).toHaveLength(2);
    expect(new Set(actualConfirmed.map((entry: { id: string }) => entry.id)))
      .toEqual(new Set(seeded.map((entry) => entry.id)));
    for (const item of seeded) {
      expect(actualConfirmed.find((entry: { id: string }) => entry.id === item.id).expectedUpdatedAt)
        .toBe(item.updated_at);
    }

    await expect(modal).toContainText('Đã lưu 1 SKU', { timeout: 25_000 });
    await expect(modal.getByTestId('apply-bulk-pricing')).toBeDisabled();
    const result = await request.get(`/api/price-lists/${list.id}/items?limit=50`);
    expect(result.status()).toBe(200);
    const after = (await result.json()).data;
    const now = Date.now();
    const activeNow = after.filter((row: { is_active: boolean; effective_from: string | null; effective_to: string | null }) =>
      row.is_active
      && (!row.effective_from || new Date(row.effective_from).getTime() <= now)
      && (!row.effective_to || new Date(row.effective_to).getTime() > now));
    expect(activeNow).toHaveLength(1);
    expect(activeNow[0].amount_minor).toBe('530000');
  });

});

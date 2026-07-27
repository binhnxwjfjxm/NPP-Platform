import { test, expect, type APIRequestContext } from '@playwright/test';

async function createFixture(request: APIRequestContext, suffix: string) {
  const productResponse = await request.post('/api/products', {
    headers: { 'Idempotency-Key': `pricing-product-${suffix}` },
    data: { code: `P-${suffix}`, name: `Sản phẩm giá ${suffix}` },
  });
  expect(productResponse.status()).toBe(201);
  const product = (await productResponse.json()).data;

  const variantResponse = await request.post(`/api/products/${product.id}/variants`, {
    headers: { 'Idempotency-Key': `pricing-variant-${suffix}` },
    data: { sku: `SKU-${suffix}`, name: `SKU giá ${suffix}`, variantKind: 'BASE', isInventoryBase: true, isSellable: true },
  });
  expect(variantResponse.status()).toBe(201);
  const variant = (await variantResponse.json()).data;

  const unitResponse = await request.post('/api/units', {
    headers: { 'Idempotency-Key': `pricing-unit-${suffix}` },
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

test.describe('Giá bán và khuyến mãi', () => {
  test('quản trị giá nền, giá kênh, phân giải và override thủ công', async ({ page, request }) => {
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
    const fixture = await createFixture(request, suffix);
    const channelCode = `VENUE-${suffix}`;
    const baseCode = `BASE-${suffix}`;
    const channelListCode = `CHANNEL-${suffix}`;

    await page.goto('/pricing');
    await expect(page.getByTestId('pricing-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Giá bán & khuyến mãi', exact: true })).toBeVisible();

    await page.getByTestId('channel-code-input').fill(channelCode.toLowerCase());
    await page.getByTestId('channel-name-input').fill(`Kênh quán ${suffix}`);
    await page.getByTestId('save-channel-button').click();
    await expect(page.getByTestId(`channel-row-${channelCode}`)).toBeVisible();

    await page.getByTestId('pricing-lists-tab').click();
    await page.getByTestId('price-list-code-input').fill(baseCode.toLowerCase());
    await page.getByTestId('price-list-name-input').fill(`Giá nền ${suffix}`);
    await page.getByTestId('save-price-list-button').click();
    await expect(page.getByTestId(`price-list-row-${baseCode}`)).toBeVisible();

    await page.getByTestId('pricing-items-tab').click();
    await page.getByTestId('item-product-select').selectOption({ label: `${fixture.product.code} — ${fixture.product.name}` });
    await page.getByTestId('item-variant-select').selectOption({ label: `${fixture.variant.sku} — ${fixture.variant.name}` });
    await page.getByTestId('item-amount-input').fill('10000');
    await page.getByTestId('save-price-item-button').click();
    await expect(page.getByTestId(`price-item-row-${fixture.variant.sku}`)).toContainText('10.000');

    await page.getByTestId('pricing-lists-tab').click();
    await page.getByTestId('price-list-type-select').selectOption('CHANNEL');
    await page.getByTestId('price-list-code-input').fill(channelListCode.toLowerCase());
    await page.getByTestId('price-list-name-input').fill(`Giá kênh ${suffix}`);
    await page.getByTestId('price-list-priority-input').fill('200');
    await page.getByTestId('price-list-channel-select').selectOption({ label: `${channelCode} — Kênh quán ${suffix}` });
    await page.getByTestId('save-price-list-button').click();
    await expect(page.getByTestId(`price-list-row-${channelListCode}`)).toBeVisible();

    await page.getByTestId('pricing-items-tab').click();
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

    await page.getByLabel('Giá chỉnh tay (₫)').fill('7777');
    await page.getByLabel('Lý do chỉnh tay').fill('Giá được quản lý duyệt');
    await page.getByTestId('resolve-price-button').click();
    await expect(page.getByTestId('resolved-unit-price')).toContainText('7.777');
    await expect(page.getByTestId('resolved-line-total')).toContainText('15.554');
    await expect(page.getByTestId('pricing-step-manual_override')).toBeVisible();
  });
});

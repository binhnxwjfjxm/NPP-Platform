import { test, expect } from '@playwright/test';

test.describe('Danh mục sản phẩm', () => {
  test('quản lý loại, nhãn hàng, sản phẩm, SKU, đơn vị, quy đổi và barcode', async ({ page }) => {
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
    const categoryCode = `CAT-${suffix}`;
    const brandCode = `BR-${suffix}`;
    const productCode = `SP-${suffix}`;
    const sku = `SKU-${suffix}`;
    const unitCode = `EA-${suffix}`;
    const barcode = `BAR-${suffix}`;

    await page.goto('/products');
    await expect(page.getByTestId('products-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Danh mục sản phẩm', exact: true })).toBeVisible();

    await page.getByTestId('categories-tab').click();
    await page.getByTestId('add-category-button').click();
    await page.getByTestId('category-code-input').fill(categoryCode.toLowerCase());
    await page.getByTestId('category-name-input').fill(`Loại ${suffix}`);
    await page.getByTestId('save-category-button').click();
    await expect(page.getByTestId(`category-row-${categoryCode}`)).toBeVisible();

    await page.getByTestId('brands-tab').click();
    await page.getByTestId('add-brand-button').click();
    await page.getByTestId('brand-code-input').fill(brandCode.toLowerCase());
    await page.getByTestId('brand-name-input').fill(`Nhãn ${suffix}`);
    await page.getByTestId('save-brand-button').click();
    await expect(page.getByTestId(`brand-row-${brandCode}`)).toBeVisible();

    await page.getByTestId('products-tab').click();
    await page.getByTestId('add-product-button').click();
    await page.getByTestId('product-code-input').fill(productCode.toLowerCase());
    await page.getByTestId('product-name-input').fill(`Sản phẩm ${suffix}`);
    await page.getByLabel('Loại').selectOption({ label: `${categoryCode} — Loại ${suffix}` });
    await page.getByLabel('Nhãn hàng').selectOption({ label: `${brandCode} — Nhãn ${suffix}` });
    await page.getByTestId('save-product-button').click();

    let productRow = page.getByTestId(`product-row-${productCode}`);
    await expect(productRow).toBeVisible();
    await expect(productRow).toContainText(`Sản phẩm ${suffix}`);

    await page.getByTestId(`manage-variants-${productCode}`).click();
    await expect(page.getByTestId('variant-panel')).toBeVisible();
    await page.getByTestId('add-variant-button').click();
    await page.getByTestId('variant-sku-input').fill(sku.toLowerCase());
    await page.getByTestId('variant-name-input').fill(`SKU ${suffix}`);
    await page.getByLabel('Đơn vị tồn chuẩn').check();
    await page.getByTestId('save-variant-button').click();
    await expect(page.getByTestId(`variant-row-${sku}`)).toBeVisible();

    await expect(page.getByTestId('product-unit-workspace')).toBeVisible();
    await page.getByTestId('refresh-unit-products-button').click();
    await expect(page.getByText('Đã làm mới danh sách sản phẩm')).toBeVisible();

    await page.getByTestId('add-unit-button').click();
    await page.getByTestId('unit-code-input').fill(unitCode.toLowerCase());
    await page.getByTestId('unit-name-input').fill(`Đơn vị ${suffix}`);
    await page.getByTestId('save-unit-button').click();
    await expect(page.getByTestId(`unit-row-${unitCode}`)).toBeVisible();

    await page.getByTestId('unit-product-select').selectOption({ label: `${productCode} — Sản phẩm ${suffix}` });
    await page.getByTestId('unit-variant-select').selectOption({ label: `${sku} — SKU ${suffix}` });
    await expect(page.getByTestId('variant-unit-panel')).toBeVisible();
    await page.getByTestId('variant-unit-select').selectOption({ label: `${unitCode} — Đơn vị ${suffix}` });
    await page.getByTestId('save-variant-unit-button').click();
    await expect(page.getByText('Đã lưu đơn vị và hệ số quy đổi')).toBeVisible();

    await page.getByTestId('barcode-input').fill(barcode.toLowerCase());
    await page.getByTestId('add-barcode-button').click();
    await expect(page.getByTestId(`barcode-row-${barcode}`)).toBeVisible();

    await page.getByTestId('normalize-quantity-input').fill('3');
    await page.getByTestId('normalize-quantity-button').click();
    await expect(page.getByTestId('normalization-result')).toContainText('3 đơn vị tồn');

    await page.getByTestId('products-tab').click();
    productRow = page.getByTestId(`product-row-${productCode}`);
    await page.getByTestId(`edit-product-${productCode}`).click();
    await page.getByLabel('Cho phép đặt hàng').check();
    await page.getByTestId('save-product-button').click();
    await expect(productRow).toContainText('Có');

    await page.getByTestId('products-search-input').fill(productCode);
    await page.getByTestId('products-status-filter').selectOption('active');
    await expect(productRow).toBeVisible();
  });
});

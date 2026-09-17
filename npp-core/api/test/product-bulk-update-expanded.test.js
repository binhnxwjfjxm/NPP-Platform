import test from 'node:test';
import assert from 'node:assert/strict';
import { bulkUpdateProductVariants, identifyProductVariants } from '../src/services/product-bulk-update.js';

const INSTALLATION_ID = '11111111-1111-4111-8111-111111111111';
const PRODUCT_ID = '22222222-2222-4222-8222-222222222222';
const VARIANT_ID = '33333333-3333-4333-8333-333333333333';
const UNIT_ID = '44444444-4444-4444-8444-444444444444';
const CATEGORY_A_ID = '55555555-5555-4555-8555-555555555555';
const CATEGORY_B_ID = '66666666-6666-4666-8666-666666666666';
const BRAND_A_ID = '77777777-7777-4777-8777-777777777777';

function variant(sku, productId = PRODUCT_ID, overrides = {}) {
  return {
    id: VARIANT_ID,
    product_id: productId,
    sku,
    name: `Tên ${sku}`,
    variant_kind: 'BASE',
    is_inventory_base: false,
    is_sellable: true,
    is_catalog_visible: false,
    is_active: true,
    unit_id: UNIT_ID,
    unit_code: 'EA',
    conversion_to_base: '1',
    is_purchasable: true,
    net_content_value: null,
    net_content_uom_code: null,
    source_unit_label: null,
    source_package_description: null,
    unit_source_metadata: {},
    weight_value: '1',
    weight_uom_code: 'KG',
    updated_at: '2026-09-17T00:00:00.000Z',
    product_name: 'Sản phẩm A',
    ...overrides,
  };
}

function product(overrides = {}) {
  return {
    id: PRODUCT_ID,
    code: 'SP-A',
    name: 'Sản phẩm A',
    catalog_name: 'Sản phẩm A',
    category_id: CATEGORY_A_ID,
    category_code: 'CAT-A',
    brand_id: BRAND_A_ID,
    brand_code: 'BR-A',
    description: null,
    notes: null,
    is_catalog_visible: true,
    is_orderable: true,
    is_inventory_managed: true,
    is_active: true,
    updated_at: '2026-09-17T00:00:00.000Z',
    ...overrides,
  };
}

test('Cập nhật SP — nhận diện được file 603 dòng, không còn trần 500 dòng', async () => {
  const rows = Array.from({ length: 603 }, (_value, index) => ({ rowNumber: index + 2, cells: [`SKU-${index + 1}`, 'x'] }));
  const result = await identifyProductVariants(null, {
    installationId: INSTALLATION_ID,
    payload: { rows },
  }, {
    getProductVariantsByIdsOrSkus: async (_client, { skus }) => skus.map((sku) => variant(sku)),
  });

  assert.equal(result.ok, true);
  assert.equal(result.identified, 603);
  assert.equal(result.skipped, 0);
});

test('Cập nhật SP — thuộc tính cấp sản phẩm và SKU cùng dùng SKU làm khóa, preview cũ → mới', async () => {
  const existingVariant = variant('SKU-A');
  const existingProduct = product();
  const result = await bulkUpdateProductVariants(null, {
    installationId: INSTALLATION_ID,
    updatedBy: 'test:user',
    payload: {
      dryRun: true,
      mappings: ['SKU', 'CATEGORY_CODE', 'VARIANT_NAME'],
      rows: [{ rowNumber: 2, cells: ['SKU-A', 'CAT-B', 'Quy cách mới'] }],
    },
  }, {
    getProductVariantsByIdsOrSkus: async () => [existingVariant],
    getProductsByIds: async () => [existingProduct],
    getCategoriesByCodes: async () => [{ id: CATEGORY_B_ID, code: 'CAT-B', is_active: true }],
  });

  assert.equal(result.ok, true);
  assert.equal(result.ready, 1);
  assert.equal(result.skipped, 0);
  assert.deepEqual(result.rows[0].changes.map((item) => [item.label, item.oldValue, item.newValue]), [
    ['Loại sản phẩm', 'CAT-A', 'CAT-B'],
    ['Tên SKU / quy cách', 'Tên SKU-A', 'Quy cách mới'],
  ]);
});

test('Cập nhật SP — dòng lỗi bị bỏ qua nhưng dòng hợp lệ vẫn cập nhật', async () => {
  const updates = [];
  const existingVariant = variant('SKU-A');
  const existingProduct = product();
  const result = await bulkUpdateProductVariants(null, {
    installationId: INSTALLATION_ID,
    updatedBy: 'test:user',
    payload: {
      dryRun: false,
      mappings: ['SKU', 'PRODUCT_NAME'],
      rows: [
        { rowNumber: 2, cells: ['SKU-KHONG-CO', 'Không được tạo'] },
        { rowNumber: 3, cells: ['SKU-A', 'Tên sản phẩm mới'] },
      ],
    },
  }, {
    getProductVariantsByIdsOrSkus: async () => [existingVariant],
    getProductsByIds: async () => [existingProduct],
    updateProduct: async (_client, args) => {
      updates.push(args);
      return { ok: true, product: { ...existingProduct, name: args.payload.name, updated_at: '2026-09-17T00:00:01.000Z' } };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.updated, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.rows[0].errors[0].code, 'SKU_NOT_FOUND');
  assert.equal(result.rows[1].status, 'updated');
  assert.equal(updates.length, 1);
  assert.equal(updates[0].payload.name, 'Tên sản phẩm mới');
});

test('Cập nhật SP — cùng sản phẩm mà các SKU yêu cầu giá trị cấp sản phẩm khác nhau thì chỉ bỏ các dòng xung đột', async () => {
  const variants = [variant('SKU-A'), variant('SKU-B')];
  const result = await bulkUpdateProductVariants(null, {
    installationId: INSTALLATION_ID,
    updatedBy: 'test:user',
    payload: {
      dryRun: true,
      mappings: ['SKU', 'PRODUCT_NAME'],
      rows: [
        { rowNumber: 2, cells: ['SKU-A', 'Tên A'] },
        { rowNumber: 3, cells: ['SKU-B', 'Tên B'] },
      ],
    },
  }, {
    getProductVariantsByIdsOrSkus: async () => variants,
    getProductsByIds: async () => [product()],
  });

  assert.equal(result.ok, true);
  assert.equal(result.updated, 0);
  assert.equal(result.skipped, 2);
  assert.equal(result.rows[0].errors[0].code, 'CONFLICTING_PRODUCT_VALUES');
  assert.equal(result.rows[1].errors[0].code, 'CONFLICTING_PRODUCT_VALUES');
});

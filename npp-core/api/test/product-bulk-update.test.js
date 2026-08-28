import test from 'node:test';
import assert from 'node:assert/strict';
import { bulkUpdateProductVariants, identifyProductVariants } from '../src/services/product-bulk-update.js';

function variant(sku, overrides = {}) {
  return {
    id: `id-${sku}`,
    product_id: `product-${sku}`,
    sku,
    name: `Tên ${sku}`,
    variant_kind: 'BASE',
    is_inventory_base: false,
    is_sellable: true,
    is_catalog_visible: false,
    is_active: true,
    weight_value: '1',
    weight_uom_code: 'KG',
    updated_at: '2026-08-28T00:00:00.000Z',
    ...overrides,
  };
}

function deps(items, updates = []) {
  const bySku = new Map(items.map((item) => [item.sku, item]));
  return {
    getProductVariantBySku: async (_client, { sku }) => bySku.get(sku) ?? null,
    updateProductVariant: async (_client, args) => {
      updates.push(args);
      const current = bySku.get(items.find((item) => item.id === args.variantId)?.sku);
      return { ok: true, variant: { ...current, weight_value: args.payload.weightValue, weight_uom_code: args.payload.weightUomCode } };
    },
  };
}

test('Cập nhật SP — nhận diện SKU theo batch trước khi chọn thuộc tính cập nhật', async () => {
  let lookupCalls = 0;
  let requestedSkus = [];
  const result = await identifyProductVariants(null, {
    installationId: 'installation-test',
    payload: {
      rows: [
        { rowNumber: 2, cells: ['sku-a', '1'] },
        { rowNumber: 3, cells: ['SKU-KHONG-CO', '2'] },
        { rowNumber: 4, cells: ['sku-dup', '3'] },
        { rowNumber: 5, cells: ['SKU-DUP', '4'] },
        { rowNumber: 6, cells: ['', '5'] },
      ],
    },
  }, {
    getProductVariantsByIdsOrSkus: async (_client, { ids, skus }) => {
      lookupCalls += 1;
      assert.deepEqual(ids, []);
      requestedSkus = skus;
      return [variant('SKU-A', { product_name: 'Sản phẩm A' })];
    },
  });

  assert.equal(result.ok, true);
  assert.equal(lookupCalls, 1, 'nhận diện nhiều SKU phải dùng một truy vấn batch');
  assert.deepEqual(requestedSkus, ['SKU-A', 'SKU-KHONG-CO']);
  assert.equal(result.identified, 1);
  assert.equal(result.skipped, 4);
  assert.equal(result.rows[0].sku, 'SKU-A');
  assert.equal(result.rows[0].productName, 'Sản phẩm A');
  assert.equal(result.rows[1].errors[0].code, 'SKU_NOT_FOUND');
  assert.equal(result.rows[2].errors[0].code, 'DUPLICATE_SKU');
  assert.equal(result.rows[3].errors[0].code, 'DUPLICATE_SKU');
  assert.equal(result.rows[4].errors[0].code, 'MISSING_SKU');
});

test('Cập nhật SP — Bỏ qua, ô trống và cột thiếu giữ đúng ba semantics khác nhau', async () => {
  const updates = [];
  const existing = [variant('SKU-A'), variant('SKU-B'), variant('SKU-C')];
  const result = await bulkUpdateProductVariants(null, {
    installationId: 'installation-test',
    updatedBy: 'test:user',
    payload: {
      dryRun: false,
      mappings: ['SKU', 'IGNORE', 'WEIGHT_VALUE'],
      rows: [
        { rowNumber: 2, cells: ['SKU-A', 'không được đụng', '2.5'] },
        { rowNumber: 3, cells: ['SKU-B', 'không được đụng', ''] },
        { rowNumber: 4, cells: ['SKU-C'] },
      ],
    },
  }, deps(existing, updates));

  assert.equal(result.ok, true);
  assert.equal(result.updated, 2);
  assert.equal(updates.length, 2, 'cột bị thiếu ở SKU-C phải giữ nguyên, không phát sinh PATCH');
  assert.deepEqual(updates[0].payload.weightValue, '2.5');
  assert.deepEqual(updates[0].payload.weightUomCode, 'KG');
  assert.equal(updates[1].payload.weightValue, null, 'ô trống được map phải chủ động xóa khối lượng');
  assert.equal(updates[1].payload.weightUomCode, null, 'xóa khối lượng phải đưa cặp weight/uom về chưa khai báo');
  assert.equal(result.rows[2].status, 'unchanged');
});

test('Cập nhật SP — SKU không tồn tại bị báo lỗi và không tự tạo', async () => {
  const updates = [];
  const result = await bulkUpdateProductVariants(null, {
    installationId: 'installation-test',
    updatedBy: 'test:user',
    payload: {
      dryRun: false,
      mappings: ['SKU', 'WEIGHT_VALUE'],
      rows: [{ rowNumber: 2, cells: ['SKU-KHONG-CO', '1.2'] }],
    },
  }, deps([], updates));

  assert.equal(result.ok, true);
  assert.equal(result.updated, 0);
  assert.equal(updates.length, 0);
  assert.equal(result.rows[0].errors[0].code, 'SKU_NOT_FOUND');
});

test('Cập nhật SP — SKU trùng được nhận diện sau canonical normalize', async () => {
  const existing = [variant('SKU-DUP')];
  const result = await bulkUpdateProductVariants(null, {
    installationId: 'installation-test',
    updatedBy: 'test:user',
    payload: {
      dryRun: true,
      mappings: ['SKU', 'WEIGHT_VALUE'],
      rows: [
        { rowNumber: 2, cells: ['sku-dup', '1'] },
        { rowNumber: 3, cells: ['SKU-DUP', '2'] },
      ],
    },
  }, deps(existing));

  assert.equal(result.ok, true);
  assert.equal(result.rows[0].errors[0].code, 'DUPLICATE_SKU');
  assert.equal(result.rows[1].errors[0].code, 'DUPLICATE_SKU');
});

test('Cập nhật SP — không cho ánh xạ cùng thuộc tính vào hai cột', async () => {
  const result = await bulkUpdateProductVariants(null, {
    installationId: 'installation-test',
    updatedBy: 'test:user',
    payload: {
      dryRun: true,
      mappings: ['SKU', 'WEIGHT_VALUE', 'WEIGHT_VALUE'],
      rows: [{ rowNumber: 2, cells: ['SKU-A', '1', '2'] }],
    },
  }, deps([variant('SKU-A')]));

  assert.equal(result.ok, false);
  assert.equal(result.code, 'DUPLICATE_FIELD_MAPPING');
});

test('Cập nhật SP — SKU trống là lỗi dòng và 0 kg không hợp lệ', async () => {
  const result = await bulkUpdateProductVariants(null, {
    installationId: 'installation-test',
    updatedBy: 'test:user',
    payload: {
      dryRun: true,
      mappings: ['SKU', 'WEIGHT_VALUE', 'WEIGHT_UOM'],
      rows: [
        { rowNumber: 2, cells: ['', '1', 'KG'] },
        { rowNumber: 3, cells: ['SKU-ZERO', '0', 'KG'] },
      ],
    },
  }, deps([variant('SKU-ZERO')]));

  assert.equal(result.ok, true);
  assert.equal(result.rows[0].errors[0].code, 'MISSING_SKU');
  assert.equal(result.rows[1].errors[0].code, 'INVALID_WEIGHT');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import * as productRepo from '../src/db/repositories/products.js';
import * as variantRepo from '../src/db/repositories/product-variants.js';
import * as productService from '../src/services/product.js';
import { BUSINESS_PURGE_TARGETS, buildBusinessPurgePlan } from '../src/services/business-data-purge.js';

function queryRecorder({ updateMatcher, id, row }) {
  const calls = [];
  return {
    calls,
    client: {
      async query(sql, params = []) {
        calls.push({ sql: String(sql), params });
        if (String(sql).includes(updateMatcher)) return { rows: [{ id }] };
        return { rows: [row] };
      },
    },
  };
}

test('SKU repository does not duplicate the locked service stale-version guard', async () => {
  const productId = '11111111-1111-4111-8111-111111111111';
  const variantId = '22222222-2222-4222-8222-222222222222';
  const installationId = 'regression-product-import';
  const expected = new Date('2026-08-21T12:40:42.123Z');

  const product = queryRecorder({
    updateMatcher: 'UPDATE shared.products',
    id: productId,
    row: { id: productId, installation_id: installationId },
  });
  const updatedProduct = await productRepo.updateProduct(product.client, {
    id: productId,
    installationId,
    code: 'SP01',
    name: 'Sản phẩm',
    catalogName: null,
    categoryId: null,
    brandId: null,
    description: null,
    notes: null,
    isCatalogVisible: true,
    isOrderable: false,
    isActive: true,
    updatedBy: 'test:user',
    expectedUpdatedAt: expected,
  });
  assert.ok(updatedProduct);
  const productUpdate = product.calls.find((call) => call.sql.includes('UPDATE shared.products'));
  assert.ok(productUpdate);
  assert.match(productUpdate.sql, /date_trunc\('milliseconds', updated_at\) = date_trunc\('milliseconds', \$14::timestamptz\)/);

  const variant = queryRecorder({
    updateMatcher: 'UPDATE shared.product_variants',
    id: variantId,
    row: { id: variantId, installation_id: installationId, product_id: productId, sku: 'SKU01' },
  });
  const updatedVariant = await variantRepo.updateProductVariant(variant.client, {
    id: variantId,
    installationId,
    name: 'SKU',
    variantKind: 'BASE',
    isInventoryBase: true,
    isSellable: true,
    isCatalogVisible: true,
    isActive: true,
    updatedBy: 'test:import',
    expectedUpdatedAt: expected.toISOString(),
  });
  assert.ok(updatedVariant);
  const variantUpdate = variant.calls.find((call) => call.sql.includes('UPDATE shared.product_variants'));
  assert.ok(variantUpdate);
  assert.doesNotMatch(variantUpdate.sql, /timestamptz/);
  assert.equal(variantUpdate.params.length, 11);
  assert.deepEqual(variantUpdate.params.slice(6, 8), [undefined, undefined]);

  const staleCalls = [];
  const staleClient = {
    async query(sql, params = []) {
      const text = String(sql);
      staleCalls.push({ sql: text, params });
      if (text.includes('FROM shared.products p') && text.includes('FOR UPDATE OF p')) {
        return { rows: [{ id: productId, installation_id: installationId, is_active: true, is_orderable: false }] };
      }
      if (text.includes('FROM shared.product_variants pv') && text.includes('FOR UPDATE OF pv')) {
        return { rows: [{
          id: variantId,
          installation_id: installationId,
          product_id: productId,
          sku: 'SKU01',
          name: 'SKU',
          variant_kind: 'BASE',
          is_inventory_base: true,
          is_sellable: true,
          is_catalog_visible: true,
          is_active: true,
          updated_at: new Date('2026-08-21T12:40:43.123Z'),
        }] };
      }
      throw new Error(`Unexpected query: ${text}`);
    },
  };
  const stale = await productService.updateProductVariant(staleClient, {
    productId,
    variantId,
    installationId,
    payload: { name: 'SKU mới', expectedUpdatedAt: expected.toISOString() },
    updatedBy: 'test:user',
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.code, 'CONFLICT');
  assert.equal(stale.details?.reason, 'EXPECTED_UPDATED_AT_MISMATCH');
  assert.equal(staleCalls.some((call) => call.sql.includes('UPDATE shared.product_variants')), false);

  const unit = queryRecorder({
    updateMatcher: 'UPDATE shared.product_variants',
    id: variantId,
    row: { id: variantId, installation_id: installationId, product_id: productId, sku: 'SKU01' },
  });
  const updatedUnit = await variantRepo.updateVariantUnit(unit.client, {
    id: variantId,
    installationId,
    unitId: '33333333-3333-4333-8333-333333333333',
    conversionToBase: '1',
    isPurchasable: true,
    netContentValue: null,
    netContentUomCode: null,
    sourceUnitLabel: null,
    sourcePackageDescription: null,
    unitSourceMetadata: {},
    expectedUpdatedAt: expected,
    updatedBy: 'test:user',
  });
  assert.ok(updatedUnit);
  const unitUpdate = unit.calls.find((call) => call.sql.includes('UPDATE shared.product_variants'));
  assert.ok(unitUpdate);
  assert.match(unitUpdate.sql, /date_trunc\('milliseconds', updated_at\) = date_trunc\('milliseconds', \$12::timestamptz\)/);
});

test('Dữ liệu phát sinh preserves product lot, expiry and location tracking policy', async () => {
  const tables = [
    { schema_name: 'inventory', table_name: 'product_tracking_policies', has_installation_id: true },
    { schema_name: 'inventory', table_name: 'inventory_movements', has_installation_id: true },
    { schema_name: 'sales', table_name: 'sales_orders', has_installation_id: true },
  ];
  const client = {
    async query(sql) {
      const text = String(sql);
      if (text.includes('FROM pg_class c')) return { rows: tables };
      if (text.includes('FROM pg_constraint fk')) return { rows: [] };
      throw new Error(`Unexpected query: ${text}`);
    },
  };

  const operations = await buildBusinessPurgePlan(client, 'OPERATIONS_ONLY');
  const operationKeys = new Set(operations.tables.map((table) => table.key));
  assert.equal(operationKeys.has('inventory.product_tracking_policies'), false);
  assert.equal(operationKeys.has('inventory.inventory_movements'), true);
  assert.match(BUSINESS_PURGE_TARGETS.OPERATIONS_ONLY.description, /cấu hình lô\/hạn dùng/i);

  const all = await buildBusinessPurgePlan(client, 'ALL_BUSINESS_DATA');
  assert.equal(new Set(all.tables.map((table) => table.key)).has('inventory.product_tracking_policies'), true);

  const productsAndInventory = await buildBusinessPurgePlan(client, 'PRODUCTS_AND_INVENTORY');
  assert.equal(new Set(productsAndInventory.tables.map((table) => table.key)).has('inventory.product_tracking_policies'), true);
});

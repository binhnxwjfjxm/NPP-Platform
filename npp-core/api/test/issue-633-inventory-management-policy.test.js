import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { salesFulfillmentInternals } from '../src/services/sales-fulfillment.js';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

function row({ lineNumber, managed, baseVariantIds = [], warehouseId = 'warehouse-1' }) {
  return Object.freeze({
    sales_order_id: 'order-1',
    sales_order_version_id: 'version-1',
    sales_order_line_id: `line-${lineNumber}`,
    line_number: lineNumber,
    warehouse_id: warehouseId,
    sales_variant_id: `variant-${lineNumber}`,
    sku_snapshot: `SKU-${lineNumber}`,
    ordered_base_quantity: '2.000000000000',
    is_inventory_managed: managed,
    base_variant_ids: baseVariantIds,
  });
}

const requestContext = Object.freeze({
  scopes: Object.freeze({ warehouseIds: Object.freeze(['warehouse-1']) }),
});

test('Issue #633 uses an explicit product inventory-management policy, not is_inventory_base semantics', async () => {
  const [migration, repository] = await Promise.all([
    read('../../database/migrations/shared/091_product_inventory_management_policy.sql'),
    read('src/db/repositories/sales-fulfillment.js'),
  ]);

  assert.match(migration, /is_inventory_managed boolean NOT NULL DEFAULT true/);
  assert.match(migration, /separate from product_variants\.is_inventory_base/);
  assert.match(repository, /product\.is_inventory_managed/);
  assert.match(repository, /JOIN shared\.products product/);
});

test('mixed Sales Order sends only inventory-managed lines into Warehouse', () => {
  const normalized = salesFulfillmentInternals.normalizeInputRows([
    row({ lineNumber: 1, managed: true, baseVariantIds: ['base-1'] }),
    row({ lineNumber: 2, managed: false }),
  ], requestContext);

  assert.equal(normalized.ok, true);
  assert.equal(normalized.lines.length, 1);
  assert.equal(normalized.lines[0].lineNumber, 1);
  assert.equal(normalized.lines[0].baseVariantId, 'base-1');
});

test('non-inventory Sales lines do not require warehouse scope or inventory-base SKU', () => {
  const normalized = salesFulfillmentInternals.normalizeInputRows([
    row({ lineNumber: 1, managed: false, warehouseId: 'outside-scope' }),
  ], requestContext);

  assert.equal(normalized.ok, true);
  assert.deepEqual(normalized.lines, []);
  assert.equal(salesFulfillmentInternals.fulfillmentStatus({ reserved: 0n, backordered: 0n }), 'fulfilled');
});

test('inventory-managed lines still fail closed without exactly one active inventory-base SKU', () => {
  const normalized = salesFulfillmentInternals.normalizeInputRows([
    row({ lineNumber: 1, managed: true, baseVariantIds: [] }),
  ], requestContext);

  assert.equal(normalized.ok, false);
  assert.equal(normalized.code, 'INVENTORY_BASE_VARIANT_REQUIRED');
});

test('missing inventory-management policy fails closed instead of guessing from inventory-base data', () => {
  const normalized = salesFulfillmentInternals.normalizeInputRows([
    row({ lineNumber: 1, managed: undefined, baseVariantIds: ['base-1'] }),
  ], requestContext);

  assert.equal(normalized.ok, false);
  assert.equal(normalized.code, 'INVENTORY_MANAGEMENT_POLICY_REQUIRED');
});

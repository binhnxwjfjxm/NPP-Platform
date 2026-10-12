import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/db/repositories/inventory-balance.js', import.meta.url), 'utf8');
const getStart = source.indexOf('export async function getInventoryBalance');
const listStart = source.indexOf('export async function listInventoryBalances');
const reconcileStart = source.indexOf('export async function reconcileInventoryBalances');
const getBalance = source.slice(getStart, listStart);
const listBalances = source.slice(listStart, reconcileStart);

function assertOperatorIdentity(section) {
  assert.match(section, /warehouse\.code AS warehouse_code/);
  assert.match(section, /warehouse\.name AS warehouse_name/);
  assert.match(section, /location\.code AS location_code/);
  assert.match(section, /location\.name AS location_name/);
  assert.match(section, /base\.sku AS base_sku/);
  assert.match(section, /base\.name AS base_variant_name/);
  assert.match(section, /JOIN shared\.warehouses warehouse/);
  assert.match(section, /LEFT JOIN shared\.warehouse_locations location/);
  assert.match(section, /JOIN shared\.product_variants base/);
}

function assertProductAndPackagingReadContract(section) {
  assert.match(section, /product\.code AS product_code/);
  assert.match(section, /product\.name AS product_name/);
  assert.match(section, /base\.conversion_to_base AS base_conversion_to_base/);
  assert.match(section, /base_unit\.name AS base_unit_name/);
  assert.match(section, /packaging\.conversion_to_base AS package_conversion_to_base/);
  assert.match(section, /package_unit\.name AS package_unit_name/);
  assert.match(section, /package_unit\.unit_kind = 'PACKAGE'/);
  assert.match(section, /packaging\.product_id = base\.product_id/);
  assert.match(section, /balance\.on_hand_quantity/);
  assert.match(section, /balance\.reserved_quantity/);
  assert.match(section, /balance\.available_quantity/);
}

test('inventory balance detail exposes operator-facing warehouse, location and SKU identity', () => {
  assert.ok(getStart >= 0 && listStart > getStart);
  assertOperatorIdentity(getBalance);
  assertProductAndPackagingReadContract(getBalance);
});

test('inventory balance list exposes product name and canonical packaging metadata without replacing stock balances', () => {
  assert.ok(listStart >= 0 && reconcileStart > listStart);
  assertOperatorIdentity(listBalances);
  assertProductAndPackagingReadContract(listBalances);
});

test('inventory catalog read includes zero-stock base SKU per allowed warehouse without creating stock', async () => {
  const { listInventoryBalances } = await import('../src/db/repositories/inventory-balance.js');
  const queries = [];
  const row = {
    installation_id: 'installation-1',
    warehouse_id: 'warehouse-1',
    base_variant_id: 'variant-1',
    base_sku: 'NEW-SKU',
    product_name: 'Hàng mới chưa nhập',
    on_hand_quantity: '0.000000000000',
    reserved_quantity: '0.000000000000',
    available_quantity: '0.000000000000',
    expiry_date: null,
  };
  const client = { query: async (sql, params) => {
    queries.push({ sql, params });
    return { rows: [row] };
  } };
  const result = await listInventoryBalances(client, {
    installationId: 'installation-1',
    warehouseIds: ['warehouse-1'],
    includeCatalog: true,
    limit: 100,
    offset: 0,
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].on_hand_quantity, '0.000000000000');
  assert.match(queries[0].sql, /catalog_product\.is_inventory_managed = true/);
  assert.match(queries[0].sql, /base\.is_inventory_base = true/);
  assert.match(queries[0].sql, /UNION ALL/);
  assert.match(queries[0].sql, /AND warehouse\.id = ANY\(\$7::uuid\[\]\)\s+AND warehouse\.is_active = true/);
  assert.match(queries[0].sql, /AND warehouse\.id = balance\.warehouse_id\s+AND warehouse\.is_active = true/);
  assert.match(queries[0].sql, /warehouse\.location_management_mode AS warehouse_location_management_mode/);
  assert.match(queries[0].sql, /warehouse\.location_management_mode = 'UNMANAGED'/);
  assert.match(queries[0].sql, /balance\.location_id IS NOT NULL/);
  assert.match(queries[0].sql, /balance\.on_hand_quantity = 0/);
  assert.match(queries[0].sql, /balance\.reserved_quantity = 0/);
  assert.match(queries[0].sql, /balance\.available_quantity = 0/);
  assert.match(queries[0].sql, /warehouse\.location_management_mode IS DISTINCT FROM 'UNMANAGED'/);
  assert.match(queries[0].sql, /recorded\.location_id IS NULL/);
  assert.match(queries[0].sql, /recorded\.on_hand_quantity <> 0/);
  assert.match(queries[0].sql, /recorded\.reserved_quantity <> 0/);
  assert.match(queries[0].sql, /recorded\.available_quantity <> 0/);
  assert.match(queries[0].sql, /NOT EXISTS \(/);
  assert.match(queries[0].sql, /existing\.warehouse_id = ANY\(\$7::uuid\[\]\)/);
  assert.match(queries[0].sql, /warehouse\.id = ANY\(\$7::uuid\[\]\)/);
  assert.deepEqual(queries[0].params[6], ['warehouse-1']);
  assert.doesNotMatch(queries[0].sql, /INSERT INTO|UPDATE inventory\.|DELETE FROM/i);
  queries.length = 0;
  await listInventoryBalances(client, { installationId: 'installation-1', limit: 100, offset: 0 });
  assert.doesNotMatch(queries[0].sql, /UNION ALL/);
  assert.doesNotMatch(queries[0].sql, /warehouse\.is_active = true/);
  assert.doesNotMatch(queries[0].sql, /AND NOT \(warehouse\.location_management_mode = 'UNMANAGED'/);
  assert.equal(queries[0].params.length, 6);
});

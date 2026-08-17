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

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { searchManualInboundProducts } from '../src/services/manual-inbound-product-search.js';

const source = readFileSync(new URL('../src/services/manual-inbound-product-search.js', import.meta.url), 'utf8');
const migrationList = readFileSync(new URL('../src/migrations/index.js', import.meta.url), 'utf8');
const index = readFileSync(new URL('../../../database/migrations/inventory/169_manual_inbound_last_entered_cost_lookup.sql', import.meta.url), 'utf8');
const warehouseId = '11111111-1111-4111-8111-111111111111';
const variantId = '22222222-2222-4222-8222-222222222222';
const unitId = '33333333-3333-4333-8333-333333333333';
const otherUnitId = '44444444-4444-4444-8444-444444444444';
const requestContext = {
  installationId: 'installation-1',
  permissions: ['core.inventory-manual-inbound.prepare'],
  scopes: { warehouseIds: [warehouseId] },
};

test('exact warehouse/variant/unit price returned separately from current average', async () => {
  const queries = [];
  const client = { async query(sql, params) {
    queries.push({ sql, params });
    if (queries.length === 1) return { rows: [{ location_management_mode: 'UNMANAGED' }] };
    if (queries.length === 2) return { rows: [{
      id: variantId, unit_id: unitId, sku: 'BOT1LY',
      average_unit_cost: '400000.000000000000',
    }] };
    return { rows: [
      { source_variant_id: variantId, source_unit_id: otherUnitId, entered_unit_cost: '800000.000000000000' },
      { source_variant_id: variantId, source_unit_id: unitId, entered_unit_cost: '595000.000000000000' },
    ] };
  } };
  const result = await searchManualInboundProducts(client, { requestContext, warehouseId, search: 'BOT1LY' });
  assert.equal(result.ok, true);
  assert.equal(result.products[0].lastEnteredUnitCost, '595000.000000000000');
  assert.equal(result.products[0].unitCost, '400000.000000000000');
  assert.deepEqual(queries[2].params, [requestContext.installationId, warehouseId, [variantId]]);
});

test('no prior explicit price leaves blank suggestion without replacing current cost', async () => {
  let count = 0;
  const client = { async query() {
    count += 1;
    if (count === 1) return { rows: [{ location_management_mode: 'UNMANAGED' }] };
    if (count === 2) return { rows: [{
      id: variantId, unit_id: unitId, sku: 'BOT1LY', average_unit_cost: '400000.000000000000',
    }] };
    return { rows: [] };
  } };
  const result = await searchManualInboundProducts(client, { requestContext, warehouseId, search: 'BOT1LY' });
  assert.equal(result.ok, true);
  assert.equal(result.products[0].lastEnteredUnitCost, null);
  assert.equal(result.products[0].unitCost, '400000.000000000000');
});

test('history lookup filters only explicit prices from non-reversed receipts, with a supporting index', () => {
  for (const marker of [
    'DISTINCT ON (line.source_variant_id, line.source_unit_id)',
    'line.warehouse_id = $2',
    'line.source_variant_id = ANY($3::uuid[])',
    "line.currency_code = 'VND'",
    "manualInboundCostSource') IS DISTINCT FROM 'CURRENT'",
    'reversal.reversal_of_movement_id = receipt.movement_id',
    'receipt.created_at DESC',
  ]) assert.ok(source.includes(marker), marker);
  assert.ok(!source.includes('coreSales'));
  assert.ok(index.includes('manual_inbound_last_entered_cost_lookup_idx'));
  assert.ok(migrationList.includes('169_manual_inbound_last_entered_cost_lookup'));
});

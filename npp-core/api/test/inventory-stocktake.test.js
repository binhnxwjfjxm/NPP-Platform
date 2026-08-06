import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { stocktakeInternals } from '../src/services/inventory-stocktake.js';

const migration = readFileSync(
  new URL('../../../database/migrations/inventory/060_inventory_stocktake.sql', import.meta.url),
  'utf8',
);
const routeSource = readFileSync(
  new URL('../src/routes/inventory-stocktakes.js', import.meta.url),
  'utf8',
);
const serviceSource = readFileSync(
  new URL('../src/services/inventory-stocktake.js', import.meta.url),
  'utf8',
);

test('Phase 7.3 migration registers stocktake permissions and exact-scope watermark', () => {
  for (const permission of [
    'core.stocktake.read',
    'core.stocktake.create',
    'core.stocktake.count',
    'core.stocktake.submit',
    'core.stocktake.approve',
    'core.stocktake.post',
    'core.stocktake.cancel',
    'core.stocktake.reverse',
  ]) {
    assert.match(migration, new RegExp(permission.replaceAll('.', '\\.')));
  }
  assert.match(migration, /inventory_scope_versions/);
  assert.match(migration, /UNIQUE NULLS NOT DISTINCT/);
  assert.match(migration, /bump_inventory_scope_version/);
  assert.match(migration, /stocktakes_submitter_approver_separation/);
  assert.doesNotMatch(migration, /UPDATE\s+inventory\.inventory_balances/i);
});

test('stocktake revision accepts the initial zero revision without allowing padded values', () => {
  assert.equal(stocktakeInternals.parseRevision('0'), '0');
  assert.equal(stocktakeInternals.parseRevision(0), '0');
  assert.equal(stocktakeInternals.parseRevision('1'), '1');
  assert.equal(stocktakeInternals.parseRevision('00'), null);
  assert.equal(stocktakeInternals.parseRevision('-1'), null);
});

test('stocktake decimal arithmetic keeps twelve decimal places without JavaScript float', () => {
  const parsed = stocktakeInternals.parseDecimal12('123.456789012345', 'quantity');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value, '123.456789012345');

  const normal = stocktakeInternals.movementRepresentation(12_500_000_000_000n);
  assert.deepEqual(normal, {
    sourceQuantity: '12.500000',
    conversionToBase: '1.000000',
  });

  const micro = stocktakeInternals.movementRepresentation(123_456_789_012n);
  assert.deepEqual(micro, {
    sourceQuantity: '123456.789012',
    conversionToBase: '0.000001',
  });
});

test('stocktake scope input rejects duplicate exact location, SKU and lot', () => {
  const result = stocktakeInternals.normalizeScopes({
    warehouseId: '11111111-1111-4111-8111-111111111111',
    scopes: [
      {
        locationId: null,
        baseVariantId: '22222222-2222-4222-8222-222222222222',
        lotId: null,
      },
      {
        locationId: null,
        baseVariantId: '22222222-2222-4222-8222-222222222222',
        lotId: null,
      },
    ],
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'DUPLICATE_STOCKTAKE_SCOPE');
});

test('stocktake route and service enforce blind count, independent approval and guarded reversal', () => {
  assert.match(routeSource, /core\.stocktake\.count/);
  assert.match(routeSource, /core\.stocktake\.approve/);
  assert.match(routeSource, /count\|submit\|recount\|approve\|post\|cancel\|reverse/);
  assert.match(serviceSource, /STOCKTAKE_SELF_APPROVAL_DENIED/);
  assert.match(serviceSource, /STOCKTAKE_SCOPE_CHANGED/);
  assert.match(serviceSource, /STOCKTAKE_REVERSAL_DOWNSTREAM_CONFLICT/);
  assert.match(serviceSource, /revealExpected: false/);
  assert.match(serviceSource, /movementType: reversalOfMovementId \? 'STOCKTAKE_ADJUSTMENT_REVERSAL' : 'STOCKTAKE_ADJUSTMENT'/);
});

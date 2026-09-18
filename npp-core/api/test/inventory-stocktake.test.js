import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { stocktakeInternals } from '../src/services/inventory-stocktake.js';

const migration = readFileSync(
  new URL('../../../database/migrations/inventory/060_inventory_stocktake.sql', import.meta.url),
  'utf8',
);
const lineDetailsMigration = readFileSync(
  new URL('../../../database/migrations/inventory/138_inventory_stocktake_line_details.sql', import.meta.url),
  'utf8',
);
const lineAnnotationMigration = readFileSync(
  new URL('../../../database/migrations/inventory/139_inventory_stocktake_line_annotation.sql', import.meta.url),
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
const stocktakeRepositorySource = readFileSync(
  new URL('../src/db/repositories/inventory-stocktake.js', import.meta.url),
  'utf8',
);
const ledgerRepositorySource = readFileSync(
  new URL('../src/db/repositories/inventory-ledger.js', import.meta.url),
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

test('stocktake line details migration persists reason/note and locks completed round history', () => {
  assert.match(lineDetailsMigration, /count_reason text NULL/);
  assert.match(lineDetailsMigration, /count_note text NULL/);
  assert.match(lineDetailsMigration, /stocktake_lines_count_reason_length/);
  assert.match(lineDetailsMigration, /stocktake_lines_count_note_length/);
  assert.match(lineDetailsMigration, /header_status NOT IN \('draft', 'recount_required'\)/);
  assert.match(lineDetailsMigration, /OLD\.count_reason IS DISTINCT FROM NEW\.count_reason/);
  assert.match(lineDetailsMigration, /OLD\.count_note IS DISTINCT FROM NEW\.count_note/);
});

test('stocktake line annotation migration only opens controlled reason/note writes before posting', () => {
  assert.match(lineAnnotationMigration, /write_context = 'annotation'/);
  assert.match(lineAnnotationMigration, /header_status IN \('submitted', 'approved'\)/);
  assert.match(lineAnnotationMigration, /stocktake_annotation_update_invalid/);
  assert.match(lineAnnotationMigration, /OLD\.final_delta IS DISTINCT FROM NEW\.final_delta/);
  assert.match(lineAnnotationMigration, /OLD\.posted_scope_version IS DISTINCT FROM NEW\.posted_scope_version/);
});

test('stocktake line comparison status never leaks the hidden system quantity', () => {
  const uncounted = { counted_base_quantity: null, expected_base_quantity: '10.000000000000' };
  const matched = { counted_base_quantity: '10.000000000000', expected_base_quantity: '10.000000000000' };
  const mismatch = { counted_base_quantity: '9.000000000000', expected_base_quantity: '10.000000000000' };

  assert.equal(stocktakeInternals.lineCountStatus(uncounted, false), 'uncounted');
  assert.equal(stocktakeInternals.lineCountStatus(matched, false), null);
  assert.equal(stocktakeInternals.lineCountStatus(mismatch, false), null);
  assert.equal(stocktakeInternals.lineCountStatus(matched, true), 'matched');
  assert.equal(stocktakeInternals.lineCountStatus(mismatch, true), 'mismatch');
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

test('manual stocktake modes are server-owned and exact scope input has no business line ceiling', () => {
  const warehouseId = '11111111-1111-4111-8111-111111111111';
  const baseVariantId = '22222222-2222-4222-8222-222222222222';
  const locationId = '33333333-3333-4333-8333-333333333333';

  const all = stocktakeInternals.normalizeScopes({ warehouseId, scopeMode: 'all' });
  assert.equal(all.ok, true);
  assert.equal(all.value.scopeMode, 'all');
  assert.deepEqual(all.value.scopes, []);
  assert.deepEqual(all.value.selectors, []);

  const lot = stocktakeInternals.normalizeScopes({
    warehouseId,
    scopeMode: 'lot',
    lotSelections: [{ baseVariantId, lotId: null }],
  });
  assert.equal(lot.ok, true);
  assert.equal(lot.value.scopeMode, 'lot');
  assert.deepEqual(lot.value.selectors, [{
    location_id: null,
    base_variant_id: baseVariantId,
    lot_id: null,
  }]);

  const location = stocktakeInternals.normalizeScopes({
    warehouseId,
    scopeMode: 'location',
    locationIds: [locationId, null],
  });
  assert.equal(location.ok, true);
  assert.equal(location.value.scopeMode, 'location');
  assert.deepEqual(location.value.selectors, [
    { location_id: locationId, base_variant_id: null, lot_id: null },
    { location_id: null, base_variant_id: null, lot_id: null },
  ]);

  const scopes = Array.from({ length: 2001 }, (_, index) => ({
    locationId: null,
    baseVariantId: `22222222-2222-4222-8222-${(index + 1).toString(16).padStart(12, '0')}`,
    lotId: null,
  }));
  const exact = stocktakeInternals.normalizeScopes({ warehouseId, scopes });
  assert.equal(exact.ok, true);
  assert.equal(exact.value.scopeMode, 'exact');
  assert.equal(exact.value.scopes.length, 2001);
});

test('stocktake large-write path is set-based and reuses the canonical request idempotency key', () => {
  assert.match(stocktakeRepositorySource, /jsonb_to_recordset\(\$1::jsonb\)/);
  assert.match(stocktakeRepositorySource, /export async function insertLines/);
  assert.match(stocktakeRepositorySource, /export async function loadDerivedScopeSnapshots/);
  assert.match(stocktakeRepositorySource, /FROM inventory\.inventory_balances balance/);
  assert.match(ledgerRepositorySource, /export async function insertMovementLines/);
  assert.match(serviceSource, /isValidIdempotencyKey/);
  assert.doesNotMatch(serviceSource, /IDEMPOTENCY_PATTERN/);
  assert.doesNotMatch(serviceSource, /idempotencyKey:\s*`\$\{idempotencyKey\}:/);
});

test('stocktake route and service enforce blind count, independent approval and guarded reversal', () => {
  assert.match(routeSource, /core\.stocktake\.count/);
  assert.match(routeSource, /core\.stocktake\.approve/);
  assert.match(routeSource, /count\|annotate\|submit\|recount\|approve\|post\|cancel\|reverse\|copy/);
  assert.match(serviceSource, /STOCKTAKE_SELF_APPROVAL_DENIED/);
  assert.match(serviceSource, /STOCKTAKE_SCOPE_CHANGED/);
  assert.match(serviceSource, /STOCKTAKE_REVERSAL_DOWNSTREAM_CONFLICT/);
  assert.match(serviceSource, /revealExpected: false/);
  assert.match(serviceSource, /movementType: reversalOfMovementId \? 'STOCKTAKE_ADJUSTMENT_REVERSAL' : 'STOCKTAKE_ADJUSTMENT'/);
});


test('stocktake count payload stores per-line reason and note through the set-based update', () => {
  assert.match(serviceSource, /INVALID_STOCKTAKE_LINE_REASON/);
  assert.match(serviceSource, /INVALID_STOCKTAKE_LINE_NOTE/);
  assert.match(serviceSource, /count_reason: reason\.value/);
  assert.match(serviceSource, /count_note: note\.value/);
  assert.match(stocktakeRepositorySource, /item\.count_reason/);
  assert.match(stocktakeRepositorySource, /item\.count_note/);
  assert.match(stocktakeRepositorySource, /count_reason = input\.count_reason/);
  assert.match(stocktakeRepositorySource, /count_note = input\.count_note/);
});


test('stocktake copy and annotation stay backend-owned and audited', () => {
  assert.match(serviceSource, /export async function copyStocktake/);
  assert.match(serviceSource, /Sao chép từ/);
  assert.match(serviceSource, /createStocktake\(client/);
  assert.match(serviceSource, /export async function annotateStocktake/);
  assert.match(serviceSource, /updateLineAnnotations/);
  assert.match(stocktakeRepositorySource, /npp\.stocktake_write_context', 'annotation'/);
  assert.match(routeSource, /inventory\.stocktake\.copied/);
  assert.match(routeSource, /inventory\.stocktake\.annotated/);
  assert.match(routeSource, /copy: PERMISSIONS\.create/);
  assert.match(routeSource, /annotate: PERMISSIONS\.count/);
});


test('manual stocktake creation derives current scope on the backend instead of comparing browser scope count', () => {
  assert.match(serviceSource, /normalized\.value\.scopeMode === 'exact'/);
  assert.match(serviceSource, /repository\.loadDerivedScopeSnapshots/);
  assert.match(serviceSource, /scopeMode: normalized\.value\.scopeMode/);
  assert.doesNotMatch(serviceSource, /STOCKTAKE_MAX_LINES/);
  assert.match(serviceSource, /snapshots\.length < 1/);
});


test('stocktake whole-warehouse scope keeps zero-balance rows and follows warehouse location mode', () => {
  assert.doesNotMatch(
    stocktakeRepositorySource,
    /on_hand_quantity\s*(?:<>|>|=)\s*0/,
  );
  assert.match(stocktakeRepositorySource, /warehouse\.location_management_mode = 'UNMANAGED' AND balance\.location_id IS NULL/);
  assert.match(stocktakeRepositorySource, /warehouse\.location_management_mode = 'MANAGED'/);
  assert.match(stocktakeRepositorySource, /balance\.location_id IS NOT NULL/);
  assert.match(serviceSource, /WAREHOUSE_LOCATION_MODE_REQUIRED/);
});

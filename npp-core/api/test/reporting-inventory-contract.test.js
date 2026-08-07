import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PERMISSIONS, PERMISSION_REGISTRY } from '../src/access/permissions.js';
import { inventoryReportingInternals } from '../src/routes/reporting-inventory.js';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('8.2 registers dedicated inventory reporting permission', () => {
  assert.equal(PERMISSIONS.coreReportingInventoryRead, 'core.reporting.inventory.read');
  assert.equal(PERMISSION_REGISTRY.has(PERMISSIONS.coreReportingInventoryRead), true);
});

test('8.2 slow-moving threshold is explicit and bounded', () => {
  assert.equal(inventoryReportingInternals.normalizeSlowDays(null), 90);
  assert.equal(inventoryReportingInternals.normalizeSlowDays('30'), 30);
  assert.equal(inventoryReportingInternals.normalizeSlowDays('365'), 365);
  assert.equal(inventoryReportingInternals.normalizeSlowDays('29'), null);
  assert.equal(inventoryReportingInternals.normalizeSlowDays('366'), null);
  assert.equal(inventoryReportingInternals.normalizeSlowDays('90.5'), null);
  assert.equal(inventoryReportingInternals.normalizeSlowDays('abc'), null);
});

test('8.2 inventory report keeps immutable quantity truth and rebuildable read models separate', () => {
  const route = source('../src/routes/reporting-sales-purchasing.js');
  const inventory = source('../src/routes/reporting-inventory.js');

  assert.match(route, /\/api\/reporting\/inventory/);
  assert.match(route, /coreReportingInventoryRead/);
  assert.match(route, /INVALID_REPORTING_SLOW_DAYS/);
  assert.match(inventory, /inventory\.inventory_movements/);
  assert.match(inventory, /inventory\.inventory_movement_lines/);
  assert.match(inventory, /inventory\.inventory_balances/);
  assert.match(inventory, /inventory\.inventory_cost_balances/);
  assert.match(inventory, /inventory\.inventory_cost_reconciliation/);
  assert.match(inventory, /inventory\.inventory_lots/);
  assert.match(inventory, /warehouse_id = ANY\(\$2::uuid\[\]\)/);
  assert.match(inventory, /MWA_V1/);
  assert.match(inventory, /no guessed FIFO age for non-lot MWA stock/);
  assert.doesNotMatch(inventory, /readJsonBody|executeRequestWithIdempotency|withAuditOutboxTransaction/);
});

test('8.2 period flow is SKU-scoped and canonical decimals remain strings', () => {
  const inventory = source('../src/routes/reporting-inventory.js');

  assert.match(inventory, /GROUP BY line\.warehouse_id, warehouse\.code, warehouse\.name,\s*line\.base_variant_id, variant\.sku/s);
  assert.match(inventory, /opening_quantity/);
  assert.match(inventory, /inbound_quantity/);
  assert.match(inventory, /outbound_quantity/);
  assert.match(inventory, /closing_quantity/);
  assert.match(inventory, /on_hand_quantity::text/);
  assert.match(inventory, /reserved_quantity::text/);
  assert.match(inventory, /available_quantity::text/);
  assert.match(inventory, /inventory_value::text/);
  assert.match(inventory, /average_unit_cost::text/);
  assert.match(inventory, /ORDER BY count\(DISTINCT movement\.id\) DESC, movement\.movement_type/);
  assert.doesNotMatch(inventory, /ORDER BY movement_count::bigint/);
  assert.doesNotMatch(inventory, /parseFloat\(|parseInt\(/);
});

test('8.2 costing watermark is scoped and requires rebuild evidence for every requested warehouse', () => {
  const inventory = source('../src/routes/reporting-inventory.js');

  assert.match(inventory, /FROM inventory\.inventory_cost_rebuild_runs run/);
  assert.match(inventory, /unnest\(run\.warehouse_ids\) AS scoped_warehouse\(warehouse_id\)/);
  assert.match(inventory, /scoped_warehouse\.warehouse_id = ANY\(\$2::uuid\[\]\)/);
  assert.match(inventory, /\$5::uuid IS NULL OR scoped_warehouse\.warehouse_id = \$5::uuid/);
  assert.match(inventory, /count\(\*\) = CASE WHEN \$5::uuid IS NULL THEN cardinality\(\$2::uuid\[\]\) ELSE 1 END/);
  assert.match(inventory, /THEN min\(completed_at\)/);
});

test('8.2 aging and slow-moving logic only uses canonical lot dates and outbound movements', () => {
  const inventory = source('../src/routes/reporting-inventory.js');

  assert.match(inventory, /lot\.manufactured_date/);
  assert.match(inventory, /lot\.expiry_date/);
  assert.match(inventory, /line\.direction = 'OUT'/);
  assert.match(inventory, /last_out_date/);
  assert.match(inventory, /never_outbound/);
  assert.match(inventory, /EXPIRING_30_DAYS/);
  assert.match(inventory, /EXPIRING_90_DAYS/);
});

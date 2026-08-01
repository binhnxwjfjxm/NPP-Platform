import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const salesOrderService = readFileSync(new URL('../src/services/sales-order.js', import.meta.url), 'utf8');
const salesOrderEntry = readFileSync(new URL('../src/services/sales-order-entry.js', import.meta.url), 'utf8');
const commercialRepository = readFileSync(new URL('../src/db/repositories/sales-order-commercial.js', import.meta.url), 'utf8');
const pricingRoutes = readFileSync(new URL('../src/routes/pricing.js', import.meta.url), 'utf8');
const workflow = readFileSync(new URL('../../../.github/workflows/phase-6b2-sales-commercial.yml', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../../../database/migrations/sales/040_sales_order_commercial_controls.sql', import.meta.url), 'utf8');

test('Sales Order pricing time and confirmation target are server-owned', () => {
  assert.match(salesOrderService, /priceAt: new Date\(\)\.toISOString\(\)/);
  assert.doesNotMatch(salesOrderService, /priceAt: payload\.pricingAt/);
  assert.match(salesOrderService, /legacy\.confirmSalesOrder\(client, \{[\s\S]*versionNumber: resolvedVersion/);
});

test('sales channel UUIDs fail cleanly before PostgreSQL lookup', () => {
  assert.match(salesOrderEntry, /const UUID_PATTERN/);
  const validation = salesOrderEntry.indexOf('UUID_PATTERN.test(salesChannelId)');
  const lookup = salesOrderEntry.indexOf('getActiveSalesChannel(client');
  assert.ok(validation >= 0 && lookup > validation);
});

test('commercial price reads normalize numeric scale consistently', () => {
  assert.match(commercialRepository, /trim_scale\(line\.base_unit_price\)::text AS base_unit_price/);
  assert.match(commercialRepository, /trim_scale\(line\.system_unit_price\)::text AS system_unit_price/);
});

test('manual pricing resolution requires the dedicated Sales Order override permission', () => {
  assert.match(pricingRoutes, /manualSupplied/);
  assert.match(pricingRoutes, /coreSalesOrderPriceOverride/);
  assert.match(pricingRoutes, /PRICE_OVERRIDE_FORBIDDEN/);
});

test('migration preserves unknown manual-override history instead of inventing system price', () => {
  assert.match(migration, /WHEN price_source = 'MANUAL_OVERRIDE' THEN system_unit_price/);
  assert.doesNotMatch(migration, /system_unit_price = COALESCE\(system_unit_price, unit_price\)\nWHERE/);
});

test('Phase 6B.2 workflow does not persist checkout credentials and propagates pipeline failures', () => {
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /defaults:[\s\S]*run:[\s\S]*shell: bash/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { CORE_API_MIGRATIONS } from '../src/migrations/index.js';

const sql = readFileSync(
  new URL('../../../database/migrations/sales/040_sales_order_commercial_controls.sql', import.meta.url),
  'utf8',
);

test('migration 040 remains registered once and precedes migration 041', () => {
  const migrationIds = CORE_API_MIGRATIONS.map((entry) => entry.id);
  const migration040Index = migrationIds.indexOf('040_sales_order_commercial_controls');
  assert.notEqual(migration040Index, -1);
  assert.equal(migrationIds.filter((id) => id === '040_sales_order_commercial_controls').length, 1);
  assert.equal(migrationIds[migration040Index + 1], '041_customer_onboarding_requests');
});

test('migration 040 owns channel, document discount and line price provenance', () => {
  for (const token of [
    'default_sales_channel_id',
    'sales_channel_code_snapshot',
    'sales_channel_name_snapshot',
    'document_discount_mode',
    'document_discount_value',
    'document_discount_reason',
    'base_unit_price',
    'system_unit_price',
    'manual_override_reason',
    'pricing_trace_snapshot',
    'core.sales-order.discount.override',
  ]) assert.match(sql, new RegExp(token));
});

test('migration 040 backfills immutable history under one locked trigger window', () => {
  const disable = sql.indexOf('DISABLE TRIGGER sales_order_version_lines_draft_only');
  const backfill = sql.indexOf('UPDATE sales.sales_order_version_lines');
  const enable = sql.indexOf('ENABLE TRIGGER sales_order_version_lines_draft_only');
  assert.ok(disable >= 0, 'draft-only guard must be disabled for historical backfill');
  assert.ok(backfill > disable, 'backfill must run after the guard is disabled');
  assert.ok(enable > backfill, 'draft-only guard must be re-enabled after the backfill');
  assert.match(sql, /ACCESS EXCLUSIVE lock/);
});

test('migration 040 defers the line provenance invariant to transaction commit', () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION sales\.enforce_sales_order_line_price_provenance/);
  assert.match(sql, /CREATE CONSTRAINT TRIGGER sales_order_line_price_provenance_deferred/);
  assert.match(sql, /DEFERRABLE INITIALLY DEFERRED/);
  assert.match(sql, /sales_order_line_price_provenance_required/);
  assert.doesNotMatch(sql, /ALTER COLUMN base_unit_price SET NOT NULL/);
  assert.doesNotMatch(sql, /ALTER COLUMN system_unit_price SET NOT NULL/);
});

test('migration 040 is rerun-safe and keeps confirmed commercial facts immutable', () => {
  assert.match(sql, /ADD COLUMN IF NOT EXISTS default_sales_channel_id/);
  assert.match(sql, /ON CONFLICT \(permission_key\) DO UPDATE/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS sales_orders_channel_idx/);
  assert.match(sql, /DROP TRIGGER IF EXISTS sales_order_line_price_provenance_deferred/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION sales\.guard_sales_order_version_mutation/);
  assert.match(sql, /NEW\.sales_channel_id IS NOT DISTINCT FROM OLD\.sales_channel_id/);
  assert.match(sql, /NEW\.document_discount_reason IS NOT DISTINCT FROM OLD\.document_discount_reason/);
  assert.doesNotMatch(sql, /INSERT INTO shared\.sales_channels/);
});

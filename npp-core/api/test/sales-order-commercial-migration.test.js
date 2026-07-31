import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { CORE_API_MIGRATIONS } from '../src/migrations/index.js';

const sql = readFileSync(
  new URL('../../../database/migrations/sales/040_sales_order_commercial_controls.sql', import.meta.url),
  'utf8',
);

test('migration 040 is the registered tail migration', () => {
  assert.equal(CORE_API_MIGRATIONS.at(-1)?.id, '040_sales_order_commercial_controls');
  assert.equal(CORE_API_MIGRATIONS.filter((entry) => entry.id === '040_sales_order_commercial_controls').length, 1);
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

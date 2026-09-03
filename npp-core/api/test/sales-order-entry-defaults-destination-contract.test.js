import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { salesOrderEntryInternals } from '../src/services/sales-order-entry.js';

const read = (path) => readFile(new URL(`../../../database/migrations/${path}`, import.meta.url), 'utf8');
const readSource = (path) => readFile(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('sales order entry defaults are scoped to canonical internal users and safe delivery choices', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  assert.equal(salesOrderEntryInternals.internalUserId({ actorId: `user:${userId}` }), userId);
  assert.equal(salesOrderEntryInternals.internalUserId({ actorId: 'system:bootstrap' }), null);
  assert.equal(salesOrderEntryInternals.normalizedDeliveryChoice('manual'), 'MANUAL');
  assert.equal(salesOrderEntryInternals.normalizedDeliveryChoice('PICKUP'), 'PICKUP');
  assert.equal(salesOrderEntryInternals.normalizedDeliveryChoice('unknown'), null);
  assert.equal(salesOrderEntryInternals.ENTRY_DEFAULTS_KEY, 'sales-order.entry-defaults');
});

test('user preference migration keeps preferences installation and user scoped', async () => {
  const migration = await read('shared/121_user_preferences.sql');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS shared\.user_preferences/);
  assert.match(migration, /PRIMARY KEY \(installation_id, user_id, preference_key\)/);
  assert.match(migration, /REFERENCES shared\.users \(installation_id, id\)/);
  assert.match(migration, /preference_key ~ '\^\[A-Za-z0-9\._-\]\+\$'/);
});

test('sales order confirmation requires destination only for trip delivery', async () => {
  const migration = await read('sales/122_sales_order_optional_destination.sql');
  assert.match(migration, /NEW\.delivery_execution_mode = 'TRIP'/);
  assert.match(migration, /customer_address_snapshot ->> 'addressLine1'/);
  assert.match(migration, /delivery_orders_mode_shape/);
  assert.match(migration, /destination_snapshot ->> 'addressLine1'/);
});

test('trip stops allow a one-off order destination without inventing a customer address', async () => {
  const migration = await read('logistics/123_logistics_order_destination_stop.sql');
  assert.match(migration, /ALTER COLUMN customer_address_id DROP NOT NULL/);
});

test('sales order service supports a direct order destination and keeps manual delivery address optional', async () => {
  const source = await readSource('services/sales-order-legacy.js');
  assert.match(source, /directDeliveryAddressSnapshot\(payload\?\.deliveryAddress, customer\)/);
  assert.match(source, /deliveryExecutionMode === 'TRIP'/);
  assert.match(source, /DELIVERY_DESTINATION_REQUIRED/);
  assert.match(source, /customerAddressSnapshot: prepared\.header\.customerAddressSnapshot/);
});

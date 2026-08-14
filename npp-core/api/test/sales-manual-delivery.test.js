import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { IDEMPOTENCY_KEY_PATTERN } from '@npp/contracts';
import {
  executeManualDeliveryHandover,
  manualDeliveryInternals,
} from '../src/services/sales-manual-delivery.js';

const DELIVERY_ORDER_ID = '11111111-1111-4111-8111-111111111111';

test('manual delivery derived idempotency keys are canonical and stable per retry intent', () => {
  const first = manualDeliveryInternals.derivedKey('manual-movement', 'retry-key-1');
  const replay = manualDeliveryInternals.derivedKey('manual-movement', 'retry-key-1');
  const different = manualDeliveryInternals.derivedKey('manual-movement', 'retry-key-2');
  assert.equal(first, replay);
  assert.notEqual(first, different);
  assert.match(first, IDEMPOTENCY_KEY_PATTERN);
  assert.doesNotMatch(first, /:/);
});

test('manual delivery is deny-by-default before touching storage', async () => {
  const result = await executeManualDeliveryHandover({
    adapter: null,
    requestContext: { permissions: [] },
    deliveryOrderId: DELIVERY_ORDER_ID,
    idempotencyKey: 'manual-test-key',
    payload: {},
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PERMISSION_DENIED');
});

test('manual delivery migration owns accounting, reversal, delivery projection and event vocabulary', () => {
  const migration = readFileSync(
    new URL('../../../database/migrations/sales/080_manual_delivery_handover.sql', import.meta.url),
    'utf8',
  );
  const registry = readFileSync(new URL('../src/migrations/index.js', import.meta.url), 'utf8');
  const route = readFileSync(new URL('../src/routes/delivery-orders.js', import.meta.url), 'utf8');
  const permissionSource = readFileSync(new URL('../src/access/permissions-sales.js', import.meta.url), 'utf8');
  assert.match(migration, /MANUAL_HANDOVER/);
  assert.match(migration, /refresh_sales_order_accepted_delivery_status/);
  assert.match(migration, /reverse_handover_receivable_on_inventory_reversal/);
  assert.match(migration, /receivable_reversal_requires_unallocated_open_document/);
  assert.match(registry, /080_manual_delivery_handover/);
  assert.match(route, /pickup-handover\|manual-handover\|reverse-inventory-issue/);
  assert.match(permissionSource, /core\.delivery-order\.manual-handover/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  formatHoldQuantity,
  parseHoldQuantity,
} from '../src/services/sales-fulfillment-hold.js';

test('shared stock hold keeps exact quantity arithmetic', () => {
  assert.equal(parseHoldQuantity('15'), 15_000_000_000_000n);
  assert.equal(formatHoldQuantity(15_000_000_000_000n), '15.000000000000');
  assert.equal(parseHoldQuantity('0.000000000001'), 1n);
  assert.equal(parseHoldQuantity('-1'), null);
});

test('shared stock hold migration separates order need from operator allocation target', () => {
  const migration = readFileSync(
    new URL('../../../database/migrations/sales/092_sales_shared_stock_hold.sql', import.meta.url),
    'utf8',
  );
  assert.match(migration, /allocation_target_base_quantity/);
  assert.match(migration, /COALESCE\(allocation_target_base_quantity, ordered_base_quantity\)/);
  assert.match(migration, /reserved_base_quantity \+ backordered_base_quantity/);
  assert.match(migration, /fulfillment_hold_service/);
  assert.match(migration, /allocation_target_base_quantity >= allocated_base_quantity/);
  assert.match(migration, /picked_base_quantity <> 0/);
  assert.match(migration, /issued_base_quantity <> 0/);
});

test('manual delivery rechecks current stock hold before deciding shortage', () => {
  const source = readFileSync(
    new URL('../src/services/sales-manual-stock-issue.js', import.meta.url),
    'utf8',
  );
  const refresh = source.indexOf('const hold = await reconcileDemandHold');
  const shortage = source.indexOf("'MANUAL_STOCK_ISSUE_SHORTAGE'");
  assert.ok(refresh >= 0, 'manual issue must refresh the stock hold');
  assert.ok(shortage > refresh, 'shortage must be decided after current stock is reconciled');
  assert.match(source, /targetBaseQuantity: demand\.ordered_base_quantity/);
});

test('quantity allocation exposes selected quantity and full allocation without policy override', () => {
  const service = readFileSync(
    new URL('../src/services/sales-fulfillment-operations.js', import.meta.url),
    'utf8',
  );
  const workspace = readFileSync(
    new URL('../../web/app/inventory/fulfillment/fulfillment-workspace.tsx', import.meta.url),
    'utf8',
  );
  assert.match(service, /mode === 'QUANTITY'/);
  assert.match(service, /allocatedBefore \+ requestedQuantity/);
  assert.match(service, /reconcileDemandHold/);
  assert.match(workspace, /Số lượng muốn phân bổ/);
  assert.match(workspace, /Phân bổ đủ/);
  assert.match(workspace, /Chưa phân bổ/);
  assert.match(workspace, /Kho có thể dùng/);
});

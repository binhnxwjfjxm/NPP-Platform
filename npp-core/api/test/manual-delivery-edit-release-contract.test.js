import test from 'node:test';
import assert from 'node:assert/strict';
import { CORE_API_MIGRATIONS } from '../src/migrations/index.js';
import { salesOrderDeliveryExecutionInternals } from '../src/services/sales-order.js';
import { manualEditAllocationReleaseInternals } from '../src/services/sales-fulfillment-allocation-release.js';

const { manualQuickEditGuard } = salesOrderDeliveryExecutionInternals;
const {
  childIdempotencyKey,
  unwindIdempotencyKey,
  releaseBlocked,
} = manualEditAllocationReleaseInternals;

function manualOrder(totals) {
  return {
    status: 'confirmed',
    deliveryMode: 'DELIVERY',
    deliveryExecutionMode: 'MANUAL',
    fulfillment: { totals },
  };
}

test('Giao thủ công cho sửa sau phân bổ, soạn, đóng gói hoặc Xuất kho để orchestration tự hoàn tác', () => {
  for (const field of [
    'allocatedBaseQuantity',
    'pickedBaseQuantity',
    'packedBaseQuantity',
    'issuedBaseQuantity',
  ]) {
    const totals = {
      allocatedBaseQuantity: '0',
      pickedBaseQuantity: '0',
      packedBaseQuantity: '0',
      issuedBaseQuantity: '0',
      [field]: '1',
    };
    const result = manualQuickEditGuard(manualOrder(totals));
    assert.equal(result.ok, true, field);
  }
});

test('low-level release still requires pick, pack and delivery claim to be unwound first', () => {
  assert.equal(releaseBlocked({ picked_base_quantity: '0', packed_base_quantity: '0', claimed_base_quantity: '0' }), false);
  assert.equal(releaseBlocked({ picked_base_quantity: '1', packed_base_quantity: '0', claimed_base_quantity: '0' }), true);
  assert.equal(releaseBlocked({ picked_base_quantity: '0', packed_base_quantity: '1', claimed_base_quantity: '0' }), true);
  assert.equal(releaseBlocked({ picked_base_quantity: '0', packed_base_quantity: '0', claimed_base_quantity: '1' }), true);
});

test('unwind child idempotency keys use canonical safe contract', () => {
  for (const key of [
    childIdempotencyKey(
      'sales-manual-edit.parent-1',
      '11111111-1111-4111-8111-111111111111',
    ),
    unwindIdempotencyKey(
      'sales-manual-edit.parent-1',
      'manual-stock-issue',
      '22222222-2222-4222-8222-222222222222',
    ),
  ]) {
    assert.match(key, /^[A-Za-z0-9._-]+$/);
    assert.ok(key.length >= 1 && key.length <= 128);
  }
});

test('migration 094 makes RELEASED allocation terminal and excludes it from execution facts', () => {
  const migration = CORE_API_MIGRATIONS.find((entry) => entry.id === '094_manual_delivery_allocation_release');
  assert.ok(migration);
  assert.match(migration.sql, /state IN \('ACTIVE', 'COMPLETED', 'RELEASED'\)/);
  assert.match(migration.sql, /event_type IN \('ALLOCATED', 'PICKED', 'PACKED', 'PICK_REVERSED', 'PACK_REVERSED', 'RELEASED'\)/);
  assert.match(migration.sql, /allocation\.state <> 'RELEASED'/);
  assert.match(migration.sql, /fulfillment_release_service/);
  assert.match(migration.sql, /sales_fulfillment_release_blocked_by_delivery_order/);
  assert.match(migration.sql, /FILTER \(WHERE allocation\.state <> 'RELEASED'\)/);
});
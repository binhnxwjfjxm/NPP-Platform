import test from 'node:test';
import assert from 'node:assert/strict';
import { CORE_API_MIGRATIONS } from '../src/migrations/index.js';
import { salesOrderDeliveryExecutionInternals } from '../src/services/sales-order.js';
import { manualEditAllocationReleaseInternals } from '../src/services/sales-fulfillment-allocation-release.js';

const { manualQuickEditGuard } = salesOrderDeliveryExecutionInternals;
const { childIdempotencyKey, releaseBlocked } = manualEditAllocationReleaseInternals;

function manualOrder(totals) {
  return {
    status: 'confirmed',
    deliveryMode: 'DELIVERY',
    deliveryExecutionMode: 'MANUAL',
    fulfillment: { totals },
  };
}

test('Giao thủ công cho sửa khi mới phân bổ nhưng chưa xử lý hàng thực tế', () => {
  const result = manualQuickEditGuard(manualOrder({
    allocatedBaseQuantity: '3.000000000000',
    pickedBaseQuantity: '0.000000000000',
    packedBaseQuantity: '0.000000000000',
    issuedBaseQuantity: '0.000000000000',
  }));
  assert.equal(result.ok, true);
});

test('Giao thủ công vẫn khóa sửa khi đã soạn, đóng gói hoặc Xuất kho', () => {
  for (const field of ['pickedBaseQuantity', 'packedBaseQuantity', 'issuedBaseQuantity']) {
    const totals = {
      allocatedBaseQuantity: '3',
      pickedBaseQuantity: '0',
      packedBaseQuantity: '0',
      issuedBaseQuantity: '0',
      [field]: '1',
    };
    const result = manualQuickEditGuard(manualOrder(totals));
    assert.equal(result.ok, false, field);
    assert.equal(result.code, 'SALES_ORDER_HAS_EXECUTION_FACTS', field);
  }
});

test('release allocation blocks physical or delivery claims', () => {
  assert.equal(releaseBlocked({ picked_base_quantity: '0', packed_base_quantity: '0', claimed_base_quantity: '0' }), false);
  assert.equal(releaseBlocked({ picked_base_quantity: '1', packed_base_quantity: '0', claimed_base_quantity: '0' }), true);
  assert.equal(releaseBlocked({ picked_base_quantity: '0', packed_base_quantity: '1', claimed_base_quantity: '0' }), true);
  assert.equal(releaseBlocked({ picked_base_quantity: '0', packed_base_quantity: '0', claimed_base_quantity: '1' }), true);
});

test('release child idempotency key uses canonical safe contract', () => {
  const key = childIdempotencyKey(
    'sales-manual-edit.parent-1',
    '11111111-1111-4111-8111-111111111111',
  );
  assert.match(key, /^[A-Za-z0-9._-]+$/);
  assert.ok(key.length >= 1 && key.length <= 128);
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

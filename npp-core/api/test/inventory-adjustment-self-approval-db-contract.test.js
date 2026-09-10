import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PERMISSIONS } from '../src/access/permissions.js';
import { CORE_API_MIGRATIONS } from '../src/migrations/index.js';
import { inventoryAdjustmentInternals } from '../src/services/inventory-adjustment.js';

test('Owner và Role có quyền tự duyệt vẫn đi qua cùng contract phân quyền', () => {
  const canApproveOwn = inventoryAdjustmentInternals.canApproveOwnAdjustment;

  assert.equal(canApproveOwn({ roles: [], permissions: [] }), false);
  assert.equal(canApproveOwn({ roles: ['inventory-manager'], permissions: [] }), false);
  assert.equal(canApproveOwn({
    roles: ['inventory-manager'],
    permissions: [PERMISSIONS.coreInventoryAdjustmentSelfApprove],
  }), true);
  assert.equal(canApproveOwn({ roles: ['system:security-owner'], permissions: [] }), true);
  assert.equal(canApproveOwn({ roles: ['system:implementation-owner'], permissions: [] }), true);
});

test('migration 129 gỡ đúng constraint DB cũ đang biến tự duyệt hợp lệ thành HTTP 503', () => {
  const migration = CORE_API_MIGRATIONS.find(
    ({ id }) => id === '129_inventory_adjustment_self_approval_contract',
  );
  assert.ok(migration);

  const source = readFileSync(
    new URL('../../../database/migrations/inventory/129_inventory_adjustment_self_approval_contract.sql', import.meta.url),
    'utf8',
  );
  assert.match(source, /DROP CONSTRAINT IF EXISTS inventory_adjustments_creator_approver_separation_ck/);
  assert.doesNotMatch(source, /INSERT INTO shared\.permission_catalog/);
});

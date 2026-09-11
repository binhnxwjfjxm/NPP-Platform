import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PERMISSION_CATALOG, PERMISSIONS } from '../src/access/permissions.js';
import { CORE_API_MIGRATIONS } from '../src/migrations/index.js';
import { inventoryAdjustmentInternals } from '../src/services/inventory-adjustment.js';
import { manualInboundInternals } from '../src/services/manual-inbound.js';
import { previewManualInbound } from '../src/services/manual-inbound-preparation.js';

function manualInboundContext(warehouseId) {
  return Object.freeze({
    installationId: `policy-${randomUUID()}`,
    actorId: 'test:inventory-operator',
    roles: Object.freeze(['inventory-operator']),
    permissions: Object.freeze([
      PERMISSIONS.coreInventoryManualInboundPrepare,
      PERMISSIONS.coreInventoryManualInboundPost,
    ]),
    scopes: Object.freeze({
      branchIds: Object.freeze([]),
      warehouseIds: Object.freeze([warehouseId]),
      territoryIds: Object.freeze([]),
    }),
    requestId: `req-${randomUUID()}`,
    sourceApp: 'npp-core-api',
    receivedAt: '2026-09-06T13:30:00.000Z',
  });
}

function noCostPreviewClient({ warehouseId, sourceVariantId, baseVariantId }) {
  return Object.freeze({
    async query(sql) {
      const statement = String(sql);
      if (statement.includes('FROM shared.warehouses')) {
        return { rows: [{ id: warehouseId, code: 'KHO-01', name: 'Kho chính', location_management_mode: 'UNMANAGED' }] };
      }
      if (statement.includes('FROM information_schema.columns')) {
        return { rows: [{ present: true }] };
      }
      if (statement.includes('FROM shared.product_variants pv')
          && statement.includes('LEFT JOIN inventory.product_tracking_policies')) {
        return {
          rows: [{
            id: sourceVariantId,
            sku: 'SKU-01',
            product_id: randomUUID(),
            unit_id: randomUUID(),
            conversion_to_base: '1.000000',
            unit_code: 'CAI',
            allows_fractional: false,
            product_code: 'SP-01',
            product_name: 'Sản phẩm thử',
            is_inventory_managed: true,
            base_variant_id: baseVariantId,
            base_sku: 'SKU-01',
            lot_tracking_mode: 'NONE',
            expiry_tracking_mode: 'NONE',
            location_required: false,
          }],
        };
      }
      if (statement.includes('FROM inventory.inventory_cost_balances')) {
        return { rows: [] };
      }
      throw new Error(`Unexpected query in no-cost preview test: ${statement}`);
    },
  });
}

test('Nhập kho thủ công chấp nhận để trống giá vốn và không tự gán bằng 0', () => {
  const normalized = manualInboundInternals.normalizeManualInboundPayload({
    warehouseId: randomUUID(),
    inboundType: 'MANUAL_RECEIPT',
    documentDate: '2026-09-06',
    rows: [{
      sourceVariantId: randomUUID(),
      sourceQuantity: '2',
      unitCost: null,
    }],
  });

  assert.equal(normalized.ok, true, normalized.message);
  assert.equal(normalized.value.rows[0].unitCost, null);
});

test('Kiểm tra Nhập kho thủ công vẫn sẵn sàng khi không nhập và cũng chưa có giá vốn hiện hành', async () => {
  const warehouseId = randomUUID();
  const sourceVariantId = randomUUID();
  const baseVariantId = randomUUID();
  const requestContext = manualInboundContext(warehouseId);
  const client = noCostPreviewClient({ warehouseId, sourceVariantId, baseVariantId });

  const result = await previewManualInbound(client, {
    requestContext,
    payload: {
      warehouseId,
      inboundType: 'MANUAL_RECEIPT',
      documentDate: '2026-09-06',
      rows: [{ sku: 'SKU-01', sourceQuantity: '2', unitCost: null }],
    },
  });

  assert.equal(result.ok, true, result.message);
  assert.equal(result.preview.ready, true);
  assert.equal(result.preview.rowErrors.length, 0);
  assert.equal(result.preview.rows[0].status, 'READY');
  assert.equal(result.preview.rows[0].unitCost, null);
  assert.equal(result.preview.rows[0].costSource, null);
  assert.deepEqual(result.preview.rows[0].requiredFields, []);
});

test('quyền tự duyệt phiếu điều chỉnh nằm trong catalog Role', () => {
  assert.equal(
    PERMISSIONS.coreInventoryAdjustmentSelfApprove,
    'core.inventory-adjustment.self-approve',
  );
  const permission = PERMISSION_CATALOG.find(
    (entry) => entry.permissionKey === PERMISSIONS.coreInventoryAdjustmentSelfApprove,
  );
  assert.ok(permission);
  assert.equal(permission.module, 'Kho');
  assert.equal(permission.label, 'Tự duyệt phiếu mình tạo');

  const migration = CORE_API_MIGRATIONS.find(
    ({ id }) => id === '126_inventory_adjustment_self_approval_permission',
  );
  assert.ok(migration);
  assert.match(migration.sql, /core\.inventory-adjustment\.self-approve/);
});

test('phiếu điều chỉnh chỉ tự duyệt khi Role có quyền, riêng Owner luôn được phép', () => {
  const canApproveOwn = inventoryAdjustmentInternals.canApproveOwnAdjustment;

  assert.equal(canApproveOwn({ roles: [], permissions: [] }), false);
  assert.equal(canApproveOwn({
    roles: ['inventory-manager'],
    permissions: [PERMISSIONS.coreInventoryAdjustmentSelfApprove],
  }), true);
  assert.equal(canApproveOwn({ roles: ['system:security-owner'], permissions: [] }), true);
  assert.equal(canApproveOwn({ roles: ['system:implementation-owner'], permissions: [] }), true);
});

test('migration 129 gỡ luật DB cũ chặn Owner tự duyệt nhưng không mở quyền ở service', () => {
  const migration = CORE_API_MIGRATIONS.find(
    ({ id }) => id === '129_inventory_adjustment_owner_self_approval',
  );
  assert.ok(migration);
  assert.match(
    migration.sql,
    /DROP CONSTRAINT IF EXISTS inventory_adjustments_creator_approver_separation_ck/,
  );

  const canApproveOwn = inventoryAdjustmentInternals.canApproveOwnAdjustment;
  assert.equal(canApproveOwn({ roles: [], permissions: [] }), false);
  assert.equal(canApproveOwn({ roles: ['system:implementation-owner'], permissions: [] }), true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const variantRepository = readFileSync(new URL('../src/db/repositories/product-variants.js', import.meta.url), 'utf8');
const migrationIndex = readFileSync(new URL('../src/migrations/index.js', import.meta.url), 'utf8');
const backfill = readFileSync(new URL('../../../database/migrations/inventory/136_inventory_tracking_policy_backfill.sql', import.meta.url), 'utf8');

test('SKU tồn chuẩn tạo qua repository luôn có chính sách lô/hạn mặc định', () => {
  assert.match(variantRepository, /async function ensureDefaultTrackingPolicy/);
  assert.match(variantRepository, /INSERT INTO inventory\.product_tracking_policies/);
  assert.match(variantRepository, /'NONE', 'NONE', false, 1/);
  assert.match(variantRepository, /ON CONFLICT \(installation_id, base_variant_id\) DO NOTHING/);
  assert.match(variantRepository, /if \(isInventoryBase\) \{[\s\S]*ensureDefaultTrackingPolicy[\s\S]*actorId: createdBy/);
  assert.match(variantRepository, /if \(isInventoryBase\) \{[\s\S]*ensureDefaultTrackingPolicy[\s\S]*actorId: updatedBy/);
});

test('migration 136 backfill chính sách thiếu mà không thay đổi số lượng tồn', () => {
  assert.match(migrationIndex, /136_inventory_tracking_policy_backfill/);
  assert.match(migrationIndex, /inventory\/136_inventory_tracking_policy_backfill\.sql/);
  assert.match(backfill, /WHERE variant\.is_inventory_base = true/);
  assert.match(backfill, /FROM inventory\.inventory_lots lot/);
  assert.match(backfill, /CASE WHEN base\.has_lot THEN 'REQUIRED' ELSE 'NONE' END/);
  assert.match(backfill, /CASE WHEN base\.has_expiry THEN 'OPTIONAL' ELSE 'NONE' END/);
  assert.match(backfill, /ON CONFLICT \(installation_id, base_variant_id\) DO NOTHING/);
  assert.doesNotMatch(backfill, /UPDATE\s+inventory\.inventory_balances|INSERT INTO\s+inventory\.inventory_movements/i);
});

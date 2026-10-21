import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const workspace = fs.readFileSync(path.resolve(currentDir, '../app/inventory/balances/inventory-balances-workspace.tsx'), 'utf8');
const inventoryTypes = fs.readFileSync(path.resolve(currentDir, '../lib/inventory-types.ts'), 'utf8');

test('inventory balance type carries canonical product and packaging metadata', () => {
  assert.match(inventoryTypes, /product_name: string;/);
  assert.match(inventoryTypes, /base_unit_name: string \| null;/);
  assert.match(inventoryTypes, /package_unit_name: string \| null;/);
  assert.match(inventoryTypes, /package_conversion_to_base: string \| null;/);
});

test('inventory table uses office-facing product and stock labels', () => {
  for (const label of ['Sản phẩm / SKU', 'Tồn kho', 'Đã giữ cho đơn', 'Có thể xuất']) {
    assert.match(workspace, new RegExp(label));
  }
  assert.match(workspace, /balance\.product_name/);
  assert.doesNotMatch(workspace, />Tồn thực</);
  assert.doesNotMatch(workspace, />Khả dụng</);
});

test('inventory lookup shows warehouse business holds once per warehouse and base SKU group', () => {
  assert.match(inventoryTypes, /business_held_quantity\?: string \| null;/);
  assert.match(inventoryTypes, /business_available_quantity\?: string \| null;/);
  assert.match(workspace, /groupBalancesByWarehouseSku/);
  assert.match(workspace, /businessHoldKey\(balance\)/);
  assert.match(workspace, /const firstInGroup = groupRowIndex === 0/);
  assert.doesNotMatch(workspace, /rowSpan=\{group\.rows\.length\}/);
  assert.equal((workspace.match(/value=\{businessHeld\}/g) ?? []).length, 1);
  assert.equal((workspace.match(/value=\{businessAvailable\}/g) ?? []).length, 1);
  assert.match(workspace, /balance\.business_held_quantity/);
  assert.match(workspace, /balance\.business_available_quantity/);
  assert.match(workspace, />Theo kho</);
});

test('package breakdown derives from the canonical conversion instead of a second stock quantity', () => {
  assert.match(workspace, /balance\.package_conversion_to_base/);
  assert.match(workspace, /const packageCount = quantityScaled \/ conversionScaled/);
  assert.match(workspace, /const remainder = quantityScaled % conversionScaled/);
  assert.match(workspace, /InventoryQuantity balance=\{balance\} value=\{balance\.on_hand_quantity\}/);
  assert.doesNotMatch(workspace, /package_on_hand|case_on_hand|carton_on_hand/i);
});

test('inventory balance lookup offers the shared held-order eye for each warehouse/SKU group', () => {
  assert.match(workspace, /import \{ StockHoldBreakdown \} from '\.\.\/\.\.\/components\/stock-hold-breakdown';/);
  assert.equal((workspace.match(/<StockHoldBreakdown\b/g) ?? []).length, 1);
  const firstGroupCell = workspace.slice(
    workspace.indexOf('{firstInGroup ? ('),
    workspace.indexOf(') : <span className={styles.subtle}>—</span>}', workspace.indexOf('{firstInGroup ? (')),
  );
  assert.match(firstGroupCell, /<InventoryQuantity balance=\{balance\} value=\{businessHeld\} \/>/);
  assert.match(firstGroupCell, /<StockHoldBreakdown[\s\S]*?warehouseId=\{balance\.warehouse_id\}[\s\S]*?baseVariantId=\{balance\.base_variant_id\}/);
  assert.match(firstGroupCell, /displayedHeldQuantity=\{businessHeld\}/);
  assert.match(firstGroupCell, /title="Xem đơn đã giữ và đang chờ hàng"/);
  assert.doesNotMatch(firstGroupCell, /excludeSalesOrderId=/);
});

test('inventory eye distinguishes actually-held units from confirmed waiting demand', () => {
  const breakdown = fs.readFileSync(path.resolve(currentDir, '../app/components/stock-hold-breakdown.tsx'), 'utf8');
  assert.match(breakdown, /Còn chờ hàng:/);
  assert.match(breakdown, /Đã giữ:/);
  assert.match(breakdown, /data\?\.heldBaseQuantity \?\? displayedHeldQuantity/);
});

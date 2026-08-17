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

test('package breakdown derives from the canonical conversion instead of a second stock quantity', () => {
  assert.match(workspace, /balance\.package_conversion_to_base/);
  assert.match(workspace, /const packageCount = quantityScaled \/ conversionScaled/);
  assert.match(workspace, /const remainder = quantityScaled % conversionScaled/);
  assert.match(workspace, /InventoryQuantity balance=\{balance\} value=\{balance\.on_hand_quantity\}/);
  assert.doesNotMatch(workspace, /package_on_hand|case_on_hand|carton_on_hand/i);
});

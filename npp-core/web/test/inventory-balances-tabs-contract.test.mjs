import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const inventory = readFileSync(new URL('../app/inventory/balances/inventory-balances-workspace.tsx', import.meta.url), 'utf8');

test('Tra cứu tồn kho renders Tồn kho and Lịch sử kho as exclusive tabs', () => {
  assert.ok(inventory.includes('data-testid="inventory-balances-tab"'));
  assert.ok(inventory.includes('data-testid="inventory-history-tab"'));
  assert.ok(inventory.includes('data-testid="inventory-balances-section"'));
  assert.ok(inventory.includes('data-testid="inventory-history-section"'));
  assert.ok(inventory.includes("activeTab === 'balances' ? ("));
  assert.equal(inventory.includes('inventory-drilldown-panel'), false);
});

test('Tồn kho lists zero-quantity products and preserves warehouse history navigation', () => {
  assert.doesNotMatch(inventory, /function hasDisplayableBalance\(/);
  assert.match(inventory, /balances\.filter\(\(balance\) => !normalizedSearch \|\| matchTerm\(/);
  assert.match(inventory, /includeCatalog=true/);
  assert.match(inventory, /const candidate = balances\.find\(\(balance\) => \{/);
  assert.match(inventory, /loadWarehouseHistory\(balance, 0, balance\.base_sku\)/);
});

test('Lịch sử kho always uses canonical warehouse scope', () => {
  assert.ok(inventory.includes('/api/inventory/balances/history?'));
  assert.ok(inventory.includes("scope: 'warehouse'"));
  assert.equal(inventory.includes("params.set('locationId'"), false);
  assert.equal(inventory.includes("params.set('lotId'"), false);
});

test('Lịch sử kho keeps the Sapo-style table, 50 rows per page and inline document popup', () => {
  assert.ok(inventory.includes('const HISTORY_PAGE_SIZE = 50;'));
  for (const header of ['Ngày ghi nhận', 'Nhân viên', 'Thao tác', 'Số lượng thay đổi', 'Tồn kho', 'Đơn / chứng từ', 'Khách hàng', 'Kho']) {
    assert.ok(inventory.includes(`<th>${header}</th>`));
  }
  assert.ok(inventory.includes('onClick={() => setSelectedHistory(row)}'));
  assert.ok(inventory.includes('role="dialog" aria-modal="true"'));
  assert.ok(inventory.includes('<span>Đơn bán hàng</span>'));
  assert.ok(inventory.includes('<span>Khách hàng</span>'));
});

test('Tồn kho không còn ô gộp vượt dòng gây sai nền và lệch cột', () => {
  assert.doesNotMatch(inventory, /rowSpan=\{group\.rows\.length\}/);
  assert.match(inventory, /<td>\s*\{firstInGroup \? \(\s*<>\s*<div className=\{styles\.holdQuantityCell\}>\s*<InventoryQuantity balance=\{balance\} value=\{businessHeld\}/);
  assert.match(inventory, /<td>\s*\{firstInGroup \? \(\s*<>\s*<InventoryQuantity balance=\{balance\} value=\{businessAvailable\}/);
  assert.match(inventory, /\) : <span className=\{styles\.subtle\}>—<\/span>\}/);
});

test('Tồn kho chỉ hiển thị dòng vị trí khi kho quản lý vị trí hoặc còn dữ liệu cũ cần đối soát', () => {
  assert.match(inventory, /balance\.warehouse_location_management_mode === 'UNMANAGED' && !balance\.location_id \? null/);
  assert.match(inventory, /joinValues\(balance\.location_code, balance\.location_name\) \|\| 'Không vị trí'/);
  assert.match(inventory, /<InventoryQuantity balance=\{balance\} value=\{balance\.on_hand_quantity\}/);
  assert.match(inventory, /loadWarehouseHistory\(balance, 0, balance\.base_sku\)/);
});

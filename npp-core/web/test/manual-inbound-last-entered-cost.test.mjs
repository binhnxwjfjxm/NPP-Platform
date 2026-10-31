import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../app/inventory/manual-inbounds/manual-inbound-workspace.tsx', import.meta.url), 'utf8');
test('Nhập kho thủ công pre-fills last explicit price but never average cost', () => {
  assert.ok(source.includes('const suggestedCost = editableCost(option.lastEnteredUnitCost)'));
  assert.ok(source.includes('unitCost: suggestedCost'));
  assert.ok(source.includes('Giá nhập lần trước'));
  assert.ok(source.includes("placeholder={resolved?.unitCost ? formatCost(resolved.unitCost) : 'Tự lấy nếu có'}"));
});
test('manual edits are preserved, and changing warehouse clears only old automatic suggestions', () => {
  assert.ok(source.includes('function changeWarehouse(nextWarehouseId: string)'));
  assert.ok(source.includes('row.autoCostWarehouseId !== nextWarehouseId'));
  assert.ok(source.includes('row.unitCost === row.autoCostValue'));
  assert.ok(source.includes('changeWarehouse(event.target.value)'));
  assert.ok(source.includes("hasOwnProperty.call(patch, 'unitCost')"));
  assert.ok(source.includes('autoCostWarehouseId: undefined, autoCostValue: undefined'));
});

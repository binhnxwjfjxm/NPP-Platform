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

test('Lịch sử kho always uses canonical warehouse scope', () => {
  assert.ok(inventory.includes('/api/inventory/balances/history?'));
  assert.ok(inventory.includes("scope: 'warehouse'"));
  assert.equal(inventory.includes("params.set('locationId'"), false);
  assert.equal(inventory.includes("params.set('lotId'"), false);
});

test('Lịch sử kho keeps the Sapo-style table, 50 rows per page and inline document popup', () => {
  assert.ok(inventory.includes('const HISTORY_PAGE_SIZE = 50;'));
  for (const header of ['Ngày ghi nhận', 'Nhân viên', 'Thao tác', 'Số lượng thay đổi', 'Tồn kho', 'Mã chứng từ', 'Kho']) {
    assert.ok(inventory.includes(`<th>${header}</th>`));
  }
  assert.ok(inventory.includes('onClick={() => setSelectedHistory(row)}'));
  assert.ok(inventory.includes('role="dialog" aria-modal="true"'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const inventoryPage = await readFile(new URL('../app/inventory/balances/page.tsx', import.meta.url), 'utf8');
const inventoryWorkspace = await readFile(new URL('../app/inventory/balances/inventory-balances-workspace.tsx', import.meta.url), 'utf8');
const salesWorkspace = await readFile(new URL('../app/sales/sales-orders/SalesOrderWorkspace.tsx', import.meta.url), 'utf8');

test('inventory balance drill-down makes exact lot scope and warehouse SKU total explicit', () => {
  assert.match(inventoryPage, /InventoryBalancesWorkspace/);
  assert.match(inventoryWorkspace, /Lịch sử tồn kho theo vị trí \/ lô/);
  assert.match(inventoryWorkspace, /Tổng tồn SKU tại kho/);
  assert.match(inventoryWorkspace, /Chi tiết cùng SKU trong kho/);
  assert.match(inventoryWorkspace, /warehouseId: balance\.warehouse_id/);
  assert.match(inventoryWorkspace, /if \(balance\.lot_id\) params\.set\('lotId', balance\.lot_id\)/);
  assert.match(inventoryWorkspace, /Tổng tồn của SKU có thể gồm nhiều lô hoặc nhiều vị trí khác nhau/);
});

test('sales order list refreshes canonical data and keeps backordered confirmed orders visible', () => {
  assert.match(salesWorkspace, /apiRequest<SalesOrder\[]>\('\/api\/sales-orders\?limit=1000'\)/);
  assert.match(salesWorkspace, /useEffect\(\(\) => \{\s*void refreshOrders\(false\)/s);
  assert.match(salesWorkspace, /order\.status === 'confirmed'/);
  assert.match(salesWorkspace, /order\.fulfillmentStatus === 'backordered'/);
  assert.match(salesWorkspace, /Đã xác nhận/);
  assert.match(salesWorkspace, /Chờ hàng/);
  assert.doesNotMatch(salesWorkspace, /filter\([^\n]*fulfillmentStatus[^\n]*backordered/);
});

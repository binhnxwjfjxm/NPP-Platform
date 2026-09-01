import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const inventoryPage = await readFile(new URL('../app/inventory/balances/page.tsx', import.meta.url), 'utf8');
const inventoryWorkspace = await readFile(new URL('../app/inventory/balances/inventory-balances-workspace.tsx', import.meta.url), 'utf8');
const salesWorkspace = await readFile(new URL('../app/sales/sales-orders/SalesOrderWorkspace.tsx', import.meta.url), 'utf8');

test('inventory history is movement-grouped, paginated and opens document details in place', () => {
  assert.match(inventoryPage, /InventoryBalancesWorkspace/);
  assert.match(inventoryWorkspace, /\/api\/inventory\/balances\/history\?/);
  assert.match(inventoryWorkspace, /params\.set\('scope', 'warehouse'\)/);
  assert.match(inventoryWorkspace, /if \(!allScopes && balance\.location_id\) params\.set\('locationId', balance\.location_id\)/);
  assert.match(inventoryWorkspace, /if \(!allScopes && balance\.lot_id\) params\.set\('lotId', balance\.lot_id\)/);
  assert.match(inventoryWorkspace, /HISTORY_PAGE_SIZE = 50/);
  assert.match(inventoryWorkspace, /data-testid="inventory-history-table"/);
  assert.match(inventoryWorkspace, /<th>Ngày ghi nhận<\/th>/);
  assert.match(inventoryWorkspace, /<th>Nhân viên<\/th>/);
  assert.match(inventoryWorkspace, /<th>Thao tác<\/th>/);
  assert.match(inventoryWorkspace, /<th>Số lượng thay đổi<\/th>/);
  assert.match(inventoryWorkspace, /<th>Tồn kho<\/th>/);
  assert.match(inventoryWorkspace, /<th>Mã chứng từ<\/th>/);
  assert.match(inventoryWorkspace, /<th>Kho<\/th>/);
  assert.match(inventoryWorkspace, /historyRows\.map\(\(row\) =>/);
  assert.match(inventoryWorkspace, /setSelectedHistory\(row\)/);
  assert.match(inventoryWorkspace, /role="dialog"/);
  assert.match(inventoryWorkspace, /loadDrillDown\(candidate, true, 0\)/);
  assert.doesNotMatch(inventoryWorkspace, /drillDown\.map/);
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

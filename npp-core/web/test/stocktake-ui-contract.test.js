import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workspace = readFileSync(new URL('../app/inventory/stocktakes/stocktake-workspace.tsx', import.meta.url), 'utf8');
const page = readFileSync(new URL('../app/inventory/stocktakes/page.tsx', import.meta.url), 'utf8');
const gateway = readFileSync(new URL('../lib/stocktake-gateway.ts', import.meta.url), 'utf8');
const nav = readFileSync(new URL('../app/components/app-shell-core.tsx', import.meta.url), 'utf8');

test('stocktake UI keeps blind count and PageHeader actions', () => {
  assert.match(workspace, /actions=\{/);
  assert.match(workspace, /Số hệ thống được ẩn trong lúc đếm/);
  assert.match(workspace, /expectedBaseQuantity !== undefined/);
  assert.match(workspace, /Hoàn tất vòng đếm/);
  assert.match(workspace, /Gửi duyệt/);
  assert.match(workspace, /Yêu cầu đếm lại/);
  assert.match(workspace, /Duyệt kết quả/);
  assert.match(workspace, /Ghi sổ chênh lệch/);
  assert.doesNotMatch(workspace, /Date\.now\(\)/);
  assert.match(workspace, /crypto\.randomUUID\(\)/);
});

test('stocktake page uses canonical scoped warehouse master independently from balances', () => {
  assert.match(page, /listStocktakeWarehouses/);
  assert.match(page, /warehousesResult/);
  assert.match(page, /warehouses=\{/);
  assert.match(gateway, /path:'\/warehouses'/);
  assert.match(workspace, /warehouses: WarehouseOption\[\]/);
  assert.doesNotMatch(workspace, /const warehouses = useMemo/);
  assert.match(workspace, /data-testid="stocktake-warehouse"/);
});

test('stocktake page uses real Core gateway and is discoverable in Inventory navigation', () => {
  assert.match(page, /listStocktakes/);
  assert.match(page, /listInventoryBalances/);
  assert.match(gateway, /\/api\/inventory\/stocktakes/);
  assert.match(nav, /\/inventory\/stocktakes/);
  assert.match(nav, /nav-inventory-stocktakes/);
});

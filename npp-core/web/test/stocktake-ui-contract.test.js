import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workspace = readFileSync(new URL('../app/inventory/stocktakes/stocktake-workspace.tsx', import.meta.url), 'utf8');
const page = readFileSync(new URL('../app/inventory/stocktakes/page.tsx', import.meta.url), 'utf8');
const gateway = readFileSync(new URL('../lib/stocktake-gateway.ts', import.meta.url), 'utf8');
const route = readFileSync(new URL('../app/api/inventory/stocktakes/route.ts', import.meta.url), 'utf8');
const detailRoute = readFileSync(new URL('../app/api/inventory/stocktakes/[id]/route.ts', import.meta.url), 'utf8');
const actionRoute = readFileSync(new URL('../app/api/inventory/stocktakes/[id]/[action]/route.ts', import.meta.url), 'utf8');
const sharedRoute = readFileSync(new URL('../app/api/inventory/_shared.ts', import.meta.url), 'utf8');
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
  assert.match(workspace, /createIdempotencyKey\(`stocktake-\$\{action\}`\)/);
  assert.doesNotMatch(workspace, /crypto\.randomUUID\(\)/);
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

test('stocktake proxy preserves stocktake gateway status instead of collapsing errors to 503', () => {
  assert.match(sharedRoute, /normalizeError: GatewayErrorNormalizer = normalizeInventoryGatewayError/);
  for (const source of [route, detailRoute, actionRoute]) {
    assert.match(source, /normalizeStocktakeGatewayError/);
    assert.match(source, /errorResponse\(error, requestId, normalizeStocktakeGatewayError\)/);
  }
});

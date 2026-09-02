import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workspace = readFileSync(new URL('../app/inventory/stocktakes/stocktake-workspace.tsx', import.meta.url), 'utf8');
const page = readFileSync(new URL('../app/inventory/stocktakes/page.tsx', import.meta.url), 'utf8');
const gateway = readFileSync(new URL('../lib/stocktake-gateway.ts', import.meta.url), 'utf8');
const types = readFileSync(new URL('../lib/stocktake-types.ts', import.meta.url), 'utf8');
const workflowErrors = readFileSync(new URL('../lib/inventory-workflow-errors.ts', import.meta.url), 'utf8');
const route = readFileSync(new URL('../app/api/inventory/stocktakes/route.ts', import.meta.url), 'utf8');
const detailRoute = readFileSync(new URL('../app/api/inventory/stocktakes/[id]/route.ts', import.meta.url), 'utf8');
const actionRoute = readFileSync(new URL('../app/api/inventory/stocktakes/[id]/[action]/route.ts', import.meta.url), 'utf8');
const sharedRoute = readFileSync(new URL('../app/api/inventory/_shared.ts', import.meta.url), 'utf8');
const nav = readFileSync(new URL('../app/components/app-shell-core.tsx', import.meta.url), 'utf8');

test('stocktake UI keeps blind count and presents the office workflow', () => {
  assert.match(workspace, /actions=\{/);
  assert.match(workspace, /Số hệ thống được ẩn trong lúc đếm/);
  assert.match(workspace, /expectedBaseQuantity !== undefined/);
  assert.match(workspace, /Hoàn tất đếm thực tế/);
  assert.match(workspace, /Gửi duyệt/);
  assert.match(workspace, /Yêu cầu đếm lại/);
  assert.match(workspace, /Duyệt kết quả/);
  assert.match(workspace, /Cập nhật tồn kho/);
  assert.doesNotMatch(workspace, /Ghi sổ chênh lệch/);
  assert.doesNotMatch(workspace, /Đảo ghi sổ/);
  assert.doesNotMatch(workspace, /inventoryMovementId/);
  assert.doesNotMatch(workspace, /Date\.now\(\)/);
  assert.match(workspace, /createIdempotencyKey\(`stocktake-\$\{action\}`\)/);
  assert.doesNotMatch(workspace, /crypto\.randomUUID\(\)/);
});

test('stocktake UI converts simple scope choices back to exact scopes', () => {
  assert.match(workspace, /Toàn bộ sản phẩm trong kho/);
  assert.match(workspace, /Theo lô/);
  assert.match(workspace, /Theo vị trí/);
  assert.match(workspace, /effectiveSelectedScopes/);
  assert.match(workspace, /locationId: balance\.location_id/);
  assert.match(workspace, /baseVariantId: balance\.base_variant_id/);
  assert.match(workspace, /lotId: balance\.lot_id/);
  assert.match(workspace, /hơn 500 dòng tồn/);
});

test('stocktake approval view exposes clear fields and discrepancy without breaking blind count', () => {
  for (const label of ['Sản phẩm', 'Lô', 'Vị trí', 'Tồn hệ thống', 'Thực đếm', 'Chênh lệch']) {
    assert.match(workspace, new RegExp(label));
  }
  assert.match(workspace, /subtractExactDecimal\(line\.countedBaseQuantity, line\.expectedBaseQuantity\)/);
  assert.match(workspace, /formatSignedExactDecimal\(difference\)/);
  assert.match(workspace, /Đang đếm:/);
  assert.match(workspace, /Lần đếm/);
  assert.doesNotMatch(workspace, /round\.status\}/);
});

test('stocktake status and errors use office language instead of backend terms', () => {
  assert.match(types, /counted: 'Chờ gửi duyệt'/);
  assert.match(types, /submitted: 'Chờ duyệt'/);
  assert.match(types, /recount_required: 'Yêu cầu đếm lại'/);
  assert.match(types, /approved: 'Chờ cập nhật tồn'/);
  assert.match(types, /posted: 'Hoàn tất'/);
  assert.match(workspace, /Kiểm kê cần duyệt/);
  assert.match(workspace, /Đã gửi kiểm kê chờ duyệt/);
  assert.match(workspace, /Tồn kho chưa thay đổi\. Chọn Cập nhật tồn kho để hoàn tất/);
  assert.match(workflowErrors, /SELF_APPROVAL_DENIED/);
  assert.match(workflowErrors, /Bạn không thể tự duyệt phiếu mình đã gửi\./);
  assert.doesNotMatch(workspace, /payload\?\.error\?\.message/);
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
  assert.match(page, /listAllInventoryBalances/);
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

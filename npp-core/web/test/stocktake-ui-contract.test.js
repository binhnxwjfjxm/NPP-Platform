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
const importActions = readFileSync(new URL('../app/operations/data-exchange/data-exchange-import-actions.ts', import.meta.url), 'utf8');
const printDock = readFileSync(new URL('../app/inventory/stocktakes/StocktakePrintDock.tsx', import.meta.url), 'utf8');
const workspaceCss = readFileSync(new URL('../app/inventory/stocktakes/stocktake-workspace.module.css', import.meta.url), 'utf8');

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

test('stocktake UI sends warehouse-owned scope choices instead of thousands of exact browser rows', () => {
  assert.match(workspace, /Toàn bộ sản phẩm trong kho/);
  assert.match(workspace, /Theo lô/);
  assert.match(workspace, /Theo vị trí/);
  assert.match(workspace, /scopeMode,/);
  assert.match(workspace, /lotSelections:/);
  assert.match(workspace, /locationIds:/);
  assert.match(workspace, /selectedScopeGroups/);
  assert.doesNotMatch(workspace, /const scopes = availableScopes/);
  assert.doesNotMatch(workspace, /STOCKTAKE_MAX_LINES/);
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
  assert.match(workflowErrors, /WAREHOUSE_LOCATION_MODE_REQUIRED/);
  assert.match(workflowErrors, /Kho chưa thiết lập chế độ quản lý vị trí/);
  assert.match(workflowErrors, /STOCKTAKE_SCOPE_NOT_AVAILABLE/);
  assert.match(workflowErrors, /không có dòng tồn hợp lệ để kiểm kê/);
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


test('manual stocktake has no business line ceiling while file import keeps its file-size contract', () => {
  assert.match(workspace, /import \{ createIdempotencyKey \} from '@npp\/contracts'/);
  assert.doesNotMatch(workspace, /STOCKTAKE_MAX_LINES/);
  assert.match(importActions, /import \{ STOCKTAKE_MAX_LINES \} from '@npp\/contracts'/);
  assert.match(importActions, /rows\.length > STOCKTAKE_MAX_LINES/);
  assert.doesNotMatch(importActions, /tối đa 500 dòng/);
});


test('stocktake line detail contract exposes office statuses and persisted reason/note fields', () => {
  assert.match(types, /StocktakeLineCountStatus = 'uncounted' \| 'matched' \| 'mismatch'/);
  assert.match(types, /uncounted: 'Chưa kiểm'/);
  assert.match(types, /matched: 'Khớp'/);
  assert.match(types, /mismatch: 'Lệch'/);
  assert.match(types, /countStatus: StocktakeLineCountStatus \| null/);
  assert.match(types, /reason: string \| null/);
  assert.match(types, /note: string \| null/);
});


test('stocktake workspace finishes the result review workflow without rendering 2,000 rows at once', () => {
  for (const label of ['Tất cả', 'Chưa kiểm', 'Khớp', 'Lệch', 'Lý do', 'Ghi chú']) {
    assert.match(workspace, new RegExp(label));
  }
  assert.match(workspace, /LINE_PAGE_SIZE = 100/);
  assert.match(workspace, /pagedLines\.map/);
  assert.doesNotMatch(workspace, /\(detail\.lines \?\? \[\]\)\.map\(\(line/);
  assert.match(workspace, /Lưu Lý do & Ghi chú/);
  assert.match(workspace, /\/annotate/);
  assert.match(actionRoute, /'annotate'/);
});

test('stocktake workspace exports the exact open result and can copy scope to a fresh stocktake', () => {
  assert.match(workspace, /Kết quả Excel/);
  assert.match(workspace, /Kết quả CSV/);
  assert.match(workspace, /\/api\/data-exchange\/xlsx/);
  assert.match(workspace, /RESULT_HEADERS/);
  assert.match(workspace, /Tồn hệ thống/);
  assert.match(workspace, /Tồn thực tế/);
  assert.match(workspace, /Sao chép phiếu/);
  assert.match(workspace, /\/copy/);
  assert.match(actionRoute, /'copy'/);
  assert.match(gateway, /'annotate'/);
  assert.match(gateway, /'copy'/);
  assert.match(workspace, /idempotencyKeys\.current\.delete\(`create:/);
  assert.match(workspace, /idempotencyKeys\.current\.delete\(`copy:/);
});

test('stocktake list shows creator and current counter from canonical stocktake data', () => {
  assert.match(types, /currentCountedAt\?: string \| null/);
  assert.match(types, /currentCountedBy\?: string \| null/);
  assert.match(workspace, /Tạo:/);
  assert.match(workspace, /Kiểm:/);
  assert.match(workspace, /Người kiểm hiện tại/);
});


test('stocktake file actions stay inside the open voucher and only fill matching count rows', () => {
  assert.match(workspace, /Xuất file phiếu/);
  assert.match(workspace, /Nhập file/);
  assert.match(workspace, /readTable\(file, \['sku', 'actualCount'\]\)/);
  assert.match(workspace, /if \(!actualCount\) continue/);
  assert.match(workspace, /normalizedMatchValue\(line\.baseSku\) === sku/);
  assert.match(workspace, /normalizedMatchValue\(line\.lotCode\) === lotCode/);
  assert.match(workspace, /normalizedMatchValue\(line\.locationCode\) === locationCode/);
  assert.match(workspace, /setCounts\(\(current\) => \(\{ \.\.\.current, \.\.\.countPatch \}\)\)/);
  assert.match(workspace, /vẫn có thể sửa tay/);
  assert.match(workspace, /File không có tồn hệ thống để giữ nguyên đếm mù/);
  assert.doesNotMatch(printDock, /operations\/data-exchange/);
  assert.doesNotMatch(printDock, /Nhập\/xuất kiểm kê/);
});

test('stocktake lot picker searches like an order-entry selector instead of rendering one long checklist', () => {
  assert.match(workspace, /Tìm tên sản phẩm, SKU hoặc mã lô/);
  assert.match(workspace, /filteredScopeGroups/);
  assert.match(workspace, /Chọn tất cả kết quả/);
  assert.match(workspace, /Bỏ chọn kết quả/);
  assert.match(workspace, /scopeChips/);
  assert.match(workspace, /scopeResults/);
  assert.match(workspace, /SCOPE_PICKER_RESULT_LIMIT = 60/);
  assert.match(workspace, /visibleScopeGroups/);
  assert.match(workspace, /Đang hiển thị 60 kết quả đầu/);
  assert.match(workspace, /Đã chọn \{selectedScopeGroups\.length\}/);
});

test('stocktake action buttons are compact and keep subtle press depth', () => {
  assert.match(workspaceCss, /min-height: 36px/);
  assert.match(workspaceCss, /box-shadow: 0 2px 5px/);
  assert.match(workspaceCss, /translateY\(-1px\)/);
  assert.match(workspaceCss, /translateY\(1px\)/);
  assert.match(workspaceCss, /\.scopeResults/);
  assert.match(workspaceCss, /max-height: 360px/);
});

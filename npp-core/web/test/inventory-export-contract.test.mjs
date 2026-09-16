import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Lô 4: UI Báo cáo tồn xuất theo bộ lọc/cột và Biến động kho phân trang + export đủ', async () => {
  const [report, dialog, gateway, reportRoute, workspace, view, movementRoute, movementBase, labels, permission] = await Promise.all([
    read('app/components/inventory-reporting-workspace.tsx'),
    read('app/components/inventory-reporting-export-dialog.tsx'),
    read('lib/inventory-reporting-export-gateway.ts'),
    read('app/api/reporting/inventory/export/route.ts'),
    read('app/operations/data-exchange/workspace.tsx'),
    read('app/operations/data-exchange/data-exchange-view.tsx'),
    read('app/api/inventory/balances/drill-down/export/route.ts'),
    read('app/api/inventory/balances/drill-down/export/base-route.ts'),
    read('lib/inventory-movement-labels.ts'),
    read('lib/inventory-movement-export-permission.ts'),
  ]);
  assert.match(report, /InventoryReportingExportDialog/);
  assert.match(report, /PRODUCT_LABEL_PAGE_SIZE = 1000/);
  assert.match(dialog, /Xuất báo cáo/);
  assert.match(dialog, /Excel \(\.xlsx\)/);
  assert.match(dialog, /CSV \(\.csv\)/);
  assert.match(dialog, /không lấy riêng 100 dòng đang hiển thị/);
  assert.match(gateway, /slowDays/);
  assert.match(reportRoute, /getInventoryReportingExport/);

  assert.match(workspace, /MOVEMENT_PAGE_SIZE = 500/);
  assert.match(workspace, /loadAllBalances/);
  assert.match(workspace, /limit=1000&offset=\$\{offset\}/);
  assert.match(workspace, /loadMoreMovements/);
  assert.match(workspace, /drill-down\/export/);
  assert.match(view, /Xem thêm/);
  assert.match(view, /Xuất Excel/);
  assert.match(view, /Xuất CSV/);
  assert.match(view, /movementTypeLabel\(row\.movement_type\)/);
  assert.doesNotMatch(view, /<td>\{row\.movement_type\}<\/td>/);
  assert.match(movementRoute, /requireInventoryMovementExportPermission/);
  assert.match(permission, /authorizeMovement/);
  assert.match(movementBase, /MAX_EXPORT_ROWS/);
  assert.match(movementBase, /withInventoryPage/);
  assert.match(labels, /Tồn đầu kỳ/);
  assert.match(labels, /Nhập kho thủ công/);
});

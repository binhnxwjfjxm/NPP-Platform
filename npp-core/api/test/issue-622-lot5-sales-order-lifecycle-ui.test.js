import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repositoryPath = resolve(here, '../src/db/repositories/sales-order.js');
const workspacePath = resolve(here, '../../web/app/sales/sales-orders/SalesOrderWorkspace.tsx');

async function source(path) {
  return readFile(path, 'utf8');
}

test('Issue #622 Lô 5 reads delivery outcome from canonical delivery attempts', async () => {
  const repository = await source(repositoryPath);

  assert.match(repository, /FROM logistics\.delivery_attempts attempt/);
  assert.match(repository, /attempt\.result = 'delivered_full'/);
  assert.match(repository, /attempt\.result IN \('delivered_full', 'delivered_partial'\)/);
  assert.match(repository, /THEN 'partially_delivered'/);
  assert.match(repository, /attempt\.result = 'rescheduled'/);
  assert.match(repository, /attempt\.result = 'failed'/);
  assert.match(repository, /JOIN logistics\.trip_dispatch_items dispatch_item/);
  assert.match(repository, /so\.delivery_status IN \('returned', 'cancelled'\)/);

  // Full delivery is only projected when every active Delivery Order is fully delivered.
  assert.match(repository, /AND NOT EXISTS \([\s\S]*delivery_order\.status <> 'cancelled'[\s\S]*AND NOT EXISTS \([\s\S]*attempt\.result = 'delivered_full'/);
});

test('Issue #622 Lô 5 keeps one Sales Orders page and groups work by business stage', async () => {
  const workspace = await source(workspacePath);

  for (const label of ['Đang xử lý', 'Đang chuẩn bị', 'Chờ giao', 'Đã hoàn thành', 'Hủy']) {
    assert.match(workspace, new RegExp(label));
  }
  assert.match(workspace, /useState<OrderWorkStage>\('active'\)/);
  assert.match(workspace, /order\.status === 'closed' \|\| order\.deliveryStatus === 'delivered'/);
  assert.match(workspace, /order\.deliveryStatus === 'delivered'\) return 'Đã giao'/);
  assert.match(workspace, /order\.deliveryStatus === 'partially_delivered'\) return 'Đã giao một phần'/);
  assert.match(workspace, /order\.deliveryStatus === 'dispatched'\) return 'Đang giao'/);

  // The page and its fixed create action remain the same surface.
  assert.match(workspace, /title="Đơn bán hàng"/);
  assert.match(workspace, /actions=\{canCreate \? <button[^>]*>Tạo đơn bán hàng<\/button> : null\}/);
});

test('Issue #622 Lô 5 separates service lane from work stage and payment', async () => {
  const workspace = await source(workspacePath);

  for (const label of ['Mua tại quầy', 'Giao thủ công', 'Giao theo chuyến']) {
    assert.match(workspace, new RegExp(label));
  }
  assert.match(workspace, /order\.deliveryMode === 'PICKUP'/);
  assert.match(workspace, /order\.deliveryExecutionMode === 'MANUAL' \? 'manual' : 'trip'/);
  assert.match(workspace, /type OrderLaneFilter = 'all' \| 'counter' \| 'manual' \| 'trip'/);

  const stageBlock = workspace.slice(
    workspace.indexOf('const WORK_STAGE_OPTIONS'),
    workspace.indexOf('const LANE_OPTIONS'),
  );
  assert.doesNotMatch(stageBlock, /paid|payment|settlement|Thanh toán|Thu tiền/);
});

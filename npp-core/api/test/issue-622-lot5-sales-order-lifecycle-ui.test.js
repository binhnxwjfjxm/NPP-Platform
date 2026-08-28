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

test('Issue #622 Lô 5 reconciles delivery outcome from delivered base quantity', async () => {
  const repository = await source(repositoryPath);

  assert.match(repository, /FROM sales\.sales_order_versions version/);
  assert.match(repository, /sum\(line\.base_quantity\)/);
  assert.match(repository, /FROM sales\.delivery_orders delivery_order/);
  assert.match(repository, /LEFT JOIN logistics\.delivery_attempts attempt/);
  assert.match(repository, /LEFT JOIN logistics\.delivery_attempt_lines attempt_line/);
  assert.match(repository, /attempt\.result IN \('delivered_full', 'delivered_partial'\)/);
  assert.match(repository, /delivery\.delivered_base_quantity >= expected\.expected_base_quantity THEN 'delivered'/);
  assert.match(repository, /delivery\.delivered_base_quantity > 0 THEN 'partially_delivered'/);
  assert.match(repository, /attempt\.result = 'rescheduled'/);
  assert.match(repository, /attempt\.result = 'failed'/);
  assert.match(repository, /LEFT JOIN logistics\.trip_dispatch_items dispatch_item/);
  assert.match(repository, /so\.delivery_status IN \('returned', 'cancelled'\)/);
});

test('Issue #622 Lô 5 keeps one Sales Orders page and groups work by business stage', async () => {
  const workspace = await source(workspacePath);

  for (const label of ['Tất cả trạng thái', 'Đang xử lý', 'Đang chuẩn bị', 'Chờ giao', 'Đã hoàn thành', 'Hủy']) {
    assert.match(workspace, new RegExp(label));
  }
  assert.match(workspace, /useState<OrderWorkStage>\('all'\)/);
  assert.match(workspace, /order\.status === 'closed' \|\| order\.deliveryStatus === 'delivered'/);
  assert.match(workspace, /order\.deliveryStatus === 'returned'\) return 'active'/);
  assert.match(workspace, /order\.deliveryStatus === 'delivered'\) status = 'Đã giao'/);
  assert.match(workspace, /order\.deliveryStatus === 'partially_delivered'\) status = 'Đã giao một phần'/);
  assert.match(workspace, /order\.deliveryStatus === 'dispatched'\) status = 'Đang giao'/);
  assert.match(workspace, /order\.status === 'draft'\) return 'Đặt hàng'/);
  assert.match(workspace, /data-sales-order-lane=\{orderLane\(order\)\}/);
  assert.match(workspace, /\{orderLaneLabel\(order\)\}<\/span>/);
  assert.match(workspace, /data-sales-order-tone=\{orderCardTone\(order\)\}/);
  assert.match(workspace, /\{orderCardStatus\(order\)\}<\/span>/);
  assert.doesNotMatch(workspace, /return `\$\{status\} · \$\{orderLaneLabel\(order\)\}`/);

  assert.match(workspace, /title="Đơn bán hàng"/);
  assert.match(workspace, /actions=\{canCreate \?/);
  assert.match(workspace, />Tạo đơn bán hàng<\/button>/);
});

test('Issue #622 Lô 5 separates service lane from work stage and payment', async () => {
  const workspace = await source(workspacePath);

  for (const label of ['Mua tại quầy', 'Giao thủ công', 'Giao theo chuyến']) {
    assert.match(workspace, new RegExp(label));
  }
  assert.match(workspace, />Luồng bán</);
  assert.match(workspace, />Trạng thái giao</);
  assert.match(workspace, /filterDivider/);
  assert.match(workspace, /order\.deliveryMode === 'PICKUP'/);
  assert.match(workspace, /order\.deliveryExecutionMode === 'MANUAL' \? 'manual' : 'trip'/);
  assert.match(workspace, /type OrderLaneFilter = 'all' \| 'counter' \| 'manual' \| 'trip'/);

  const stageBlock = workspace.slice(
    workspace.indexOf('const WORK_STAGE_OPTIONS'),
    workspace.indexOf('const LANE_OPTIONS'),
  );
  assert.doesNotMatch(stageBlock, /paid|payment|settlement|Thanh toán|Thu tiền/);
});

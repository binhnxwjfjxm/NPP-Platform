import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const workspacePath = fileURLToPath(new URL('../app/sales/sales-orders/SalesOrderWorkspace.tsx', import.meta.url));
const formPath = fileURLToPath(new URL('../app/sales/sales-orders/SalesOrderCommercialForm.tsx', import.meta.url));
const cssPath = fileURLToPath(new URL('../app/sales/sales-orders/sales-orders.module.css', import.meta.url));
const polishCssPath = fileURLToPath(new URL('../app/sales/sales-orders/sales-order-card-polish.module.css', import.meta.url));

test('bộ lọc luồng bán và trạng thái giao nằm cùng một hàng, giữ đủ lựa chọn', async () => {
  const [workspace, polishCss] = await Promise.all([
    readFile(workspacePath, 'utf8'),
    readFile(polishCssPath, 'utf8'),
  ]);
  assert.match(workspace, /useState<OrderWorkStage>\('all'\)/);
  assert.match(workspace, /value: 'all', label: 'Tất cả trạng thái'/);
  assert.match(workspace, />Hình thức giao</);
  assert.match(workspace, />Luồng bán</);
  assert.match(workspace, />Trạng thái giao</);
  assert.match(workspace, /filterDivider/);
  assert.match(workspace, />\|</);
  assert.match(workspace, /data-sales-order-lane=\{option\.value\}/);
  assert.match(workspace, /workStage === 'all'/);
  assert.match(workspace, /Đơn hiện ở \$\{WORK_STAGE_LABELS\[savedStage\]\} · \$\{orderLaneLabel\(order\)\}/);
  assert.match(polishCss, /\.filterControlRow\s*\{[^}]*display:\s*flex;/s);
  assert.match(polishCss, /\.filterGroupInline\s*\{[^}]*display:\s*flex\s*!important;/s);
});

test('card đơn tách luồng giao trên và trạng thái dưới, dùng cùng màu luồng', async () => {
  const [workspace, polishCss] = await Promise.all([
    readFile(workspacePath, 'utf8'),
    readFile(polishCssPath, 'utf8'),
  ]);
  assert.match(workspace, /className=\{polishStyles\.orderCardStateStack\}/);
  assert.match(workspace, /data-sales-order-lane=\{orderLane\(order\)\}/);
  assert.match(workspace, /\{orderLaneLabel\(order\)\}/);
  assert.match(workspace, /data-sales-order-tone=\{orderCardTone\(order\)\}/);
  assert.match(workspace, /\{orderCardStatus\(order\)\}/);
  assert.match(workspace, /return 'Đặt hàng'/);
  assert.match(workspace, /Đơn đặt hàng chưa cấp số/);
  assert.doesNotMatch(workspace, /return `\$\{status\} · \$\{orderLaneLabel\(order\)\}`/);
  assert.match(workspace, /if \(lane === 'manual'\) return 'Giao thủ công'/);
  assert.match(workspace, /status = 'Đang chuẩn bị'/);
  assert.match(polishCss, /\.laneChip\[data-sales-order-lane='counter'\],[\s\S]*\.orderLaneBadge\[data-sales-order-lane='counter'\]/);
  assert.match(polishCss, /\.laneChip\[data-sales-order-lane='manual'\],[\s\S]*\.orderLaneBadge\[data-sales-order-lane='manual'\]/);
  assert.match(polishCss, /\.laneChip\[data-sales-order-lane='trip'\],[\s\S]*\.orderLaneBadge\[data-sales-order-lane='trip'\]/);
});

test('số lượng tạo sửa đơn hiển thị gọn, vẫn nhập trực tiếp và có nút trừ cộng', async () => {
  const [form, css] = await Promise.all([
    readFile(formPath, 'utf8'),
    readFile(cssPath, 'utf8'),
  ]);
  assert.match(form, /export function compactQuantity/);
  assert.match(form, /fraction\.replace\(\/0\+\$\/, ''\)/);
  assert.match(form, /quantity: compactQuantity\(line\.quantity\)/);
  assert.match(form, /quantity: compactQuantity\(line\.quantity\),/);
  assert.match(form, /className=\{styles\.quantityMinus\}/);
  assert.match(form, /changeQuantity\(index, -1\)/);
  assert.match(form, /className=\{styles\.quantityPlus\}/);
  assert.match(form, /changeQuantity\(index, 1\)/);
  assert.match(form, /onBlur=\{\(\) => compactLineQuantity\(index\)\}/);
  assert.match(css, /grid-template-columns:28px 58px 28px/);
  assert.match(css, /\.quantityMinus\{color:#a23a32/);
  assert.match(css, /\.quantityPlus\{color:#146d55/);
});

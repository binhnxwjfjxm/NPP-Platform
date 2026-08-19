import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const workspacePath = fileURLToPath(new URL('../app/sales/sales-orders/SalesOrderWorkspace.tsx', import.meta.url));
const formPath = fileURLToPath(new URL('../app/sales/sales-orders/SalesOrderCommercialForm.tsx', import.meta.url));
const cssPath = fileURLToPath(new URL('../app/sales/sales-orders/sales-orders.module.css', import.meta.url));

test('bộ lọc tách Hình thức giao ở trên và Trạng thái ở dưới, có Tất cả trạng thái', async () => {
  const workspace = await readFile(workspacePath, 'utf8');
  assert.match(workspace, /useState<OrderWorkStage>\('all'\)/);
  assert.match(workspace, /value: 'all', label: 'Tất cả trạng thái'/);
  const laneLabel = workspace.indexOf('>Hình thức giao<');
  const statusLabel = workspace.indexOf('>Trạng thái<');
  assert.ok(laneLabel >= 0);
  assert.ok(statusLabel > laneLabel);
  assert.match(workspace, /workStage === 'all'/);
  assert.match(workspace, /Đơn hiện ở \$\{WORK_STAGE_LABELS\[savedStage\]\} · \$\{orderLaneLabel\(order\)\}/);
});

test('trạng thái card luôn thể hiện tiến độ cùng hình thức giao', async () => {
  const workspace = await readFile(workspacePath, 'utf8');
  assert.match(workspace, /return `\$\{status\} · \$\{orderLaneLabel\(order\)\}`/);
  assert.match(workspace, /if \(lane === 'manual'\) return 'Giao thủ công'/);
  assert.match(workspace, /status = 'Đang chuẩn bị'/);
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

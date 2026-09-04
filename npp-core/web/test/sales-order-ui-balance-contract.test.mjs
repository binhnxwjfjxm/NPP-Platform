import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const formPath = fileURLToPath(new URL('../app/sales/sales-orders/SalesOrderForm.tsx', import.meta.url));
const workspacePath = fileURLToPath(new URL('../app/sales/sales-orders/SalesOrderWorkspace.tsx', import.meta.url));
const polishCssPath = fileURLToPath(new URL('../app/sales/sales-orders/sales-order-card-polish.module.css', import.meta.url));

test('popup tạo đơn rộng hơn, dropdown đủ chỗ cho sáu kết quả và các trường đầu form cân chiều cao', async () => {
  const form = await readFile(formPath, 'utf8');

  assert.ok(form.includes('styles.orderEditorModal}{width:min(1520px,calc(100vw - 1rem));height:min(96vh,1020px)'));
  assert.ok(form.includes('styles.skuResults}{max-height:min(500px,calc(100dvh - 220px))'));
  assert.ok(form.includes('styles.compactHeader}{align-items:start}'));
});

test('trạng thái đơn chỉ còn text màu còn ba luồng giao vẫn giữ badge màu', async () => {
  const polishCss = await readFile(polishCssPath, 'utf8');

  assert.match(polishCss, /\.laneChip,\s*\.orderLaneBadge\s*\{[\s\S]*?background:\s*var\(--lane-bg\) !important;/);
  assert.match(polishCss, /\.orderStatusBadge\s*\{[\s\S]*?border:\s*0;[\s\S]*?background:\s*transparent !important;/);
  assert.match(polishCss, /\.orderStatusBadge\[data-sales-order-tone='waiting'\]\s*\{\s*color:/);
  assert.doesNotMatch(polishCss, /\.orderStatusBadge\[data-sales-order-tone='waiting'\]\s*\{[^}]*background:/);
});

test('số đơn chỉ rút gọn khi hiển thị, tìm kiếm vẫn dùng số đầy đủ', async () => {
  const workspace = await readFile(workspacePath, 'utf8');

  assert.ok(workspace.includes('export function compactOrderNumber'));
  assert.ok(workspace.includes('const match = /^(.+-)(\\d{6})(-\\d+)$/.exec(normalized);'));
  assert.ok(workspace.includes('return match ? `${match[1]}…${match[3]}` : normalized;'));
  assert.ok(workspace.includes('compactOrderNumber(order.number)'));
  assert.match(workspace, /function matchesSearch[\s\S]*?order\.number,/);
});

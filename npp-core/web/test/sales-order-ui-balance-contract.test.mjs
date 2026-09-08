import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const formPath = fileURLToPath(new URL('../app/sales/sales-orders/SalesOrderForm.tsx', import.meta.url));
const commercialFormPath = fileURLToPath(new URL('../app/sales/sales-orders/SalesOrderCommercialForm.tsx', import.meta.url));
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

test('card danh sách đơn chỉ giữ thông tin vận hành cần nhìn và thu gọn chiều cao', async () => {
  const workspace = await readFile(workspacePath, 'utf8');
  const polishCss = await readFile(polishCssPath, 'utf8');

  assert.ok(workspace.includes('<b>{order.customerName}</b>'));
  assert.doesNotMatch(workspace, /<b>\{order\.customerCode\}\s*—\s*\{order\.customerName\}<\/b>/);
  assert.doesNotMatch(workspace, /<small>Nguồn \{salesOrderSourceLabel/);
  assert.doesNotMatch(workspace, /<small>Kho \{order\.warehouseCode\}/);
  assert.ok(workspace.includes("<small>Kênh {order.salesChannelCode ?? 'chưa xác định'}"));
  assert.ok(workspace.includes('<small>Cập nhật {formatVietnamDateTime(order.updatedAt)}</small>'));
  assert.match(polishCss, /\.orderCardGrid\s*\{[\s\S]*?padding:\s*\.5rem \.75rem !important;/);
  assert.match(polishCss, /\.orderCardMain\s*\{[\s\S]*?gap:\s*\.18rem;/);
});

test('tìm khách dùng toàn bộ card để chọn và nhóm khách chỉ là text dịu', async () => {
  const form = await readFile(commercialFormPath, 'utf8');

  assert.ok(form.includes('function customerGroupLabel(customer: Customer): string'));
  assert.ok(form.includes("if (!group) return 'Chưa phân nhóm';"));
  assert.ok(form.includes('return /^khách hàng\\b/i.test(group) ? group : `Khách hàng ${group}`;'));
  assert.match(form, /data-testid="sales-customer-results"[\s\S]*?<button[\s\S]*?onClick=\{\(\) => \{[\s\S]*?setCustomerId\(item\.id\)/);
  assert.ok(form.includes("style={{ color: '#66766f', opacity: 0.72, fontSize: '.74rem', fontWeight: 700 }}"));
  assert.ok(form.includes('{customerGroupLabel(item)}</span>'));
  assert.doesNotMatch(form, /<b>Chọn khách<\/b>/);
  assert.doesNotMatch(form, /Khách Công Ty đang hoạt động/);
});

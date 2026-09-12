import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workspaceSource = readFileSync(new URL('../app/sales/order-management/OrderManagementWorkspace.tsx', import.meta.url), 'utf8');
const cssSource = readFileSync(new URL('../app/sales/order-management/order-management.module.css', import.meta.url), 'utf8');
const shellSource = readFileSync(new URL('../app/components/app-shell-core.tsx', import.meta.url), 'utf8');
const businessPrintSource = readFileSync(new URL('../app/components/business-document-print.tsx', import.meta.url), 'utf8');
const stockIssueConfirmSource = readFileSync(new URL('../app/sales/sales-orders/sales-order-stock-issue-confirm.ts', import.meta.url), 'utf8');

test('issue 817 exposes Quản lý đơn hàng in the Bán hàng navigation', () => {
  assert.match(shellSource, /href: '\/sales\/order-management'/);
  assert.match(shellSource, /label: 'Quản lý đơn hàng'/);
  assert.match(shellSource, /testId: 'nav-order-management'/);
});

test('issue 817 filters by date and exact time and clears prior selection when filters change', () => {
  assert.match(workspaceSource, /type="date"/);
  assert.match(workspaceSource, /type="time"/);
  assert.match(workspaceSource, /Từ ngày/);
  assert.match(workspaceSource, /Đến giờ/);
  assert.match(workspaceSource, /setSelectedIds\(new Set\(\)\)/);
  assert.match(workspaceSource, /rangeTimestamp/);
});

test('issue 817 Chọn trang này chỉ chọn các đơn đang hiển thị và đổi trang xóa lựa chọn cũ', () => {
  assert.match(workspaceSource, /new Set\(pageOrders\.map\(\(order\) => order\.id\)\)/);
  assert.match(workspaceSource, /Chọn trang này/);
  assert.match(workspaceSource, /Đã chọn \$\{selectedIds\.size\.toLocaleString\('vi-VN'\)\} đơn/);
  assert.doesNotMatch(workspaceSource, /new Set\(filteredOrders\.map\(\(order\) => order\.id\)\)/);
  assert.match(workspaceSource, /function changePage\(nextPage: number\)[\s\S]*?setSelectedIds\(new Set\(\)\);[\s\S]*?setPage\(nextPage\);/);
  assert.match(workspaceSource, /function changePageSize\(nextPageSize: number\)[\s\S]*?setSelectedIds\(new Set\(\)\);[\s\S]*?setPageSize\(nextPageSize\);/);
});

test('issue 817 chỉ xác nhận với Xuất kho nhanh và lô xuất kho hiển thị đúng số đơn', () => {
  assert.match(workspaceSource, /action === 'issue-stock' && !confirmSingleStockIssue\(order\.number\)/);
  assert.match(workspaceSource, /action === 'issue-stock' && !confirmBulkStockIssue\(targets\.length\)/);
  assert.match(stockIssueConfirmSource, /Xác nhận xuất kho \$\{target\}\?/);
  assert.match(stockIssueConfirmSource, /Xác nhận xuất kho \$\{count\.toLocaleString\('vi-VN'\)\} đơn Giao thủ công\?/);
  assert.equal((stockIssueConfirmSource.match(/window\.confirm/g) ?? []).length, 2);
});

test('issue 817 batch print reuses the canonical SalesOrderPrintSheet and current print eligibility', () => {
  assert.match(workspaceSource, /SalesOrderPrintSheet/);
  assert.match(workspaceSource, /\['confirmed', 'closed'\]\.includes\(order\.status\)/);
  assert.match(workspaceSource, /\/api\/sales-orders\/\$\{encodeURIComponent\(id\)\}/);
  assert.match(workspaceSource, /data-print-root/);
  assert.match(workspaceSource, /pageBreakBefore/);
});

test('issue 817 batch print waits for the resolved Công Ty print template and refetches selected details', () => {
  assert.match(businessPrintSource, /templateResolved/);
  assert.match(businessPrintSource, /data-print-template-ready=\{templateResolved \? 'true' : 'false'\}/);
  assert.match(workspaceSource, /waitForPrintSurfaces\(targetIds/);
  assert.match(workspaceSource, /data-print-template-ready="true"/);
  assert.match(workspaceSource, /selected\.slice\(index, index \+ 6\)/);
  assert.match(workspaceSource, /Promise\.all\(chunk\.map\(\(order\) => fetchOrderDetail\(order\.id\)\)\)/);
  assert.doesNotMatch(workspaceSource, /const missing = selected\.filter/);
});

test('issue 817 keeps the agreed compact table and excludes Sapo-only actions', () => {
  for (const label of ['Số đơn', 'Ngày tạo', 'Khách hàng', 'Trạng thái đơn', 'Thanh toán', 'Giá trị đơn', 'Xuất/chuẩn bị hàng', 'Giao hàng']) {
    assert.match(workspaceSource, new RegExp(label));
  }
  assert.doesNotMatch(workspaceSource, /Nhập file/);
  assert.doesNotMatch(workspaceSource, /Xuất file/);
  assert.doesNotMatch(workspaceSource, /Lưu bộ lọc/);
  assert.doesNotMatch(workspaceSource, />\.\.\.</);
});

test('issue 817 follows current Công Ty warm-gold and canonical lane tones', () => {
  assert.match(cssSource, /var\(--hp-bronze\)/);
  assert.match(cssSource, /var\(--hp-border\)/);
  assert.match(cssSource, /#fff5e8/);
  assert.match(cssSource, /#e8b76d/);
  assert.match(cssSource, /#eef6ff/);
  assert.match(cssSource, /#8fb9eb/);
  assert.match(cssSource, /#f5efff/);
  assert.match(cssSource, /#bea5e9/);
  assert.match(workspaceSource, /Tại quầy/);
  assert.match(workspaceSource, /Giao thủ công/);
  assert.match(workspaceSource, /Giao theo chuyến/);
});

test('issue 817 rút gọn số đơn thành SOxxxxxx chỉ ở danh sách và giữ số đầy đủ cho tìm kiếm', () => {
  assert.match(workspaceSource, /function compactOrderNumber/);
  assert.ok(workspaceSource.includes("const match = /^SO-\\d{6}-(\\d{6})$/i.exec(normalized);"));
  assert.ok(workspaceSource.includes('return match ? `SO${match[1]}` : normalized;'));
  assert.match(workspaceSource, /order\.number \? compactOrderNumber\(order\.number\) : 'Chưa cấp số'/);
  assert.match(workspaceSource, /return \[\s*order\.number,/s);
  assert.match(workspaceSource, /aria-label=\{order\.number \? `Mở đơn \$\{order\.number\}`/);
});

test('issue 817 ưu tiên độ rộng tên khách và tạo khoảng thở cho cụm Số đơn - Ngày tạo - Khách hàng', () => {
  assert.ok(cssSource.includes('.orderColumn{width:92px;padding-left:.68rem!important;padding-right:.68rem!important}'));
  assert.ok(cssSource.includes('.dateColumn,.dateCell{width:148px;white-space:nowrap;padding-left:.72rem!important;padding-right:.72rem!important}'));
  assert.ok(cssSource.includes('.customerColumn{width:350px;padding-left:.76rem!important;padding-right:.76rem!important}'));
  assert.ok(cssSource.includes('.table th:nth-child(5),.table td:nth-child(5){width:130px}'));
  assert.ok(cssSource.includes('.paymentColumn{width:82px}'));
  assert.ok(cssSource.includes('.customerName{display:block;max-width:100%'));
  assert.match(workspaceSource, /className=\{styles\.dateColumn\}>Ngày tạo/);
  assert.match(workspaceSource, /className=\{styles\.customerColumn\}>Khách hàng/);
  assert.match(workspaceSource, /className=\{styles\.paymentColumn\}>Thanh toán/);
  assert.match(workspaceSource, /<td className=\{styles\.customerColumn\}><strong className=\{styles\.customerName\}>/);
  assert.match(workspaceSource, /<td className=\{styles\.paymentColumn\}><span className=\{styles\.statusBadge\}/);
});

test('issue 817 chỉ giữ badge màu cho ba luồng giao, các trạng thái khác là chữ màu', () => {
  assert.match(cssSource, /\.statusBadge\{[^}]*border:0!important;[^}]*background:transparent!important/s);
  assert.match(cssSource, /\.deliveryState\{[^}]*border:0!important;[^}]*background:transparent!important/s);
  assert.match(cssSource, /\.statusBadge\[data-tone='waiting'\],\.deliveryState\[data-tone='waiting'\]\{color:#80683a\}/);
  assert.doesNotMatch(cssSource, /\.statusBadge\[data-tone='waiting'\][^}]*background:/);
  assert.match(cssSource, /\.laneBadge\[data-lane='counter'\]\{background:#fff5e8;border-color:#e8b76d;/);
  assert.match(cssSource, /\.laneBadge\[data-lane='manual'\]\{background:#eef6ff;border-color:#8fb9eb;/);
  assert.match(cssSource, /\.laneBadge\[data-lane='trip'\]\{background:#f5efff;border-color:#bea5e9;/);
});

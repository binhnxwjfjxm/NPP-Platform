import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const page = await readFile(new URL("../src/features/orders/OrdersClientPage.tsx", import.meta.url), "utf8");
const filters = await readFile(new URL("../src/features/orders/OrdersFilters.tsx", import.meta.url), "utf8");
const ui = await readFile(new URL("../src/features/orders/orders-page-ui.tsx", import.meta.url), "utf8");
const session = await readFile(new URL("../src/features/orders/orders-page-session.ts", import.meta.url), "utf8");
const analytics = await readFile(new URL("../src/features/orders/order-analytics.ts", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/features/orders/OrdersClientPage.module.css", import.meta.url), "utf8");
const tabStyles = await readFile(new URL("../src/features/orders/OrdersTabs.module.css", import.meta.url), "utf8");
const detail = await readFile(new URL("../src/features/orders/OrderDetailDrawer.tsx", import.meta.url), "utf8");
const detailStyles = await readFile(new URL("../src/features/orders/OrderDetailDrawer.module.css", import.meta.url), "utf8");

function sectionBetween(start, end) {
  const startIndex = page.indexOf(start);
  assert.ok(startIndex >= 0, `missing start marker: ${start}`);
  assert.equal(page.indexOf(start, startIndex + start.length), -1, `marker is not unique: ${start}`);
  const endIndex = page.indexOf(end, startIndex + start.length);
  assert.ok(endIndex > startIndex, `missing end marker after: ${start}`);
  return page.slice(startIndex, endIndex);
}

test("orders page owns four URL-addressable work views", () => {
  assert.match(page, /type OrderView = "orders" \| "attention" \| "sales" \| "overview"/);
  assert.match(page, /searchParams\.get\("view"\)/);
  assert.match(page, /if \(view === "orders"\) params\.delete\("view"\)/);
  assert.match(page, /else params\.set\("view", view\)/);
  assert.match(page, /role="tablist" aria-label="Phân tích và xử lý đơn hàng"/);
  assert.match(page, /role="tab"/);
  for (const label of ["Đơn hàng", "Cần xử lý", "Doanh số đặt hàng", "Tổng quan"]) {
    assert.match(page, new RegExp(`label: "${label}"`));
  }
});

test("default orders view keeps search, create, list and detail ownership", () => {
  const ordersView = sectionBetween('{activeView === "orders" ? (\n        <div', '{activeView === "attention" ? (\n        <div');
  assert.match(page, /createLoading \? "Đang tải phiên\.\.\." : "\+ Tạo đơn"/);
  assert.match(ordersView, /filtersPanel\(true\)/);
  assert.match(ordersView, /id="orders-result-list"/);
  assert.match(ordersView, /<OrderCard/);
  assert.match(page, /<OrderDetailDrawer/);
  assert.match(page, /<OrderCreateSheet/);
  assert.match(filters, /placeholder="Mã đơn, khách, tuyến, nhân viên\.\.\."/);
});

test("attention view separates pending, stale, duplicate, cancelled and invalid-value work", () => {
  const attentionView = sectionBetween('{activeView === "attention" ? (\n        <div', '{activeView === "sales" ? (\n        <div');
  for (const id of ["pending", "stale", "possible_duplicate", "cancelled", "zero_value"]) {
    assert.match(page, new RegExp(`id: "${id}"`));
  }
  assert.match(page, /if \(attention === "zero_value"\)/);
  assert.match(page, /!Number\.isFinite\(amount\) \|\| amount <= 0/);
  assert.match(attentionView, /không tự đổi lifecycle/i);
  assert.match(attentionView, /aria-label="Loại đơn cần xử lý"/);
  assert.match(attentionView, /attentionOrders\.map/);
  assert.match(page, /const filteredAttention = useMemo/);
  assert.match(attentionView, /filteredAttention\.ids\.size/);
  assert.match(attentionView, /filteredAttention\.counts\[view\.id\]/);
});

test("sales view labels order intake correctly and breaks it down by required dimensions", () => {
  const salesView = sectionBetween('{activeView === "sales" ? (\n        <div', '{activeView === "overview" ? (\n        <div');
  assert.match(salesView, /Đang đo doanh số đặt hàng/);
  assert.match(salesView, /chưa phải doanh thu giao hàng hoặc tiền đã thu/);
  assert.match(ui, /Nhịp doanh số theo ngày/);
  assert.match(salesView, /Doanh số theo khách/);
  assert.match(salesView, /Hiệu quả theo tuyến/);
  assert.match(salesView, /Theo nhân viên/);
  assert.match(salesView, /Theo nguồn đơn/);
  assert.doesNotMatch(salesView, /Doanh thu chính thức|Doanh thu thực/);
});

test("overview view contains exactly four decision cards and no full analysis grid", () => {
  const overviewView = sectionBetween('{activeView === "overview" ? (\n        <div', '<OrderDetailDrawer');
  assert.equal((overviewView.match(/<KpiCard/g) || []).length, 4);
  assert.match(overviewView, /Nhìn nhanh để chọn bước tiếp theo/);
  assert.match(overviewView, /aria-label="Chỉ số tổng quan đơn hàng"/);
  assert.match(overviewView, /onClick=\{\(\) => setView\("sales"\)\}/);
  assert.match(overviewView, /onClick=\{\(\) => setView\("orders"\)\}/);
  assert.match(overviewView, /onClick=\{\(\) => setView\("attention"\)\}/);
  assert.doesNotMatch(overviewView, /analysisGrid|BreakdownPanel|DailyTrend/);
});

test("order filters own period, search, route, owner, source and status", () => {
  assert.match(analytics, /export type OrderPeriod = "7d" \| "30d" \| "90d" \| "all"/);
  assert.match(analytics, /export type OrderAttention = "all" \| "pending" \| "stale" \| "possible_duplicate" \| "cancelled"/);
  assert.match(analytics, /export function filterOrders/);
  assert.match(filters, />Tuyến</);
  assert.match(filters, />Nhân viên</);
  assert.match(filters, />Trạng thái</);
  assert.match(filters, />Nguồn đơn</);
  assert.match(filters, /!search && filters\.search/);
  assert.match(filters, /onChange\("search", ""\)/);
  assert.match(filters, /onReset/);
});

test("pending and stale semantics do not infer delivery backlog from confirmed orders", () => {
  assert.match(analytics, /function isPending\(order: OrderDto\) \{\s*return order\.status === "draft";\s*\}/);
  assert.match(analytics, /Đơn nháp tồn quá 3 ngày/);
  assert.doesNotMatch(analytics, /order\.status === "draft" \|\| order\.status === "confirmed"/);
});

test("analytics detect risks without mutating orders", () => {
  assert.match(analytics, /Đơn có dấu hiệu trùng/);
  assert.match(analytics, /Cùng khách, ngày, giá trị, số lượng và số SKU/);
  assert.match(analytics, /Doanh số phụ thuộc khách lớn/);
  assert.match(analytics, /possibleDuplicateOrderIds/);
  assert.doesNotMatch(analytics, /fetch\(|supabase|delete\(|update\(/i);
});

test("drill-down scrolls after orders tab render and filtered CSV remains explicit", () => {
  assert.match(page, /const pendingScrollRef = useRef\(false\)/);
  assert.match(page, /pendingScrollRef\.current = true;\s*setView\("orders"\)/);
  assert.match(page, /activeView !== "orders"/);
  assert.match(page, /scrollIntoView\(\{ behavior: "smooth", block: "start" \}\)/);
  assert.doesNotMatch(page, /window\.setTimeout\([\s\S]*orders-result-list/);
  assert.match(ui, /export function downloadOrdersCsv\(orders: OrderDto\[\]\)/);
  assert.match(ui, /text\/csv;charset=utf-8/);
  assert.match(ui, /don-hang-theo-bo-loc/);
  assert.match(page, /label: "Danh sách theo bộ lọc \(CSV\)"/);
  assert.match(page, /downloadOrdersCsv\(orders\)/);
});

test("order detail stays URL-owned and preserves tab context", () => {
  assert.match(page, /searchParams\.get\("detail"\)/);
  assert.match(page, /params\.set\("detail", order\.id\)/);
  assert.match(page, /router\.back\(\)/);
  assert.match(page, /params\.delete\("detail"\)/);
  assert.match(page, /router\.replace\(/);
  assert.match(page, /scroll: false/);
  assert.match(page, /detailReturnFocusRef/);
});

test("create-order session loading remains isolated, timed out and fail-closed", () => {
  assert.match(session, /export async function loadOrderSessions/);
  assert.match(session, /new URLSearchParams\(\{ routeId \}\)/);
  assert.match(session, /\/api\/backend\/mcp-settings\/session-status/);
  assert.match(session, /signal: AbortSignal\.timeout\(15_000\)/);
  assert.match(page, /Form chưa được mở để tránh hiển thị sai khách hoặc trộn khách giữa các tuyến/);
});

test("order KPI default tone never emits an undefined CSS class", () => {
  assert.match(ui, /tone === "default" \? "" : styles\[`kpi_\$\{tone\}`\]/);
  assert.match(ui, /filter\(Boolean\)\.join\(" "\)/);
});

test("order detail loads persisted products and uses business-facing copy", () => {
  assert.match(detail, /fetch\(`\/api\/backend\/orders\/\$\{encodeURIComponent\(routedOrderId\)\}`/);
  assert.match(detail, /detail\.items/);
  assert.match(detail, />Sản phẩm</);
  assert.match(detail, />Khách hàng và giao hàng</);
  assert.match(detail, />Thông tin đơn</);
});

test("order detail uses a desktop drawer and mobile fullscreen surface", () => {
  assert.match(detail, /createPortal/);
  assert.match(detail, /role="dialog"/);
  assert.match(detail, /aria-modal="true"/);
  assert.match(detail, /data-order-detail-surface="drawer"/);
  assert.match(detailStyles, /width: min\(680px, calc\(100vw - 72px\)\)/);
  assert.match(detailStyles, /@media \(max-width: 720px\)/);
  assert.match(detailStyles, /width: 100vw/);
});

test("orders tabs stay responsive without dashboard overflow", () => {
  assert.match(styles, /\.filterGrid \{[\s\S]*grid-template-columns/);
  assert.match(styles, /@media \(max-width: 820px\)/);
  assert.match(styles, /@media \(max-width: 560px\)/);
  assert.match(tabStyles, /\.tabRail \{[\s\S]*repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(tabStyles, /@media \(max-width: 560px\)[\s\S]*overflow-x: auto/);
  assert.match(tabStyles, /\.overviewGrid\.overviewGrid \{[\s\S]*repeat\(4, minmax\(0, 1fr\)\)/);
});

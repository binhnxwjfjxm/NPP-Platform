import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const page = await readFile(new URL("../src/features/orders/OrdersClientPage.tsx", import.meta.url), "utf8");
const analytics = await readFile(new URL("../src/features/orders/order-analytics.ts", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/features/orders/OrdersClientPage.module.css", import.meta.url), "utf8");
const detail = await readFile(new URL("../src/features/orders/OrderDetailDrawer.tsx", import.meta.url), "utf8");
const detailStyles = await readFile(new URL("../src/features/orders/OrderDetailDrawer.module.css", import.meta.url), "utf8");

test("orders page is an operational control center instead of a static list", () => {
  assert.match(page, /title="Trung tâm đơn hàng"/);
  assert.match(page, /Đang đo doanh số đặt hàng/);
  assert.match(page, /chưa phải doanh thu giao hàng hoặc tiền đã thu/);
  assert.match(page, /Bộ lọc đơn hàng/);
  assert.match(page, /Doanh số theo khách/);
  assert.match(page, /Hiệu quả theo tuyến/);
  assert.match(page, /Theo nhân viên/);
  assert.match(page, /Theo nguồn đơn/);
  assert.match(page, /Cần chủ doanh nghiệp chú ý/);
  assert.match(page, /Đơn theo bộ lọc/);
});

test("order filters own period, search, route, owner, source, status and attention", () => {
  assert.match(analytics, /export type OrderPeriod = "7d" \| "30d" \| "90d" \| "all"/);
  assert.match(analytics, /export type OrderAttention = "all" \| "pending" \| "stale" \| "possible_duplicate" \| "cancelled"/);
  assert.match(analytics, /export function filterOrders/);
  assert.match(page, /placeholder="Mã đơn, khách, tuyến, nhân viên\.\.\."/);
  assert.match(page, />Tuyến</);
  assert.match(page, />Nhân viên</);
  assert.match(page, />Trạng thái</);
  assert.match(page, />Nguồn đơn</);
  assert.match(page, />Cần chú ý</);
  assert.match(page, /setFilters\(DEFAULT_ORDER_FILTERS\)/);
});

test("business KPIs are derived from the filtered order population", () => {
  assert.match(analytics, /totalAmount/);
  assert.match(analytics, /customerCount/);
  assert.match(analytics, /averageOrder: orderCount \? totalAmount \/ orderCount : 0/);
  assert.match(analytics, /revenuePerCustomer: customerCount \? totalAmount \/ customerCount : 0/);
  assert.match(analytics, /averageSkuPerOrder: orderCount \? totalSkuCount \/ orderCount : 0/);
  assert.match(analytics, /deliveredRate: orderCount \? deliveredCount \/ orderCount : 0/);
  assert.match(analytics, /cancelledRate: orderCount \? cancelledCount \/ orderCount : 0/);
  assert.match(page, /label="Doanh số đặt hàng"/);
  assert.match(page, /label="Doanh số\/khách"/);
  assert.match(page, /label="SKU\/đơn"/);
  assert.doesNotMatch(page, /label="Doanh thu thực"/);
});

test("pending and stale semantics do not infer delivery backlog from confirmed orders", () => {
  assert.match(analytics, /function isPending\(order: OrderDto\) \{\s*return order\.status === "draft";\s*\}/);
  assert.match(analytics, /Đơn nháp tồn quá 3 ngày/);
  assert.match(analytics, /Đơn đã bắt đầu nhưng chưa được chốt/);
  assert.doesNotMatch(analytics, /order\.status === "draft" \|\| order\.status === "confirmed"/);
});

test("analytics detect operational risks without deleting or mutating orders", () => {
  assert.match(analytics, /Đơn có dấu hiệu trùng/);
  assert.match(analytics, /Cùng khách, ngày, giá trị, số lượng và số SKU/);
  assert.match(analytics, /Doanh số phụ thuộc khách lớn/);
  assert.match(analytics, /possibleDuplicateOrderIds/);
  assert.doesNotMatch(analytics, /fetch\(|supabase|delete\(|update\(/i);
});

test("drill-down and filtered CSV export remain client-owned and explicit", () => {
  assert.match(page, /function focusList\(next: Partial<OrderFilters>\)/);
  assert.match(page, /scrollIntoView\(\{ behavior: "smooth"/);
  assert.match(page, /function downloadOrdersCsv\(orders: OrderDto\[\]\)/);
  assert.match(page, /text\/csv;charset=utf-8/);
  assert.match(page, /don-hang-theo-bo-loc/);
  assert.match(page, /label="Chọn loại file"/);
  assert.match(page, /Danh sách theo bộ lọc \(CSV\)/);
  assert.match(page, /onClick: \(\) => downloadOrdersCsv\(filteredOrders\)/);
});

test("order detail is URL-owned and preserves list context", () => {
  assert.match(page, /useSearchParams\(\)/);
  assert.match(page, /searchParams\.get\("detail"\)/);
  assert.match(page, /params\.set\("detail", order\.id\)/);
  assert.match(page, /router\.push\(`/);
  assert.match(page, /router\.back\(\)/);
  assert.match(page, /params\.delete\("detail"\)/);
  assert.match(page, /router\.replace\(/);
  assert.match(page, /scroll: false/);
  assert.match(page, /detailReturnFocusRef/);
  assert.doesNotMatch(page, /OrderDetailSheet|setSelectedOrder/);
});

test("order detail loads persisted products and uses business-facing copy", () => {
  assert.match(detail, /fetch\(`\/api\/backend\/orders\/\$\{encodeURIComponent\(routedOrderId\)\}`/);
  assert.match(detail, /setDetail\(payload\.data\)/);
  assert.match(detail, /detail\.items/);
  assert.match(detail, />Sản phẩm</);
  assert.match(detail, /item\.productName/);
  assert.match(detail, /item\.quantity/);
  assert.match(detail, /item\.unitPrice/);
  assert.match(detail, /item\.discount/);
  assert.match(detail, /item\.lineTotal/);
  assert.match(detail, />Khách hàng và giao hàng</);
  assert.match(detail, />Thông tin đơn</);
  assert.doesNotMatch(detail, /Snapshot tại thời điểm ghi nhận|Số liệu tổng hợp từ API danh sách|ID hệ thống|Chưa có chi tiết từng dòng hàng|API đơn hiện chỉ trả/);
});

test("order detail uses a desktop drawer and a mobile fullscreen surface", () => {
  assert.match(detail, /createPortal/);
  assert.match(detail, /role="dialog"/);
  assert.match(detail, /aria-modal="true"/);
  assert.match(detail, /data-order-detail-surface="drawer"/);
  assert.match(detail, /data-app-scroll-region/);
  assert.match(detail, /event\.key === "Escape"/);
  assert.match(detail, /event\.key !== "Tab"/);
  assert.doesNotMatch(detail, /BottomSheet/);
  assert.match(detailStyles, /width: min\(680px, calc\(100vw - 72px\)\)/);
  assert.match(detailStyles, /height: 100dvh/);
  assert.match(detailStyles, /justify-content: flex-end/);
  assert.match(detailStyles, /\.itemList/);
  assert.match(detailStyles, /\.itemRow/);
  assert.match(detailStyles, /@media \(max-width: 720px\)/);
  assert.match(detailStyles, /width: 100vw/);
  assert.match(detailStyles, /border-radius: 0/);
});

test("orders control center is responsive without horizontal dashboard overflow", () => {
  assert.match(styles, /\.filterGrid \{[\s\S]*grid-template-columns/);
  assert.match(styles, /\.kpiGrid \{[\s\S]*repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(max-width: 820px\)/);
  assert.match(styles, /@media \(max-width: 560px\)/);
  assert.match(styles, /\.analysisGrid \{[\s\S]*grid-template-columns/);
  assert.doesNotMatch(styles, /align-items:\s*end/);
});

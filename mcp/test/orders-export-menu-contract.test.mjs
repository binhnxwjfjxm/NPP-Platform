import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const [ordersPage, ordersUi, exportLinks, orderStyles, filters] = await Promise.all([
  readFile(new URL("../src/features/orders/OrdersClientPage.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/features/orders/orders-page-ui.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/features/exports/ExportLinks.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/features/orders/OrdersClientPage.module.css", import.meta.url), "utf8"),
  readFile(new URL("../src/features/orders/OrdersFilters.tsx", import.meta.url), "utf8")
]);

test("orders page exposes an explicit export type menu in list and sales views", () => {
  assert.match(ordersPage, /import \{ ExportMenu \}/);
  assert.match(ordersPage, /label="Chọn loại file"/);
  assert.match(ordersPage, /Danh sách theo bộ lọc \(CSV\)/);
  assert.match(ordersPage, /Danh sách tất cả đơn \(CSV\)/);
  assert.match(ordersPage, /Chi tiết sản phẩm \(CSV\)/);
  assert.match(ordersPage, /Báo cáo điều hành/);
  assert.match(ordersPage, /Báo cáo thị trường/);
  assert.match(ordersPage, /activeView === "orders" \|\| activeView === "sales"/);
});

test("Lô 3 keeps the tab rail stable by owning order actions below the rail", () => {
  assert.match(ordersPage, /<McpPageHeader/);
  assert.doesNotMatch(ordersPage, /<McpPageHeader[\s\S]*?actions=\{/);
  assert.match(ordersPage, /data-orders-view-actions="true"/);
  assert.ok(ordersPage.indexOf('aria-label="Phân tích và xử lý đơn hàng"') < ordersPage.indexOf('data-orders-view-actions="true"'));
  assert.match(orderStyles, /\.viewActions\s*\{[\s\S]*?display:\s*flex/);
  assert.match(orderStyles, /\.viewActions\s*\{[\s\S]*?flex-wrap:\s*wrap/);
  const mobile = orderStyles.slice(orderStyles.indexOf("@media (max-width: 640px)"));
  assert.match(mobile, /\.viewActions\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
});

test("order filter card keeps controls and removes explanatory filler", () => {
  for (const label of ["Tìm nhanh", "Tuyến", "Nhân viên", "Trạng thái", "Nguồn đơn"]) {
    assert.match(filters, new RegExp(`>${label}<`));
  }
  assert.match(filters, /PERIOD_LABELS/);
  assert.match(filters, /aria-label=\{`Khoảng dữ liệu; ngày mới nhất/);
  assert.doesNotMatch(filters, />Khoảng dữ liệu</);
  assert.doesNotMatch(filters, /Tính lùi từ ngày dữ liệu mới nhất/);
  assert.doesNotMatch(filters, /Chưa áp dụng bộ lọc bổ sung/);
});

test("per-order actions keep PDF A5 and the approved workbook format", () => {
  assert.match(ordersUi, />PDF A5<\/a>/);
  assert.match(ordersUi, />XLSX mẫu<\/a>/);
  assert.match(ordersUi, /orderId=\$\{encodeURIComponent\(order\.id\)\}/);
  assert.match(ordersUi, /data-order-card="true"/);
});

test("shared export menu supports local download actions", () => {
  assert.match(exportLinks, /onClick\?: \(\) => void/);
  assert.match(exportLinks, /item\.onClick\?\.\(\)/);
  assert.match(exportLinks, /closest\("details"\)\?\.removeAttribute\("open"\)/);
});

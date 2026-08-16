import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const [ordersPage, ordersUi, exportLinks, exportStyles, filters] = await Promise.all([
  readFile(new URL("../src/features/orders/OrdersClientPage.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/features/orders/orders-page-ui.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/features/exports/ExportLinks.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/app/export-menu-fix.css", import.meta.url), "utf8"),
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

test("Issue #600 Lot B keeps the three order-center actions compact and collision-free", () => {
  assert.match(exportStyles, /\.app-shell\[data-active-href="\/orders"\] \.page-header-actions\s*\{[\s\S]*grid-template-columns:\s*repeat\(3, minmax\(0, max-content\)\)/);
  assert.match(exportStyles, /\.app-shell\[data-active-href="\/orders"\] \.page-header-actions > \.button,[\s\S]*min-height:\s*34px !important/);
  assert.match(exportStyles, /\.app-shell\[data-active-href="\/orders"\] \.page-header-actions \.export-menu-trigger[\s\S]*white-space:\s*nowrap/);
  const mobile = exportStyles.slice(exportStyles.indexOf("@media (max-width: 560px)"));
  assert.match(mobile, /grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(mobile, /text-overflow:\s*ellipsis/);
});

test("Issue #600 Lot B filter card keeps controls and removes explanatory filler", () => {
  for (const label of ["Tìm nhanh", "Tuyến", "Nhân viên", "Trạng thái", "Nguồn đơn"]) {
    assert.match(filters, new RegExp(`>${label}<`));
  }
  assert.match(filters, /PERIOD_LABELS/);
  assert.match(filters, /aria-label=\{`Khoảng dữ liệu; ngày mới nhất/);
  assert.doesNotMatch(filters, />Khoảng dữ liệu</);
  assert.doesNotMatch(filters, /Tính lùi từ ngày dữ liệu mới nhất/);
  assert.doesNotMatch(filters, /Chưa áp dụng bộ lọc bổ sung/);
});

test("per-order action names the approved workbook format", () => {
  assert.match(ordersUi, /label: "XLSX mẫu"/);
  assert.match(ordersUi, /orderId=\$\{encodeURIComponent\(order\.id\)\}/);
});

test("shared export menu supports local download actions", () => {
  assert.match(exportLinks, /onClick\?: \(\) => void/);
  assert.match(exportLinks, /item\.onClick\?\.\(\)/);
  assert.match(exportLinks, /closest\("details"\)\?\.removeAttribute\("open"\)/);
});

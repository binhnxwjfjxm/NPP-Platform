import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const [ordersPage, ordersUi, exportLinks] = await Promise.all([
  readFile(new URL("../src/features/orders/OrdersClientPage.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/features/orders/orders-page-ui.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/features/exports/ExportLinks.tsx", import.meta.url), "utf8")
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

test("per-order action names the approved workbook format", () => {
  assert.match(ordersUi, /label: "XLSX mẫu"/);
  assert.match(ordersUi, /orderId=\$\{encodeURIComponent\(order\.id\)\}/);
});

test("shared export menu supports local download actions", () => {
  assert.match(exportLinks, /onClick\?: \(\) => void/);
  assert.match(exportLinks, /item\.onClick\?\.\(\)/);
  assert.match(exportLinks, /closest\("details"\)\?\.removeAttribute\("open"\)/);
});

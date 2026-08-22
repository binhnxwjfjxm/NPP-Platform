import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const routePage = await readFile(new URL("../src/app/orders/page.tsx", import.meta.url), "utf8");
const page = await readFile(new URL("../src/features/orders/OrdersClientPage.tsx", import.meta.url), "utf8");
const serverPage = await readFile(new URL("../src/features/orders/OrdersPage.tsx", import.meta.url), "utf8");
const compatibilitySheet = await readFile(new URL("../src/features/orders/OrderCreateSheet.tsx", import.meta.url), "utf8");
const loader = await readFile(new URL("../src/features/orders/CoreOrderCreateLoader.tsx", import.meta.url), "utf8");
const sheet = await readFile(new URL("../src/features/orders/CoreOrderCreateSheet.tsx", import.meta.url), "utf8");
const catalogStyles = await readFile(new URL("../src/features/orders/OrderCatalogQuick.module.css", import.meta.url), "utf8");
const catalogPriority = await readFile(new URL("../src/features/orders/order-catalog-priority.ts", import.meta.url), "utf8");
const workspaceStyles = await readFile(new URL("../src/app/order-create-workspace.css", import.meta.url), "utf8");
const bottomSheet = await readFile(new URL("../src/ui/overlay/BottomSheet.tsx", import.meta.url), "utf8");

test("orders route restores the existing order control center instead of replacing it with the Core form", () => {
  assert.match(routePage, /OrdersPage/);
  assert.doesNotMatch(routePage, /McpCoreOrdersPage/);
  assert.match(serverPage, /loadOrdersResult\(\)/);
  assert.match(page, /label: "Đơn hàng"/);
  assert.match(page, /label: "Cần xử lý"/);
  assert.match(page, /label: "Doanh số đặt hàng"/);
  assert.match(page, /label: "Tổng quan"/);
  assert.match(page, /<OrdersFilters/);
  assert.match(page, /<OrderDetailDrawer/);
  assert.match(page, /<OrderCreateSheet/);
  assert.match(page, /"\+ Tạo đơn"/);
});

test("create-order entry uses canonical Công Ty customers instead of requiring an MCP onboarding link", () => {
  assert.match(compatibilitySheet, /CoreOrderCreateLoader/);
  assert.match(loader, /fetch\("\/api\/backend\/core-customers"/);
  assert.match(loader, /item\.status === "active"/);
  assert.match(loader, /item\.defaultAddressId/);
  assert.match(loader, /payload\.data\?\.customers/);
  assert.doesNotMatch(loader, /customer-verifications/);
  assert.doesNotMatch(loader, /approved|linked_existing/);
  assert.match(sheet, /Chọn khách Công Ty/);
  assert.match(sheet, /Khách đang hoạt động, có địa chỉ và thuộc phạm vi được phép bán/);
  assert.match(sheet, /Chưa có khách Công Ty đủ điều kiện/);
  assert.doesNotMatch(sheet, /Chỉ khách đã mở|Mở \/ liên kết mã|đã mở mã/);
  assert.doesNotMatch(sheet, /Khách nhập tay|customerMode|ManualCustomer/);
  assert.doesNotMatch(sheet, /customers\/onboarding/);
});

test("restored create-order UI remains the fullscreen three-step mobile workspace", () => {
  assert.match(sheet, /type MobilePanel = "customer" \| "catalog" \| "cart"/);
  assert.match(sheet, /variant="workspace"/);
  assert.match(sheet, /data-mobile-panel=\{mobilePanel\}/);
  assert.match(sheet, />1\. Khách</);
  assert.match(sheet, />2\. Sản phẩm</);
  assert.match(sheet, />3\. Đơn</);
  assert.match(bottomSheet, /variant\?: "default" \| "compact" \| "workspace"/);
  assert.match(workspaceStyles, /\.bottom-sheet-workspace\s*\{[\s\S]*height: 100% !important/);
});

test("Công Ty order submit keeps canonical idempotency and never sends browser commercial authority", () => {
  assert.match(sheet, /createIdempotencyKey\("mcp\.sales-order\.create"\)/);
  assert.match(sheet, /const fingerprint = JSON\.stringify\(body\)/);
  assert.match(sheet, /submissionRef\.current\.fingerprint !== fingerprint/);
  assert.match(sheet, /key: submissionRef\.current\.key/);
  assert.match(sheet, /"\/api\/backend\/core-sales\/orders"/);
  assert.match(sheet, /customerId: selectedCustomer\.id/);
  assert.match(sheet, /customerAddressId: selectedCustomer\.defaultAddressId/);
  assert.match(sheet, /variantId: item\.variantId/);
  assert.match(sheet, /quantity: String\(item\.quantity\)/);
  assert.doesNotMatch(sheet, /"\/api\/backend\/orders"/);

  const bodyStart = sheet.indexOf("const body = {");
  const bodyEnd = sheet.indexOf("const fingerprint", bodyStart);
  assert.ok(bodyStart >= 0 && bodyEnd > bodyStart, "Công Ty submit body must remain explicit and reviewable");
  const submissionBody = sheet.slice(bodyStart, bodyEnd);
  assert.doesNotMatch(submissionBody, /unitPrice|customerMode|manualCustomer|setSales|setStatus/);
});

test("catalog uses Ordering-style left filter rail without copying Ordering purchase-mode logic", () => {
  assert.match(sheet, /data-order-filter-rail/);
  assert.match(sheet, /Nhóm sản phẩm/);
  assert.match(sheet, /Nhãn hàng/);
  assert.match(sheet, /selectCategory\(category\)/);
  assert.match(sheet, /selectBrand\(brand\)/);
  assert.doesNotMatch(sheet, /Mua lẻ|Mua thùng|purchaseMode/);
  assert.match(catalogStyles, /\.catalogLayout\s*\{[\s\S]*grid-template-columns:\s*142px minmax\(0, 1fr\)/);
  assert.match(catalogStyles, /\.filterRail\s*\{/);
});

test("each MCP product stays one card with flat Lẻ-Thùng rows and compact plus action", () => {
  assert.match(sheet, /productGroups\.map\(\(group\)/);
  assert.match(sheet, /<article key=\{group\.productId\}[\s\S]*data-order-product-card/);
  assert.match(sheet, /group\.variants\.map\(\(product\) => \{/);
  assert.match(sheet, /purchaseUnitLabel\(product\)/);
  assert.match(sheet, /className=\{catalogStyles\.unitRow\}/);
  assert.match(sheet, /className=\{catalogStyles\.unitAdd\}/);
  assert.match(sheet, /onClick=\{\(\) => addProduct\(product\)\}/);
  assert.match(sheet, /<span aria-hidden="true">\+<\/span>/);
  assert.doesNotMatch(sheet, /styles\.variantGrid|styles\.variantButton|\+ Thêm/);
  assert.match(catalogStyles, /\.unitRow\s*\{[\s\S]*border-top:/);
  assert.doesNotMatch(catalogStyles.match(/\.unitRow\s*\{[\s\S]*?\}/)?.[0] ?? "", /border-radius|background:/);

  const addRule = catalogStyles.match(/\.unitAdd\s*\{([\s\S]*?)\}/)?.[1] ?? "";
  assert.match(addRule, /width:\s*40px/);
  assert.match(addRule, /height:\s*40px/);
  assert.match(addRule, /border:\s*0/);
  assert.match(addRule, /background:\s*transparent/);
  assert.match(addRule, /color:\s*var\(--warning\)/);
  assert.match(addRule, /box-shadow:\s*none/);
  assert.doesNotMatch(addRule, /border-radius:\s*50%/);
  assert.match(catalogStyles, /\.unitAdd > span\s*\{[\s\S]*font-size:\s*22px[\s\S]*font-weight:\s*950/);
  assert.doesNotMatch(catalogStyles, /\.unitAdd > span::before|\.unitAdd > span::after/);

  const milkTeaIndex = catalogPriority.indexOf('label: "Nguyên liệu trà sữa"');
  const spicyIndex = catalogPriority.indexOf('label: "Mì cay & đồ ăn"');
  const packagingIndex = catalogPriority.indexOf('label: "Bao bì & dụng cụ"');
  assert.ok(milkTeaIndex > 0 && spicyIndex > milkTeaIndex && packagingIndex > spicyIndex);
});

test("draft close remains guarded and Công Ty price is display-only", () => {
  assert.match(sheet, /function requestClose\(\)/);
  assert.match(sheet, /window\.confirm\("Đơn đang nhập chưa lưu\. Đóng và bỏ nội dung này\?"\)/);
  assert.match(sheet, /onClose=\{requestClose\}/);
  assert.match(sheet, /Giá tham khảo/);
  assert.match(sheet, /Công Ty quyết định|Công Ty xác định giá/);
  assert.doesNotMatch(sheet, /"[^"\n]*Core[^"\n]*"/);
  assert.doesNotMatch(sheet, /Đơn giá tạm|Nhập giá/);
});

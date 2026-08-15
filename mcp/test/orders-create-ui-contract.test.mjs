import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const routePage = await readFile(new URL("../src/app/orders/page.tsx", import.meta.url), "utf8");
const page = await readFile(new URL("../src/features/orders/OrdersClientPage.tsx", import.meta.url), "utf8");
const serverPage = await readFile(new URL("../src/features/orders/OrdersPage.tsx", import.meta.url), "utf8");
const compatibilitySheet = await readFile(new URL("../src/features/orders/OrderCreateSheet.tsx", import.meta.url), "utf8");
const loader = await readFile(new URL("../src/features/orders/CoreOrderCreateLoader.tsx", import.meta.url), "utf8");
const sheet = await readFile(new URL("../src/features/orders/CoreOrderCreateSheet.tsx", import.meta.url), "utf8");
const sheetStyles = await readFile(new URL("../src/features/orders/OrderCreateSheet.module.css", import.meta.url), "utf8");
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

test("create-order entry keeps the old workspace shell but loads only linked company customers", () => {
  assert.match(compatibilitySheet, /CoreOrderCreateLoader/);
  assert.match(loader, /fetch\("\/api\/backend\/customer-verifications"/);
  assert.match(loader, /item\.status === "approved" \|\| item\.status === "linked_existing"/);
  assert.match(loader, /item\.coreCustomerId/);
  assert.match(loader, /item\.coreCustomerAddressId/);
  assert.match(sheet, /Chọn khách công ty/);
  assert.match(sheet, /Chỉ khách đã mở hoặc liên kết mã mới được tạo đơn/);
  assert.doesNotMatch(sheet, /Khách nhập tay|customerMode|ManualCustomer/);
  assert.doesNotMatch(sheet, /Mở \/ liên kết mã.*href|customers\/onboarding/);
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

test("Core order submit keeps canonical idempotency and never sends browser commercial authority", () => {
  assert.match(sheet, /createIdempotencyKey\("mcp\.sales-order\.create"\)/);
  assert.match(sheet, /const fingerprint = JSON\.stringify\(body\)/);
  assert.match(sheet, /submissionRef\.current\.fingerprint !== fingerprint/);
  assert.match(sheet, /key: submissionRef\.current\.key/);
  assert.match(sheet, /"\/api\/backend\/core-sales\/orders"/);
  assert.match(sheet, /customerId: selectedCustomer\.coreCustomerId/);
  assert.match(sheet, /customerAddressId: selectedCustomer\.coreCustomerAddressId/);
  assert.match(sheet, /variantId: item\.variantId/);
  assert.match(sheet, /quantity: String\(item\.quantity\)/);
  assert.doesNotMatch(sheet, /"\/api\/backend\/orders"/);
  assert.doesNotMatch(sheet, /unitPrice|customerMode|manualCustomer|setSales|setStatus/);
});

test("catalog keeps the established grouped distributor UX and tap-to-adjust behavior", () => {
  assert.match(sheet, /function groupCatalog\(products: ProductCatalogItem\[\]\)/);
  assert.match(sheet, /productGroups\.map\(\(group\)/);
  assert.match(sheet, /group\.variants\.map\(\(product\)/);
  assert.match(sheet, /toggleCatalogProduct\(product\)/);
  assert.match(sheet, /decreaseProduct\(product\.variantId\)/);
  assert.match(sheet, /addProduct\(item\)/);
  assert.match(sheetStyles, /\.variantGrid \{[\s\S]*grid-template-columns: repeat\(auto-fit, minmax\(150px, 1fr\)\)/);
  const milkTeaIndex = catalogPriority.indexOf('label: "Nguyên liệu trà sữa"');
  const spicyIndex = catalogPriority.indexOf('label: "Mì cay & đồ ăn"');
  const packagingIndex = catalogPriority.indexOf('label: "Bao bì & dụng cụ"');
  assert.ok(milkTeaIndex > 0 && spicyIndex > milkTeaIndex && packagingIndex > spicyIndex);
});

test("draft close remains guarded and Core price is display-only", () => {
  assert.match(sheet, /function requestClose\(\)/);
  assert.match(sheet, /window\.confirm\("Đơn đang nhập chưa lưu\. Đóng và bỏ nội dung này\?"\)/);
  assert.match(sheet, /onClose=\{requestClose\}/);
  assert.match(sheet, /Giá tham khảo/);
  assert.match(sheet, /Core quyết định/);
  assert.doesNotMatch(sheet, /Đơn giá tạm|Nhập giá/);
});

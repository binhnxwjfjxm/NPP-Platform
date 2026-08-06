import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const page = await readFile(new URL("../src/features/orders/OrdersClientPage.tsx", import.meta.url), "utf8");
const sessionLoader = await readFile(new URL("../src/features/orders/orders-page-session.ts", import.meta.url), "utf8");
const sheet = await readFile(new URL("../src/features/orders/OrderCreateSheet.tsx", import.meta.url), "utf8");
const sheetStyles = await readFile(new URL("../src/features/orders/OrderCreateSheet.module.css", import.meta.url), "utf8");
const catalogPriority = await readFile(new URL("../src/features/orders/order-catalog-priority.ts", import.meta.url), "utf8");
const workspaceStyles = await readFile(new URL("../src/app/order-create-workspace.css", import.meta.url), "utf8");
const bottomSheet = await readFile(new URL("../src/ui/overlay/BottomSheet.tsx", import.meta.url), "utf8");
const proxy = await readFile(new URL("../src/app/api/backend/orders/route.ts", import.meta.url), "utf8");
const serverPage = await readFile(new URL("../src/features/orders/OrdersPage.tsx", import.meta.url), "utf8");
const gateway = await readFile(new URL("../apps/backend/foundation/gateway.js", import.meta.url), "utf8");
const legacyRuntime = await readFile(new URL("../apps/backend/foundation/legacy-runtime.js", import.meta.url), "utf8");

test("orders tab exposes the real create-order entry point with proxied sessions", () => {
  assert.match(page, /createLoading \? "Đang tải phiên\.\.\." : "\+ Tạo đơn"/);
  assert.match(page, /activeView === "orders"/);
  assert.match(page, /<OrderCreateSheet/);
  assert.match(page, /sessions=\{sessions\}/);
  assert.match(page, /loadOrderSessions\(customers\)/);
  assert.match(sessionLoader, /export async function loadOrderSessions\(customers: RouteCustomerItem\[\]\)/);
  assert.match(sessionLoader, /new URLSearchParams\(\{ routeId \}\)/);
  assert.match(sessionLoader, /`\/api\/backend\/mcp-settings\/session-status\?\$\{query\.toString\(\)\}`/);
  assert.match(page, /Form chưa được mở để tránh hiển thị sai khách hoặc trộn khách giữa các tuyến/);
  assert.match(serverPage, /api\.getRouteCustomersData\(\)/);
  assert.doesNotMatch(serverPage, /session-status|loadMcpSessions|supabase/i);
});

test("customer step is session-first, single-select and keeps manual customer entry", () => {
  assert.match(sheet, /type CustomerMode = "existing" \| "manual"/);
  assert.match(sheet, /sessions: OrderSessionOption\[\]/);
  assert.match(sheet, /selectedSessionId/);
  assert.match(sheet, /activeCustomers\.filter\(\(customer\) => customer\.routeId === selectedSession\.routeId\)/);
  assert.match(sheet, />Khách trong phiên</);
  assert.match(sheet, /Chọn phiên → chọn khách/);
  assert.match(sheet, /role="radiogroup"/);
  assert.match(sheet, /role="radio"/);
  assert.match(sheet, />Khách nhập tay</);
  assert.match(sheet, /routeCustomerId: customerMode === "existing"/);
  assert.match(sheet, /customer: customerMode === "manual"/);
});

test("create-order workspace is fullscreen without the legacy drag handle", () => {
  assert.match(sheet, /variant="workspace"/);
  assert.match(bottomSheet, /variant\?: "default" \| "compact" \| "workspace"/);
  assert.match(bottomSheet, /width: "100vw"/);
  assert.match(bottomSheet, /height: "100dvh"/);
  assert.match(bottomSheet, /variant === "workspace" \? null : <div className="sheet-handle"/);
  assert.match(workspaceStyles, /\.bottom-sheet-workspace\s*\{[\s\S]*height: 100% !important/);
});

test("mobile order flow exposes guarded customer, catalog and cart panels", () => {
  assert.match(sheet, /type MobilePanel = "customer" \| "catalog" \| "cart"/);
  assert.match(sheet, /data-mobile-panel=\{mobilePanel\}/);
  assert.match(sheet, />1\. Khách</);
  assert.match(sheet, />2\. Sản phẩm</);
  assert.match(sheet, />3\. Đơn</);
  assert.match(sheet, /disabled=\{!customerReady \|\| saving\}/);
  assert.match(sheet, /disabled=\{!customerReady \|\| items\.length === 0 \|\| saving\}/);
  assert.match(sheetStyles, /workspace\[data-mobile-panel="customer"\] \.catalogSection/);
});

test("catalog groups variants and follows distributor priority", () => {
  assert.match(sheet, /function groupCatalog\(products: ProductCatalogItem\[\]\)/);
  assert.match(sheet, /productGroups\.map\(\(group\)/);
  assert.match(sheet, /group\.variants\.map\(\(product\)/);
  assert.match(sheetStyles, /\.variantGrid \{[\s\S]*grid-template-columns: repeat\(auto-fit, minmax\(150px, 1fr\)\)/);
  const milkTeaIndex = catalogPriority.indexOf('label: "Nguyên liệu trà sữa"');
  const spicyIndex = catalogPriority.indexOf('label: "Mì cay & đồ ăn"');
  const packagingIndex = catalogPriority.indexOf('label: "Bao bì & dụng cụ"');
  assert.ok(milkTeaIndex > 0 && spicyIndex > milkTeaIndex && packagingIndex > spicyIndex);
  assert.match(sheet, /\.sort\(compareCatalogProducts\)/);
});

test("variant selection is add-only and visibly confirmed", () => {
  assert.match(sheet, /onClick=\{\(\) => addProduct\(product\)\}/);
  assert.match(sheet, /setAddedNotice\(`/);
  assert.match(sheet, /aria-live="assertive"/);
  assert.match(sheetStyles, /\.variantButton \{[\s\S]*min-height: 64px/);
});

test("primary create action requires a separate cart review gesture", () => {
  assert.match(sheet, /function runPrimaryAction\(\)/);
  assert.match(sheet, /if \(mobilePanel !== "cart"\) \{[\s\S]*setMobilePanel\("cart"\);[\s\S]*return;/);
  assert.doesNotMatch(sheet, /setMobilePanel\("cart"\);\s*void submit\(\);/);
  assert.match(sheet, /submitInFlightRef\.current/);
});

test("cart controls keep quantity, price and subtotal ownership", () => {
  assert.match(sheet, /styles\.cartItem/);
  assert.match(sheet, /decreaseProduct\(item\.variantId\)/);
  assert.match(sheet, /updateItem\(item\.variantId, "unitPrice"/);
  assert.match(sheet, /styles\.lineTotal/);
  assert.match(sheetStyles, /\.itemControls \{[\s\S]*grid-template-columns/);
});

test("unfinished drafts are protected and mobile footer stays visible", () => {
  assert.match(sheet, /function requestClose\(\)/);
  assert.match(sheet, /window\.confirm\("Đơn đang nhập chưa lưu\. Đóng và bỏ nội dung này\?"\)/);
  assert.match(sheet, /onClose=\{requestClose\}/);
  assert.match(sheetStyles, /\.primaryAction \{[\s\S]*grid-column: 2/);
});

test("create-order caller uses persisted idempotency through backend proxy", () => {
  assert.match(sheet, /idempotentMutationFetch\(/);
  assert.match(sheet, /"\/api\/backend\/orders"/);
  assert.match(sheet, /operation: "order\.create"/);
  assert.doesNotMatch(sheet, /supabase|service_role/i);
  assert.match(proxy, /proxyBackendRequest\(request, "\/api\/orders", "POST"\)/);
});

test("Foundation Gateway keeps standalone order ownership before fallback", () => {
  assert.doesNotMatch(gateway, /import \{ handleOrderApi \} from "\.\/order-api\.js"/);
  assert.match(legacyRuntime, /import \{ handleOrderApi \} from "\.\/order-api\.js"/);
  const ownerIndex = gateway.indexOf("await legacyHandlers.handleOrderApi(req, url, context, config)");
  const transitionalIndex = gateway.indexOf("await legacyHandlers.handleTransitionalApi(req, url, context, config)");
  const legacyIndex = gateway.indexOf("if (legacyHandlers.proxyToLegacy)");
  assert.ok(ownerIndex > 0 && transitionalIndex > ownerIndex && legacyIndex > transitionalIndex);
});

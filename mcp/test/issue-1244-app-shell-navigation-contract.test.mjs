import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const navigation = await readFile("src/ui/shell/navigation.ts", "utf8");
const shell = await readFile("src/ui/shell/AppShell.tsx", "utf8");
const shellStyles = await readFile("src/ui/shell/AppShell.module.css", "utf8");
const dock = await readFile("src/ui/foundation/McpBottomNav.tsx", "utf8");
const menu = await readFile("src/ui/shell/MobileAppMenu.tsx", "utf8");
const menuStyles = await readFile("src/ui/shell/MobileAppMenu.module.css", "utf8");
const more = await readFile("src/features/more/MorePage.tsx", "utf8");

test("Issue #1244 Lô 2 locks the exact five primary destinations", () => {
  const primary = navigation.match(/export const PRIMARY_NAV_ITEMS:[\s\S]*?=\s*\[([\s\S]*?)\];/)?.[1] || "";
  assert.match(primary, /TODAY_NAV_ITEM,[\s\S]*VISITS_NAV_ITEM,[\s\S]*CUSTOMERS_NAV_ITEM,[\s\S]*ORDERS_NAV_ITEM,[\s\S]*MORE_NAV_ITEM/);
  for (const label of ["Hôm nay", "Đi tuyến", "Điểm bán", "Đơn hàng", "Thêm"]) {
    assert.match(navigation, new RegExp(`label:\\s*"${label}"`));
  }
  assert.doesNotMatch(primary, /REPORTS_NAV_ITEM|ROUTES_NAV_ITEM|PLANS_NAV_ITEM/);
});

test("secondary capabilities are centralized under Thêm without losing routes", () => {
  for (const label of [
    "Tuyến cố định",
    "Lịch sử phiên",
    "Báo cáo",
    "Kết quả thử sản phẩm",
    "Xuất dữ liệu",
    "Thiết lập báo cáo thị trường",
    "Kế hoạch & Công việc",
    "Đề xuất",
    "Mở hoặc liên kết mã khách",
    "Thiết lập"
  ]) assert.match(navigation, new RegExp(label));

  assert.match(more, /MORE_MENU_GROUPS/);
  assert.match(more, /McpLogoutButton/);
  assert.match(navigation, /mcp\.report-setting\.write/);
});

test("AppShell is owned by module CSS and no longer exposes legacy shell hooks", () => {
  assert.match(shell, /AppShell\.module\.css/);
  assert.match(shell, /data-mcp-app-shell="true"/);
  assert.match(shell, /data-mcp-scroll-region="true"/);
  assert.match(shell, /data-mcp-bottom-navigation="true"/);
  assert.match(shell, /McpBottomNav/);
  assert.doesNotMatch(shell, /className="app-shell"/);
  assert.doesNotMatch(shell, /data-bottom-navigation="true"/);
  assert.doesNotMatch(shell, /data-app-scroll-region/);
  assert.doesNotMatch(shellStyles, /:global\(|!important/);
});

test("five-tab dock preserves the visit-flow document escape contract", () => {
  assert.match(dock, /usePathname/);
  assert.match(dock, /function isVisitFlow/);
  assert.match(dock, /data-document-navigation="true"/);
  assert.match(dock, /data-client-navigation="true"/);
  assert.match(dock, /prefetch=\{false\}/);
});

test("top menu mirrors only the five primary areas and uses the new foundation tokens", () => {
  assert.match(menu, /PRIMARY_NAV_ITEMS\.map/);
  assert.match(menu, /data-mcp-app-top-bar="true"/);
  assert.match(menu, /data-mcp-app-menu-panel="true"/);
  assert.doesNotMatch(menu, /APP_MENU_GROUPS|Cài đặt ứng dụng/);
  assert.match(menuStyles, /var\(--mcp-color-primary\)/);
  assert.match(menuStyles, /var\(--mcp-color-surface\)/);
  assert.doesNotMatch(menuStyles, /--npp-|#754706|#98600f|!important|:global\(/i);
});


test("legacy child-screen CSS uses the new shell scope without reactivating retired chrome", async () => {
  const childStyleFiles = [
    "src/app/npp-theme.css",
    "src/app/mcp-compact-ui.css",
    "src/app/mcp-lot-3-flows.css",
    "src/app/export-menu-fix.css",
    "src/app/mobile-home-dashboard.css",
    "src/app/mobile-list-summaries.css",
    "src/app/mcp-mobile-support-flows.css",
    "src/app/mcp-mobile-primary-flows.css",
    "src/app/mcp-sessions-owner-polish.css"
  ];
  for (const path of childStyleFiles) {
    const css = await readFile(path, "utf8");
    assert.doesNotMatch(css, /\.app-shell(?:\.app-shell)?(?:\[data-active-href|:is\()/, `${path} must not depend on retired app-shell screen scope`);
    assert.doesNotMatch(css, /\[data-app-scroll-region\]/, `${path} must use the new scroll-region hook`);
  }

  const retiredChromeFiles = [
    "src/app/globals.css",
    "src/app/mobile.css",
    "src/app/app-shell-contract.css",
    "src/app/mobile-app-geometry.css",
    "src/app/hung-phat-mobile-foundation.css"
  ];
  for (const path of retiredChromeFiles) {
    const css = await readFile(path, "utf8");
    assert.doesNotMatch(css, /data-mcp-app-shell|data-mcp-bottom-navigation|data-mcp-app-top-bar/, `${path} must remain disconnected from the new chrome`);
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appShell = await readFile("src/ui/shell/AppShell.tsx", "utf8");
const mobileMenu = await readFile("src/ui/shell/MobileAppMenu.tsx", "utf8");
const menuCss = await readFile("src/ui/shell/MobileAppMenu.module.css", "utf8");
const navigation = await readFile("src/ui/shell/navigation.ts", "utf8");
const routeExport = await readFile("src/features/mcp/RouteCustomerExportMenu.tsx", "utf8");

test("AppShell owns one top bar, one scroll region and one five-item bottom row", () => {
  assert.match(appShell, /<AppTopBar activeHref=\{activeHref\}/);
  assert.match(appShell, /data-mcp-app-shell="true"/);
  assert.match(appShell, /data-mcp-scroll-region="true"/);
  assert.match(appShell, /data-mcp-bottom-navigation="true"/);
  assert.match(appShell, /PRIMARY_NAV_ITEMS\.length/);
  assert.match(routeExport, /\[data-app-top-bar-tools\]/);
});

test("expanded menu keeps contextual actions first and primary navigation second", () => {
  assert.ok(mobileMenu.indexOf("contextualItems.length") < mobileMenu.indexOf("PRIMARY_NAV_ITEMS.map"));
  assert.match(mobileMenu, /Tác vụ màn hình/);
  assert.match(mobileMenu, /Điều hướng/);
  for (const label of ["Hôm nay", "Đi tuyến", "Điểm bán", "Đơn hàng", "Thêm"]) {
    assert.match(navigation, new RegExp(label));
  }
});

test("top menu is a blue/white office surface, not the retired warm shell", () => {
  assert.match(menuCss, /background:\s*rgba\(255, 255, 255, 0\.96\)/);
  assert.match(menuCss, /var\(--mcp-color-primary\)/);
  assert.match(menuCss, /var\(--mcp-color-primary-soft\)/);
  assert.doesNotMatch(menuCss, /#754706|#98600f|brown|champagne|!important/i);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appShell = await readFile("src/ui/shell/AppShell.tsx", "utf8");
const mobileMenu = await readFile("src/ui/shell/MobileAppMenu.tsx", "utf8");
const menuCss = await readFile("src/ui/shell/MobileAppMenu.module.css", "utf8");
const navigation = await readFile("src/ui/shell/navigation.ts", "utf8");
const theme = await readFile("src/app/npp-theme.css", "utf8");
const routeExport = await readFile("src/features/mcp/RouteCustomerExportMenu.tsx", "utf8");

test("AppShell owns one sticky top bar and exposes semantic screen sections", () => {
  assert.match(appShell, /<AppTopBar activeHref=\{activeHref\}/);
  assert.match(appShell, /data-shell-section=\{section\}/);
  assert.match(appShell, /className="app-content-shell"/);
  assert.match(navigation, /"overview" \| "routes" \| "session" \| "business"/);
  assert.match(appShell, /<AppTopBar activeHref=\{activeHref\} \/>/);
  assert.doesNotMatch(menuCss, /\.trigger \{[^}]*position: fixed;/);
  assert.match(mobileMenu, /data-app-top-bar-tools/);
  assert.match(routeExport, /createPortal\(/);
  assert.match(routeExport, /\[data-app-top-bar-tools\]/);
  assert.doesNotMatch(routeExport, /<div className="card"/);
});

test("expanded menu contains operational navigation and keeps contextual actions first", () => {
  for (const label of [
    "Vận hành hôm nay",
    "Quản lý MCP",
    "Thiết lập nghiệp vụ",
    "Tác vụ màn hình",
    "Cài đặt ứng dụng"
  ]) assert.match(`${navigation}\n${mobileMenu}`, new RegExp(label));

  for (const href of ["/", "/routes", "/visits", "/mcp/sessions", "/customers", "/orders", "/reports", "/plans", "/mcp-setting"]) {
    assert.match(navigation, new RegExp(href.replaceAll("/", "\\/")));
  }

  assert.ok(mobileMenu.indexOf("contextualItems.length") < mobileMenu.indexOf("APP_MENU_GROUPS.map"));
});

test("theme ownership follows overview then routes then session then business forms", () => {
  const overview = theme.indexOf("1. Tổng quan");
  const routes = theme.indexOf("2. Tuyến");
  const session = theme.indexOf("3. Phiên");
  const forms = theme.indexOf("4. Form nghiệp vụ");
  assert.ok(overview >= 0 && overview < routes && routes < session && session < forms);

  assert.match(theme, /data-shell-section="overview"/);
  assert.match(theme, /data-shell-section="routes"/);
  assert.match(theme, /data-shell-section="session"/);
  assert.match(theme, /\.bottom-sheet \.form-field input/);
  assert.match(theme, /\.bottom-sheet \.report-chip\.selected/);
  assert.match(theme, /--npp-color-header: #5a3a24/);
  assert.match(theme, /--npp-color-primary: #4f7a3a/);
  assert.match(theme, /--npp-color-accent: #c89b5b/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appShell = await readFile("src/ui/shell/AppShell.tsx", "utf8");
const shellCss = await readFile("src/app/app-shell-contract.css", "utf8");
const layout = await readFile("src/app/layout.tsx", "utf8");
const manifest = await readFile("src/app/manifest.ts", "utf8");
const mobileMenu = await readFile("src/ui/shell/MobileAppMenu.tsx", "utf8");
const mobileMenuCss = await readFile("src/ui/shell/MobileAppMenu.module.css", "utf8");
const sessionView = await readFile("src/features/mcp/McpSessionCompactViewFinal2.tsx", "utf8");
const settingsRoute = await readFile("src/app/mcp-setting/page.tsx", "utf8");
const settingsPage = await readFile("src/features/mcp-settings/McpReportSettingsPage.tsx", "utf8");
const settingsCss = await readFile("src/features/mcp-settings/McpReportSettingsPage.module.css", "utf8");
const settingsBrowserSmoke = await readFile("test/ui/mcp-settings-dialog-browser-smoke.mjs", "utf8");
const browserSmoke = await readFile("test/ui/app-shell-browser-acceptance-smoke.mjs", "utf8");
const actionSmoke = await readFile("test/ui/mcp-session-actions-browser-smoke.mjs", "utf8");
const actionMock = await readFile("test/ui/mcp-session-actions-mock-backend.mjs", "utf8");
const workflow = await readFile(".github/workflows/f05-ui-browser-smoke.yml", "utf8");

test("AppShell owns one menu trigger, one scroll region and at most five bottom shortcuts", () => {
  assert.match(appShell, /const BOTTOM_NAV_LIMIT = 5/);
  assert.match(appShell, /PRIMARY_NAV_ITEMS\.slice\(0, BOTTOM_NAV_LIMIT\)/);
  assert.match(appShell, /data-bottom-navigation/);
  assert.match(appShell, /data-navigation-item-count/);
  assert.match(appShell, /data-app-scroll-region/);
  assert.match(appShell, /<AppTopBar activeHref=\{activeHref\} \/>/);
  assert.match(appShell, /<main[\s\S]*?<NavLinks activeHref=\{activeHref\} items=\{BOTTOM_NAV_ITEMS\} mode="bottom" \/>[\s\S]*?<\/div>/);
});

test("AppShell owns an exact 58px bottom row independent from browser chrome and safe-area changes", () => {
  assert.match(layout, /import "\.\/app-shell-contract\.css"/);
  assert.doesNotMatch(layout, /mobile-nav-tune\.css/);
  assert.doesNotMatch(layout, /safe-area\.css/);
  assert.match(layout, /statusBarStyle: "default"/);
  assert.match(layout, /viewportFit: "auto"/);
  assert.doesNotMatch(layout, /viewportFit: "cover"/);
  assert.match(layout, /themeColor: "#F7F3ED"/);
  assert.match(manifest, /background_color: "#F7F3ED"/);
  assert.match(manifest, /theme_color: "#F7F3ED"/);
  assert.match(shellCss, /grid-template-rows: auto minmax\(0, 1fr\) auto/);
  assert.match(shellCss, /grid-template-rows: auto minmax\(0, 1fr\) var\(--app-bottom-nav-bar-height\)/);
  assert.match(shellCss, /\[data-app-scroll-region\] \{[\s\S]*?overflow-y: auto/);
  assert.match(shellCss, /\[data-app-top-bar\] \{[\s\S]*?position: sticky/);
  assert.match(shellCss, /--app-bottom-nav-bar-height: 58px/);
  assert.match(shellCss, /--app-bottom-nav-link-height: 50px/);
  assert.match(shellCss, /\.app-content-shell > \[data-bottom-navigation="true"\] \{[\s\S]*?position: relative/);
  assert.match(shellCss, /height: var\(--app-bottom-nav-bar-height\)/);
  assert.match(shellCss, /min-height: var\(--app-bottom-nav-bar-height\)/);
  assert.match(shellCss, /max-height: var\(--app-bottom-nav-bar-height\)/);
  assert.match(shellCss, /margin: 0/);
  assert.match(shellCss, /border-radius: 0/);
  assert.match(shellCss, /border-top: 1px solid/);
  assert.match(shellCss, /background: var\(--npp-color-surface\)/);
  assert.match(shellCss, /padding: 4px 8px/);
  assert.match(shellCss, /\.bottom-nav-link \.nav-icon \{[\s\S]*?width: 26px;[\s\S]*?height: 26px;/);
  assert.doesNotMatch(shellCss, /safe-area-inset-bottom/);
  assert.match(shellCss, /\.bottom-nav-link\.active \{[\s\S]*?background: rgba\(79, 122, 58, 0\.10\)/);
  assert.match(shellCss, /\.bottom-nav-link\.active \.nav-icon \{[\s\S]*?background: rgba\(79, 122, 58, 0\.14\)/);
  assert.doesNotMatch(shellCss, /\.bottom-nav-link\.active \{[\s\S]*?linear-gradient/);
  assert.doesNotMatch(shellCss, /\[data-bottom-navigation="true"\] \{[\s\S]*?position: fixed/);
});

test("MCP settings use compact filters, popup creation and two-row item cards", () => {
  assert.match(settingsRoute, /McpReportSettingsPage/);
  assert.doesNotMatch(settingsRoute, /McpReportSettingsPageInternal/);
  assert.match(settingsPage, /McpReportSettingsPage\.module\.css/);
  assert.match(settingsPage, /function openCreator\(\)/);
  assert.match(settingsPage, /aria-haspopup="dialog"/);
  assert.match(settingsPage, /dialogMode === "create" \? "Thêm mẫu" : "Sửa lựa chọn"/);
  assert.match(settingsPage, /function openEditor\(item: SettingItem\)/);
  assert.match(settingsPage, /setEditingItem\(item\)/);
  assert.match(settingsPage, /role="dialog"/);
  assert.match(settingsPage, /aria-modal="true"/);
  assert.match(settingsPage, /autoFocus/);
  assert.match(settingsPage, /function saveEditedItem\(\)/);
  assert.match(settingsPage, /method: "PATCH"/);
  assert.match(settingsPage, /itemId: editingItem\.id/);
  assert.match(settingsPage, /onClick=\{\(\) => openEditor\(item\)\}/);
  assert.match(settingsPage, /aria-label="Sửa"/);
  assert.match(settingsCss, /\.filterRail \{[\s\S]*?overflow-x: auto/);
  assert.match(settingsCss, /\.itemCard \{[\s\S]*?grid-template-rows: auto auto/);
  assert.match(settingsCss, /\.itemActions \{[\s\S]*?grid-row: 1 \/ span 2/);
  assert.match(settingsCss, /\.actionButton \{[\s\S]*?width: 38px;[\s\S]*?height: 38px/);
  assert.match(settingsCss, /place-items: center/);
  assert.match(settingsCss, /width: min\(460px, 100%\)/);
  assert.match(settingsCss, /max-height: min\(82dvh, 680px\)/);
  assert.match(settingsBrowserSmoke, /opening create dialog must preserve the current MCP settings scroll position/);
  assert.match(settingsBrowserSmoke, /create dialog must issue exactly one POST mutation/);
  assert.match(settingsBrowserSmoke, /opening edit dialog must preserve the current MCP settings scroll position/);
  assert.match(settingsBrowserSmoke, /edit dialog must issue exactly one PATCH mutation/);
  assert.match(settingsBrowserSmoke, /PATCH mutation must include a stable idempotency key/);
  assert.match(workflow, /mcp-settings-dialog-browser-smoke\.mjs/);
});

test("expanded app menu drops from the top in the brown and white design system", () => {
  assert.doesNotMatch(mobileMenu, /BottomSheet/);
  assert.match(mobileMenu, /function TopMenuPanel/);
  assert.match(mobileMenu, /data-app-menu-panel="true"/);
  assert.match(mobileMenu, /aria-expanded=\{context\.menuOpen\}/);
  assert.match(mobileMenuCss, /\.menuPanel \{[\s\S]*?var\(--npp-color-header-strong\)[\s\S]*?var\(--npp-color-header\)/);
  assert.match(mobileMenuCss, /color: #ffffff/);
  assert.match(mobileMenuCss, /animation: menuDropIn/);
  assert.match(mobileMenuCss, /@keyframes menuDropIn[\s\S]*?translateY\(-100%\)[\s\S]*?translateY\(0\)/);
});

test("browser gate locks mobile and desktop layout, contrast, pressed, loading and error states", () => {
  for (const phrase of [
    "exactly one menu trigger",
    "bottom navigation must contain at most five items",
    "bottom nav visual height must stay at 58px",
    "bottom nav must attach directly to the viewport bottom edge",
    "bottom nav shell must not render as a rounded floating card",
    "bottom nav must not have floating outer margins",
    "active bottom item must not use the old gradient pill",
    "bottom nav height must stay constant when mobile browser chrome changes viewport height",
    "top bar must remain fixed while main scrolls",
    "desktop top bar must remain sticky at viewport top",
    "must not overlap",
    "top menu text must be white",
    "top menu must use the brown gradient theme",
    "contrast",
    "pressed state must provide visible transform feedback"
  ]) assert.match(browserSmoke, new RegExp(phrase));

  assert.match(actionMock, /productDelayMs/);
  assert.match(actionMock, /productError/);
  assert.match(actionSmoke, /loading control must be disabled while request is pending/);
  assert.match(actionSmoke, /error state must not use muted text styling/);
  assert.match(workflow, /app-shell-browser-acceptance-smoke\.mjs/);
});

test("canonical API errors render their message instead of object coercion", () => {
  assert.match(sessionView, /function apiErrorMessage\(payload: unknown, fallback: string\)/);
  assert.match(sessionView, /typeof value\.error === "object" && value\.error\.message\?\.trim\(\)/);
  assert.match(sessionView, /apiErrorMessage\(payload, "Không tìm được sản phẩm"\)/);
  assert.match(sessionView, /apiErrorMessage\(payload, "Không tải được quy cách sản phẩm"\)/);
  assert.doesNotMatch(sessionView, /new Error\(err\.error \|\| err\.detail/);
});

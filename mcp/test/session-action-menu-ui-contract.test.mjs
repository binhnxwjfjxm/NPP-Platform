import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appShell = await readFile("src/ui/shell/AppShell.tsx", "utf8");
const appMenu = await readFile("src/ui/shell/MobileAppMenu.tsx", "utf8");
const appMenuStyles = await readFile("src/ui/shell/MobileAppMenu.module.css", "utf8");
const owner = await readFile("src/features/mcp/VisitsSessionReportPanel.tsx", "utf8");
const wrapper = await readFile("src/features/mcp/McpSessionCompactView.tsx", "utf8");

assert.match(appShell, /MobileAppMenuProvider/, "AppShell must own one shared mobile menu provider");
assert.doesNotMatch(appShell, /SettingsQuickButton/, "standalone settings trigger must not return");
assert.match(appMenu, /aria-label="Mở menu ứng dụng"/, "mobile app must expose exactly one menu trigger");
assert.equal((appMenu.match(/aria-label="Mở menu ứng dụng"/g) || []).length, 1, "there must be one mobile menu trigger");
assert.match(appMenu, /Cài đặt ứng dụng/, "settings must live inside the shared menu");
assert.match(appMenu, /MobileAppMenuContext/, "screen actions must register into the shared menu instead of adding buttons");
assert.match(appMenu, /if \(parent\) return/, "nested app shells must reuse the existing provider instead of rendering another trigger");

assert.match(wrapper, /<MobileAppMenuProvider>[\s\S]*<VisitsSessionReportPanel/, "session action owner must be inside the provider boundary");
assert.match(owner, /useRegisterMobileAppMenu/, "session screen must register contextual actions");
assert.match(owner, /Xem báo cáo phiên/, "report action must live in the shared menu");
assert.match(owner, /Xuất dữ liệu/, "export action must live in the shared menu");
assert.match(owner, /Chốt phiên/, "close action must live in the shared menu");
assert.match(owner, /tone:\s*"danger"/, "close session must remain destructive");
assert.doesNotMatch(owner, /PageHeaderActionsPortal/, "session screen must not add a second header menu button");
assert.doesNotMatch(owner, /Mở menu tác vụ phiên/, "legacy session menu trigger must be removed");
assert.doesNotMatch(wrapper, /VisitsExportMenu/, "legacy inline export trigger must remain removed");

assert.match(owner, /idempotentMutationFetch/, "close session must use the canonical idempotent mutation caller");
assert.match(owner, /operation:\s*"route-session\.update"/, "close session must use the exact route-session.update operation");
assert.doesNotMatch(owner, /await fetch\(`\/api\/backend\/mcp-session-actions\//, "close session must not bypass idempotency with raw fetch");
assert.match(owner, /closeInFlight\.current/, "close session must reject duplicate in-flight clicks before React rerenders");
assert.match(owner, /response\.blob\(\)/, "session export must own the response body instead of relying on PWA navigation");
assert.match(owner, /URL\.createObjectURL\(blob\)/, "session export must create a browser-downloadable object URL");
assert.match(owner, /anchor\.download\s*=/, "session export must preserve the server filename through a download anchor");
assert.match(owner, /data-export-kind="pdf"/, "PDF export must be an explicit controlled action");
assert.match(owner, /data-export-kind="excel"/, "Excel export must be an explicit controlled action");
assert.match(owner, /role="alert"/, "export failures must remain visible in the export sheet");

assert.match(appMenuStyles, /position:\s*fixed/, "one shared mobile trigger must own the top-right surface");
assert.match(appMenuStyles, /grid-template-columns:\s*42px minmax\(0, 1fr\) auto/, "menu items must keep a scalable icon-copy-chevron layout");

console.log("UNIFIED_MOBILE_APP_MENU_CONTRACT=PASS");

import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

const legacyTheme = await readFile("src/app/npp-theme.css", "utf8");
const foundation = await readFile("src/app/hung-phat-mobile-foundation.css", "utf8");
const experience = await readFile("src/app/mobile-app-experience.css", "utf8");
const geometry = await readFile("src/app/mobile-app-geometry.css", "utf8");
const mobileHome = await readFile("src/app/mobile-home-dashboard.css", "utf8");
const cardDepth = await readFile("src/app/card-depth.css", "utf8");
const metalActions = await readFile("src/app/satin-metal-actions.css", "utf8");
const layout = await readFile("src/app/layout.tsx", "utf8");
const shell = await readFile("src/ui/shell/AppShell.tsx", "utf8");
const dock = await readFile("src/ui/shell/MobileDock.tsx", "utf8");
const launchpad = await readFile("src/ui/shell/MobileHomeLaunchpad.tsx", "utf8");
const navigation = await readFile("src/ui/shell/navigation.ts", "utf8");
const marketChecks = await readFile("src/features/market-checks/MarketChecksClientPage.tsx", "utf8");

const tokens = {
  "--npp-color-canvas": "#f7f5f1",
  "--npp-color-surface": "#ffffff",
  "--npp-color-header": "#5a3b20",
  "--npp-color-primary": "#98600f",
  "--npp-color-primary-strong": "#754706",
  "--npp-color-text": "#2d2924",
  "--npp-color-border": "#d8d0c4"
};

test("warm-gold MCP palette is owned by the final semantic token layer", () => {
  assert.match(legacyTheme, /--npp-color-canvas:/);
  for (const [name, value] of Object.entries(tokens)) {
    assert.match(foundation, new RegExp(`${name}:\\s*${value}`, "i"));
  }
  for (const alias of ["--bg", "--panel", "--panel-soft", "--text", "--muted", "--line", "--brand", "--brand-strong", "--brand-soft", "--accent"]) {
    assert.match(foundation, new RegExp(`${alias}:\\s*var\\(--npp-`));
  }
});

test("mobile application experience loads after legacy shell and theme layers", () => {
  const legacyIndex = layout.indexOf('import "./npp-theme.css";');
  const shellContractIndex = layout.indexOf('import "./app-shell-contract.css";');
  const foundationIndex = layout.indexOf('import "./hung-phat-mobile-foundation.css";');
  const experienceIndex = layout.indexOf('import "./mobile-app-experience.css";');
  const geometryIndex = layout.indexOf('import "./mobile-app-geometry.css";');
  const homeIndex = layout.indexOf('import "./mobile-home-dashboard.css";');
  const lotThreeIndex = layout.indexOf('import "./mcp-lot-3-flows.css";');
  const cardDepthIndex = layout.indexOf('import "./card-depth.css";');
  const metalActionsIndex = layout.indexOf('import "./satin-metal-actions.css";');
  assert.ok(legacyIndex >= 0, "legacy theme import must exist");
  assert.ok(shellContractIndex >= 0, "app shell contract import must exist");
  assert.ok(foundationIndex > legacyIndex, "foundation must follow legacy theme");
  assert.ok(foundationIndex > shellContractIndex, "foundation must follow shell contract");
  assert.ok(experienceIndex > foundationIndex, "application experience must follow the theme foundation");
  assert.ok(geometryIndex > experienceIndex, "stable dock geometry must follow application experience");
  assert.ok(homeIndex > geometryIndex, "route-specific home layout must load after shared mobile layers");
  assert.ok(cardDepthIndex > lotThreeIndex, "card depth must follow route-specific visual layers");
  assert.ok(metalActionsIndex > cardDepthIndex, "satin metal actions must be the final visual action layer");
  assert.match(layout, /viewportFit:\s*"cover"/);
  assert.match(layout, /themeColor:\s*"#754706"/);
});

test("MCP content cards use shadow depth instead of visible outlines", () => {
  assert.match(cardDepth, /--npp-shadow-card:[\s\S]*?0 2px 6px[\s\S]*?0 12px 28px/);
  assert.match(cardDepth, /--npp-shadow-raised:[\s\S]*?0 18px 40px/);
  assert.match(cardDepth, /\[class\*="_card__"\]/);
  assert.match(cardDepth, /\[class\*="_setupCard__"\]/);
  assert.match(cardDepth, /\[class\*="_mobileActionList__"\]/);
  assert.match(cardDepth, /border:\s*0\s*!important/);
  assert.match(cardDepth, /box-shadow:\s*var\(--npp-shadow-card\)\s*!important/);
  assert.match(cardDepth, /@media \(hover: hover\) and \(pointer: fine\)[\s\S]*?transform:\s*none\s*!important/);
  assert.doesNotMatch(cardDepth, /\.filter-bar[\s\S]*?border:\s*0\s*!important/);
  assert.doesNotMatch(cardDepth, /(?:input|select|textarea|\.button)[\s\S]*?border:\s*0\s*!important/);
});

test("MCP action controls use restrained satin champagne metal without metalizing content cards", () => {
  assert.match(metalActions, /--mcp-metal-champagne-surface:/);
  assert.match(metalActions, /--mcp-metal-bronze-surface:/);
  assert.match(metalActions, /--mcp-metal-danger-surface:/);
  assert.match(metalActions, /--mcp-metal-brush:/);
  assert.match(metalActions, /--mcp-metal-bronze-lightest:\s*#dfc18c/i);
  assert.match(metalActions, /--mcp-metal-bronze-hover-lightest:\s*#e5cb9d/i);
  assert.match(metalActions, /repeating-linear-gradient\(\s*0deg/);
  assert.match(metalActions, /\.button:not\(\.primary\):not\(\.danger\)/);
  assert.match(metalActions, /\.button\.primary/);
  assert.match(metalActions, /\.button\.danger/);
  assert.match(metalActions, /\.mobile-home-primary-action/);
  assert.match(metalActions, /\.mobile-home-quick-grid a/);
  assert.match(metalActions, /data-bottom-navigation="true"[\s\S]*?\.bottom-nav-link/);
  assert.match(metalActions, /\[data-app-top-bar\] button/);
  assert.match(metalActions, /\.mcp-status-chips button/);
  assert.match(metalActions, /\.report-chip/);
  assert.match(metalActions, /\.mcp-add-customer-fab/);
  assert.match(metalActions, /\.dashboard-alert-card > strong/);
  assert.match(metalActions, /\.button\.primary[\s\S]*?color:\s*var\(--mcp-metal-ink\)\s*!important/);
  assert.match(metalActions, /\[class\*="_customerList__"\] button[\s\S]*?text-shadow:\s*none/);
  assert.match(metalActions, /\[class\*="_variantButton__"\][\s\S]*?text-shadow:\s*none/);
  assert.match(metalActions, /color:\s*currentcolor\s*!important/);
  assert.doesNotMatch(metalActions, /currentColor/);
  assert.doesNotMatch(metalActions, /(?:^|,|\n)\s*\.card\s*(?:,|\{)/m);
  assert.doesNotMatch(metalActions, /(?:^|,|\n)\s*\.dashboard-(?:alert|command|route)-card\s*(?:,|\{)/m);
});

test("final satin layer normalizes all five dock tiles to one baseline", () => {
  assert.match(metalActions, /\.bottom-nav-link\s*\{[\s\S]*?min-height:\s*54px;[\s\S]*?transform:\s*none\s*!important/);
  assert.match(metalActions, /\.bottom-nav-link\.primary,[\s\S]*?\.bottom-nav-link\.primary\.active\s*\{[\s\S]*?transform:\s*none\s*!important/);
  assert.match(metalActions, /\.bottom-nav-link\.primary \.mobile-app-dock-icon\s*\{[\s\S]*?width:\s*30px\s*!important;[\s\S]*?height:\s*25px\s*!important;[\s\S]*?border:\s*0\s*!important;[\s\S]*?background:\s*transparent\s*!important;[\s\S]*?box-shadow:\s*none\s*!important/);
  assert.match(metalActions, /\.bottom-nav-link\.primary \.mobile-app-dock-label\s*\{[\s\S]*?margin-top:\s*0\s*!important/);
});

test("phone shell has one mobile home launchpad and one scroll region", () => {
  assert.match(shell, /data-bottom-navigation/);
  assert.match(shell, /BOTTOM_NAV_LIMIT = 5/);
  assert.match(shell, /MobileHomeLaunchpad/);
  assert.match(shell, /activeHref === "\/" \? <MobileHomeLaunchpad \/> : null/);
  assert.doesNotMatch(shell, /MobileContextBar/);
  assert.doesNotMatch(shell, /data-mobile-context-bar/);
  assert.match(shell, /MobileDock/);
  assert.match(navigation, /FIELD_DOCK_ITEMS/);
  assert.match(navigation, /href:\s*"\/visits"/);
  assert.match(dock, /data-primary-action/);
  assert.match(dock, /item\.href === "\/visits"/);
  assert.match(dock, /bottom-nav-link/);
  assert.match(launchpad, /Đi tuyến hôm nay/);
  for (const href of ["/routes", "/mcp/sessions", "/orders", "/reports", "/plans"]) {
    assert.match(launchpad, new RegExp(`href:\\s*"${href.replace("/", "\\/")}"|href=\\\\"${href.replace("/", "\\/")}\\\\"`));
  }
  assert.match(foundation, /\.sidebar\s*\{[\s\S]*?display:\s*none\s*!important/);
  assert.match(geometry, /grid-template-rows:\s*auto minmax\(0, 1fr\) calc\(64px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(geometry, /min-height:\s*54px/);
  assert.match(experience, /\.mobile-app-dock-link\.primary/);
});

test("mobile dock puts daily work in the agreed five-item order", () => {
  const dockItems = navigation.match(/export const FIELD_DOCK_ITEMS:[\s\S]*?=\s*\[([\s\S]*?)\];/)?.[1] || "";
  assert.match(
    dockItems,
    /OVERVIEW_NAV_ITEM,[\s\S]*VISITS_NAV_ITEM,[\s\S]*CUSTOMERS_NAV_ITEM,[\s\S]*ORDERS_NAV_ITEM,[\s\S]*REPORTS_NAV_ITEM/,
    "dock must be Tổng | Đi tuyến | Khách | Đơn | Báo cáo"
  );
  assert.doesNotMatch(dockItems, /ROUTES_NAV_ITEM/, "route management must not occupy the mobile dock");
  assert.match(navigation, /SIDEBAR_NAV_ITEMS:[\s\S]*ROUTES_NAV_ITEM/, "routes must remain in the desktop sidebar");
  assert.match(navigation, /APP_MENU_GROUPS:[\s\S]*ROUTES_NAV_ITEM/, "routes must remain in the expanded app menu");
});

test("mobile home is app-like, compact and keeps the warm brown tone", () => {
  assert.match(mobileHome, /data-active-href="\/"/);
  assert.match(mobileHome, /grid-template-columns:\s*repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(mobileHome, /linear-gradient\(135deg, #5a3b20, #754706 56%, #98600f\)/i);
  assert.match(mobileHome, /\.page-header,[\s\S]*?\.filter-bar,[\s\S]*?\.dashboard-command-grid/);
  assert.match(mobileHome, /\.dashboard-kpi-strip\s*\{[\s\S]*?repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(mobileHome, /dashboard-alert-list > :nth-child\(n \+ 2\)/);
  assert.match(mobileHome, /dashboard-route-list > :nth-child\(n \+ 2\)/);
});

test("mobile dock is attached translucent glass with a warm brown tint", () => {
  assert.match(geometry, /margin:\s*0;/);
  assert.match(geometry, /border-top:\s*1px solid rgba\(117, 71, 6, 0\.18\)/);
  assert.match(geometry, /border-radius:\s*0;/);
  assert.match(geometry, /background:\s*linear-gradient\(/);
  assert.match(geometry, /rgba\(255, 253, 248, 0\.72\)/);
  assert.match(geometry, /rgba\(239, 222, 195, 0\.62\)/);
  assert.match(geometry, /backdrop-filter:\s*blur\(22px\) saturate\(1\.3\)/);
  assert.match(geometry, /background:\s*rgba\(152, 96, 15, 0\.12\)/);
});

test("every top-level MCP page has a canonical navigation entry", async () => {
  const entries = await readdir("src/app", { withFileTypes: true });
  const routes = ["/"];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "api") continue;
    try {
      await readFile(`src/app/${entry.name}/page.tsx`, "utf8");
      routes.push(`/${entry.name}`);
    } catch {
      // Nested-only route groups do not need a top-level navigation entry.
    }
  }

  const registered = new Set(Array.from(navigation.matchAll(/href:\s*"([^"]+)"/g), (match) => match[1]));
  for (const route of routes) {
    assert.ok(registered.has(route), `top-level route ${route} must be registered in navigation.ts`);
  }
});

test("field checks is a first-class menu route but not a bottom-dock item", () => {
  assert.match(navigation, /FIELD_CHECKS_NAV_ITEM/);
  assert.match(navigation, /href:\s*"\/field-checks"/);
  assert.match(navigation, /SIDEBAR_NAV_ITEMS:[\s\S]*FIELD_CHECKS_NAV_ITEM/);
  assert.match(navigation, /APP_MENU_GROUPS:[\s\S]*FIELD_CHECKS_NAV_ITEM/);
  assert.match(marketChecks, /<AppShell activeHref="\/field-checks">/);

  const dockItems = navigation.match(/export const FIELD_DOCK_ITEMS:[\s\S]*?=\s*\[([\s\S]*?)\];/)?.[1] || "";
  assert.doesNotMatch(dockItems, /FIELD_CHECKS_NAV_ITEM/);
});

test("MCP focus ring keeps an opaque light and dark edge above the satin metal shadow", () => {
  assert.match(foundation, /--npp-color-focus-inner:\s*#fffdf8/i);
  assert.match(foundation, /--npp-color-focus-outer:\s*#754706/i);
  assert.match(foundation, /outline:\s*2px solid var\(--npp-color-focus-inner\)/);
  assert.match(foundation, /box-shadow:\s*0 0 0 4px var\(--npp-color-focus-outer\)/);
  assert.match(metalActions, /:focus-visible[\s\S]*?outline:\s*2px solid var\(--npp-color-focus-inner\)\s*!important/);
  assert.match(metalActions, /:focus-visible[\s\S]*?0 0 0 4px var\(--npp-color-focus-outer\)/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

const legacyTheme = await readFile("src/app/npp-theme.css", "utf8");
const foundation = await readFile("src/app/hung-phat-mobile-foundation.css", "utf8");
const experience = await readFile("src/app/mobile-app-experience.css", "utf8");
const geometry = await readFile("src/app/mobile-app-geometry.css", "utf8");
const mobileHome = await readFile("src/app/mobile-home-dashboard.css", "utf8");
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
  assert.ok(legacyIndex >= 0, "legacy theme import must exist");
  assert.ok(shellContractIndex >= 0, "app shell contract import must exist");
  assert.ok(foundationIndex > legacyIndex, "foundation must follow legacy theme");
  assert.ok(foundationIndex > shellContractIndex, "foundation must follow shell contract");
  assert.ok(experienceIndex > foundationIndex, "application experience must follow the theme foundation");
  assert.ok(geometryIndex > experienceIndex, "stable dock geometry must follow application experience");
  assert.ok(homeIndex > geometryIndex, "route-specific home layout must load after shared mobile layers");
  assert.match(layout, /viewportFit:\s*"cover"/);
  assert.match(layout, /themeColor:\s*"#754706"/);
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
    assert.match(launchpad, new RegExp(`href:\s*"${href.replace("/", "\\/")}"|href=\\"${href.replace("/", "\\/")}\\"`));
  }
  assert.match(foundation, /\.sidebar\s*\{[\s\S]*?display:\s*none\s*!important/);
  assert.match(geometry, /grid-template-rows:\s*auto minmax\(0, 1fr\) calc\(64px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(geometry, /min-height:\s*54px/);
  assert.match(experience, /\.mobile-app-dock-link\.primary/);
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

test("MCP focus ring keeps an opaque light and dark edge", () => {
  assert.match(foundation, /--npp-color-focus-inner:\s*#fffdf8/i);
  assert.match(foundation, /--npp-color-focus-outer:\s*#754706/i);
  assert.match(foundation, /outline:\s*2px solid var\(--npp-color-focus-inner\)/);
  assert.match(foundation, /box-shadow:\s*0 0 0 4px var\(--npp-color-focus-outer\)/);
});

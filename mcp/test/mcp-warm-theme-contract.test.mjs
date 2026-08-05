import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const legacyTheme = await readFile("src/app/npp-theme.css", "utf8");
const foundation = await readFile("src/app/hung-phat-mobile-foundation.css", "utf8");
const experience = await readFile("src/app/mobile-app-experience.css", "utf8");
const layout = await readFile("src/app/layout.tsx", "utf8");
const shell = await readFile("src/ui/shell/AppShell.tsx", "utf8");
const dock = await readFile("src/ui/shell/MobileDock.tsx", "utf8");
const launchpad = await readFile("src/ui/shell/MobileHomeLaunchpad.tsx", "utf8");
const navigation = await readFile("src/ui/shell/navigation.ts", "utf8");

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
  assert.ok(legacyIndex >= 0, "legacy theme import must exist");
  assert.ok(shellContractIndex >= 0, "app shell contract import must exist");
  assert.ok(foundationIndex > legacyIndex, "foundation must follow legacy theme");
  assert.ok(foundationIndex > shellContractIndex, "foundation must follow shell contract");
  assert.ok(experienceIndex > foundationIndex, "application experience must be the final mobile layer");
  assert.match(layout, /viewportFit:\s*"cover"/);
  assert.match(layout, /themeColor:\s*"#754706"/);
});

test("phone shell is a field application, not a stacked desktop website", () => {
  assert.match(shell, /data-bottom-navigation/);
  assert.match(shell, /BOTTOM_NAV_LIMIT = 5/);
  assert.match(shell, /MobileHomeLaunchpad/);
  assert.match(shell, /MobileContextBar/);
  assert.match(shell, /MobileDock/);
  assert.match(navigation, /FIELD_DOCK_ITEMS/);
  assert.match(navigation, /href:\s*"\/visits"/);
  assert.match(dock, /data-primary-action/);
  assert.match(dock, /item\.href === "\/visits"/);
  assert.match(launchpad, /Đi tuyến hôm nay/);
  assert.match(launchpad, /href="\/visits"/);
  assert.match(foundation, /\.sidebar\s*\{[\s\S]*?display:\s*none\s*!important/);
  assert.match(experience, /grid-template-rows:\s*auto auto minmax\(0, 1fr\) calc\(76px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(experience, /\.mobile-app-dock-link\.primary/);
  assert.match(experience, /\.mobile-home-primary-action/);
  assert.match(experience, /\.mobile-context-bar/);
});

test("MCP focus ring keeps an opaque light and dark edge", () => {
  assert.match(foundation, /--npp-color-focus-inner:\s*#fffdf8/i);
  assert.match(foundation, /--npp-color-focus-outer:\s*#754706/i);
  assert.match(foundation, /outline:\s*2px solid var\(--npp-color-focus-inner\)/);
  assert.match(foundation, /box-shadow:\s*0 0 0 4px var\(--npp-color-focus-outer\)/);
});

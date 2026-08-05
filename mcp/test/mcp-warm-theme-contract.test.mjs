import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const legacyTheme = await readFile("src/app/npp-theme.css", "utf8");
const foundation = await readFile("src/app/hung-phat-mobile-foundation.css", "utf8");
const layout = await readFile("src/app/layout.tsx", "utf8");
const shell = await readFile("src/ui/shell/AppShell.tsx", "utf8");

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

test("mobile foundation loads last and PWA chrome follows the bronze theme", () => {
  const foundationIndex = layout.indexOf('import "./hung-phat-mobile-foundation.css";');
  const shellContractIndex = layout.indexOf('import "./app-shell-contract.css";');
  assert.ok(foundationIndex > shellContractIndex, "mobile foundation must load after legacy and shell CSS");
  assert.match(layout, /viewportFit:\s*"cover"/);
  assert.match(layout, /themeColor:\s*"#754706"/);
});

test("phone shell is a real app layout, not a stacked desktop sidebar", () => {
  assert.match(shell, /data-bottom-navigation/);
  assert.match(shell, /BOTTOM_NAV_LIMIT = 5/);
  assert.match(foundation, /@media \(max-width: 820px\)/);
  assert.match(foundation, /\.sidebar\s*\{[\s\S]*?display:\s*none\s*!important/);
  assert.match(foundation, /grid-template-rows:\s*auto minmax\(0, 1fr\) var\(--app-bottom-nav-bar-height\)/);
  assert.match(foundation, /\[data-app-scroll-region\][\s\S]*?overflow/);
  assert.match(foundation, /\.bottom-nav-link\.active/);
});

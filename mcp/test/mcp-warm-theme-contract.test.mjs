import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const css = await readFile("src/app/npp-theme.css", "utf8");
const layout = await readFile("src/app/layout.tsx", "utf8");

const tokens = {
  "--npp-color-canvas": "#f7f3ed",
  "--npp-color-surface": "#ffffff",
  "--npp-color-header": "#5a3a24",
  "--npp-color-primary": "#4f7a3a",
  "--npp-color-accent": "#c89b5b",
  "--npp-color-text": "#2b211b",
  "--npp-color-border": "#e8ded2"
};

test("warm MCP palette is owned by one semantic token layer", () => {
  for (const [name, value] of Object.entries(tokens)) {
    assert.match(css, new RegExp(`${name}:\\s*${value}`, "i"));
  }
  for (const alias of ["--bg", "--panel", "--panel-soft", "--text", "--muted", "--line", "--brand", "--brand-strong", "--brand-soft", "--accent"]) {
    assert.match(css, new RegExp(`${alias}:\\s*var\\(--npp-`));
  }
});

test("theme is imported last and browser chrome uses the canvas token", () => {
  const themeIndex = layout.indexOf('import "./npp-theme.css";');
  const previousIndex = layout.indexOf('import "./export-menu-fix.css";');
  assert.ok(themeIndex > previousIndex, "theme override must load after legacy screen CSS");
  assert.match(layout, /themeColor:\s*"#F7F3ED"/);
});

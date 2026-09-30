import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const layout = await readFile("src/app/layout.tsx", "utf8");
const manifest = await readFile("src/app/manifest.ts", "utf8");
const shell = await readFile("src/ui/shell/AppShell.tsx", "utf8");
const shellStyles = await readFile("src/ui/shell/AppShell.module.css", "utf8");
const menuStyles = await readFile("src/ui/shell/MobileAppMenu.module.css", "utf8");
const tokens = await readFile("src/ui/foundation/tokens.css", "utf8");

test("MCP shell now follows the Mobile blue foundation", () => {
  assert.match(tokens, /--mcp-color-primary:\s*#1677ff/i);
  assert.match(tokens, /--mcp-color-background:\s*#f3f6fa/i);
  assert.match(layout, /themeColor:\s*"#F3F6FA"/);
  assert.match(manifest, /background_color:\s*"#F3F6FA"/);
  assert.match(manifest, /theme_color:\s*"#1677FF"/);
  assert.match(shellStyles, /var\(--mcp-color-background\)/);
  assert.match(menuStyles, /var\(--mcp-color-primary\)/);
});

test("new shell is isolated from warm legacy shell selectors", () => {
  assert.doesNotMatch(shell, /className="app-shell"|className="sidebar"|className="app-content-shell"|data-app-top-bar|data-bottom-navigation/);
  assert.doesNotMatch(shellStyles, /--npp-|\.app-shell|\.sidebar-link|!important|:global\(/);
  assert.doesNotMatch(menuStyles, /--npp-|#5a3b20|#754706|#98600f|!important|:global\(/i);
});

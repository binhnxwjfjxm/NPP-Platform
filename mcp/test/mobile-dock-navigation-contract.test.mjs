import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const dock = await readFile("src/ui/foundation/McpBottomNav.tsx", "utf8");
const shell = await readFile("src/ui/shell/AppShell.tsx", "utf8");
const navigation = await readFile("src/ui/shell/navigation.ts", "utf8");
const styles = await readFile("src/ui/foundation/McpFoundation.module.css", "utf8");

test("bottom dock is a static five-item model with no late item injection", () => {
  assert.match(shell, /const bottomItems = PRIMARY_NAV_ITEMS\.map/);
  assert.match(shell, /data-navigation-item-count=\{PRIMARY_NAV_ITEMS\.length\}/);
  assert.doesNotMatch(shell, /slice\(0|push\(|setTimeout|useState/);
  const primary = navigation.match(/export const PRIMARY_NAV_ITEMS:[\s\S]*?=\s*\[([\s\S]*?)\];/)?.[1] || "";
  assert.equal((primary.match(/_NAV_ITEM/g) || []).length, 5);
});

test("leaving a visit flow still uses document navigation", () => {
  assert.match(dock, /usePathname/);
  assert.match(dock, /pathname === "\/visits"/);
  assert.match(dock, /pathname\.startsWith\("\/mcp\/sessions\/"\)/);
  assert.match(dock, /data-document-navigation="true"/);
  assert.match(dock, /data-client-navigation="true"/);
});

test("new dock uses foundation geometry and safe area", () => {
  assert.match(styles, /\.bottomNav\s*\{/);
  assert.match(styles, /--mcp-bottom-nav-height/);
  assert.match(styles, /--mcp-safe-bottom/);
  assert.match(styles, /\.bottomNavItemActive/);
  assert.doesNotMatch(styles, /mobile-app-dock|bottom-nav-link|!important|:global\(/);
});

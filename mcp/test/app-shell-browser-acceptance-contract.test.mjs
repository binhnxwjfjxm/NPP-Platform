import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const shell = await readFile("src/ui/shell/AppShell.tsx", "utf8");
const shellCss = await readFile("src/ui/shell/AppShell.module.css", "utf8");
const dock = await readFile("src/ui/foundation/McpBottomNav.tsx", "utf8");
const navigation = await readFile("src/ui/shell/navigation.ts", "utf8");
const moreRoute = await readFile("src/app/more/page.tsx", "utf8");
const morePage = await readFile("src/features/more/MorePage.tsx", "utf8");

test("mobile shell keeps chrome outside the scroll region", () => {
  assert.match(shellCss, /grid-template-rows:\s*auto minmax\(0, 1fr\) auto/);
  assert.match(shellCss, /height:\s*100dvh/);
  assert.match(shellCss, /overflow-y:\s*auto/);
  assert.match(shell, /data-mcp-scroll-region="true"/);
  assert.match(shell, /data-mcp-bottom-navigation="true"/);
});

test("desktop sidebar and mobile dock share the exact same primary model", () => {
  assert.match(shell, /NavLinks activeHref=\{activeHref\} items=\{PRIMARY_NAV_ITEMS\}/);
  assert.match(shell, /PRIMARY_NAV_ITEMS\.map/);
  assert.match(shell, /primaryNavItemForHref/);
  assert.match(dock, /aria-label="Điều hướng chính"/);
  assert.match(navigation, /SIDEBAR_NAV_ITEMS = PRIMARY_NAV_ITEMS/);
  assert.match(navigation, /FIELD_DOCK_ITEMS = PRIMARY_NAV_ITEMS/);
});

test("Thêm has a canonical route and logout stays on the existing auth contract", async () => {
  assert.match(moreRoute, /MorePage/);
  assert.match(morePage, /McpLogoutButton/);
  await access("src/features/settings/McpLogoutButton.tsx");
});

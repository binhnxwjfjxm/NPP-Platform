import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const layout=await readFile(new URL("../src/app/layout.tsx",import.meta.url),"utf8");
const base=await readFile(new URL("../src/ui/foundation/base.css",import.meta.url),"utf8");
const shell=await readFile(new URL("../src/ui/shell/AppShell.module.css",import.meta.url),"utf8");
const owners=await Promise.all([
  "../src/features/dashboard/TodayScreen.module.css",
  "../src/features/mcp/RouteWorkScreen.module.css",
  "../src/features/accounts/OutletDirectoryScreen.module.css",
  "../src/features/orders/OrdersClientPage.module.css"
].map(p=>readFile(new URL(p,import.meta.url),"utf8")));
test("primary flows use one canonical global owner",()=>{assert.match(layout,/tokens\.css/);assert.match(layout,/foundation\/base\.css/);assert.equal((layout.match(/\.css";/g)||[]).length,2);assert.doesNotMatch(base,/\[data-active-href=|!important|--npp-|--brand/);});
test("mobile geometry is owned by AppShell instead of route-scoped patches",()=>{assert.match(shell,/@media \(max-width: 820px\)/);assert.match(shell,/height:\s*100dvh/);assert.match(shell,/overflow:\s*hidden/);assert.match(shell,/\.bottomNavSlot[\s\S]*display:\s*block/);});
test("primary screen modules keep foundation tokens",()=>{for(const css of owners){assert.match(css,/--mcp-/);assert.doesNotMatch(css,/:global\(|!important|--npp-|--brand/);}});

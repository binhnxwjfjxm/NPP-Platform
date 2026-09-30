import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const layout=await readFile(new URL("../src/app/layout.tsx",import.meta.url),"utf8");
const base=await readFile(new URL("../src/ui/foundation/base.css",import.meta.url),"utf8");
const owners=await Promise.all([
  "../src/features/orders/OrdersClientPage.module.css",
  "../src/features/market-reports/MarketReportsClientPage.module.css",
  "../src/features/market-checks/MarketChecksClientPage.module.css",
  "../src/features/actions/ActionsClientPage.module.css",
  "../src/features/settings/SettingsPage.module.css",
  "../src/features/mcp-settings/McpReportSettingsPage.module.css"
].map(p=>readFile(new URL(p,import.meta.url),"utf8")));
test("support flows no longer load one route-scoped mobile stylesheet",()=>{assert.equal((layout.match(/\.css";/g)||[]).length,2);assert.doesNotMatch(layout,/mcp-mobile-support-flows|mcp-mobile-primary-flows|mobile-app-geometry/);});
test("canonical base does not override routes or brand tokens",()=>{assert.doesNotMatch(base,/\[data-active-href=|!important|--npp-|--brand|--panel/);});
test("support screens own their styles with MCP tokens",()=>{for(const css of owners){assert.match(css,/--mcp-/);assert.doesNotMatch(css,/:global\(|!important|--npp-|--brand/);}});

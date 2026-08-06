import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("session card keeps check-in and every existing action behind compact controls", async () => {
  const card = await source("src/features/mcp/McpLineCard.tsx");
  const css = await source("src/features/mcp/McpLineCard.module.css");

  assert.match(card, /useMcpCustomerDirections/);
  assert.match(card, /requestMcpCustomerProfile/);
  for (const action of ["order", "test", "market_report", "follow_up", "skip"]) {
    assert.match(card, new RegExp(`action: "${action}"`));
  }
  assert.match(card, /line\.orderId \?/);
  assert.match(card, /Đơn NPP/);
  assert.match(card, /data-session-primary-actions="4"/);
  assert.match(card, /data-customer-directions="true"/);
  assert.match(card, /<span>Di chuyển<\/span>/);
  assert.match(card, /window\.location\.assign\(directions\.url\)/);
  assert.match(card, /data-customer-action-menu="open"/);
  assert.match(card, /data-customer-action-count="5"/);
  assert.match(card, /styles\.primaryRow/);
  assert.match(card, /<span>Thao tác<\/span>/);
  assert.match(card, /onToggleCheckin\(line\)/);
  assert.match(card, /onAction\(line, action\)/);
  assert.match(css, /grid-template-columns:\s*minmax\(0, 1fr\) 62px 48px 58px/);
  assert.match(css, /@media \(max-width: 520px\)[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) 60px 44px 54px/);
  assert.match(css, /\.iconButton\s*\{[\s\S]*?min-height:\s*44px/);
  assert.match(css, /\.actions\s*\{[\s\S]*?grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/);
  assert.doesNotMatch(css, /overflow-x:\s*auto/);
  assert.doesNotMatch(css, /scroll-snap-type/);
  assert.doesNotMatch(css, /\.checkin\s*\{[^}]*display:\s*none/s);
  assert.match(card, /identityHead[\s\S]*?accountName[\s\S]*?badge[\s\S]*?statusLabel/);
  assert.match(card, /aria-pressed=\{line\.checkedIn === true\}/);
  assert.match(card, /Bấm lần nữa để bỏ check-in/);
});

test("GPS is captured only by the first manual click and never automatically reused", async () => {
  const view = await source("src/features/mcp/McpSessionCompactViewFinal2.tsx");

  assert.match(view, /navigator\.geolocation\.getCurrentPosition/);
  assert.match(view, /enableHighAccuracy:\s*true/);
  assert.match(view, /maximumAge:\s*0/);
  assert.match(
    view,
    /if \(line\.checkedIn\) \{[\s\S]*?saveManualCheckin\(line, false\)[\s\S]*?\} else \{[\s\S]*?currentSalesPosition\(\)[\s\S]*?saveManualCheckin\(line, true, position\)/
  );
  assert.doesNotMatch(view, /useEffect\([\s\S]{0,240}?currentSalesPosition/);
  assert.match(view, /geoSource:\s*"browser_manual"/);
  assert.match(view, /operation:\s*"session-customer\.checkin\.set"/);
});

test("order popup keeps default workspace while other MCP popups use compact controls", async () => {
  const view = await source("src/features/mcp/McpSessionCompactViewFinal2.tsx");
  const sheet = await source("src/ui/overlay/BottomSheet.tsx");
  const css = await source("src/features/mcp/McpSessionPopupCompact.module.css");

  assert.match(view, /variant=\{isOrder \? "default" : "compact"\}/);
  assert.match(view, /isOrder \? "sheet-action-grid order-sheet-footer" : popupStyles\.footer/);
  assert.match(sheet, /variant\?: "default" \| "compact"/);
  assert.match(sheet, /width:\s*"min\(920px, 100%\)"/);
  assert.match(css, /\.content :global\(\.report-quick-panel\)[\s\S]*?border:\s*1px solid/);
  assert.match(css, /\.content :global\(\.report-chip\)[\s\S]*?min-height:\s*28px/);
  assert.match(css, /\.footer :global\(\.button\)[\s\S]*?min-height:\s*34px/);
});

test("session data exposes dedicated sales check-in fields instead of outlet GPS", async () => {
  const server = await source("apps/backend/server.js");
  const types = await source("src/features/mcp-day/mcp-day.types.ts");

  for (const field of ["checkin_lat", "checkin_lng", "checkin_accuracy", "checkin_at", "checkin_source"]) {
    assert.match(server, new RegExp(field));
  }
  assert.match(server, /checkedIn:\s*Boolean\(snapshot\.checkin_at\)/);
  assert.match(types, /checkedIn\?: boolean/);
  assert.match(types, /checkinAccuracy\?: number/);
});

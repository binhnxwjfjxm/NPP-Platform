import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) { return readFile(new URL(`../${path}`, import.meta.url), "utf8"); }
function cssRule(sourceText, selector) { const match = sourceText.match(new RegExp(`${selector}\\s*\\{([^{}]*)\\}`)); assert.ok(match, `${selector} rule must exist`); return match[1]; }

test("session card keeps check-in and reporting actions behind compact controls without legacy official-order CTA", async () => {
  const card = await source("src/features/mcp/McpLineCard.tsx"); const css = await source("src/features/mcp/McpLineCard.module.css");
  assert.match(card, /useMcpCustomerDirections/); assert.match(card, /requestMcpCustomerProfile/);
  for (const action of ["order", "test", "market_report", "follow_up", "skip"]) assert.match(card, new RegExp(`action: "${action}"`));
  assert.doesNotMatch(card, /line\.orderId \?/); assert.doesNotMatch(card, /Đơn NPP/); assert.doesNotMatch(card, /\/visits\/order-intent/);
  assert.match(card, /data-session-primary-actions="4"/); assert.match(card, /data-customer-directions="true"/); assert.match(card, /<span>Di chuyển<\/span>/); assert.match(card, /window\.location\.assign\(directions\.url\)/); assert.match(card, /data-customer-action-menu="open"/); assert.match(card, /data-customer-action-count="5"/); assert.match(card, /onToggleCheckin\(line\)/); assert.match(card, /onAction\(line, action\)/);
  assert.match(cssRule(css, "\\.primaryRow"), /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+62px\s+48px\s+58px/); assert.match(cssRule(css, "\\.iconButton"), /min-height:\s*44px/); assert.match(cssRule(css, "\\.actions"), /grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/);
  const mobileStart = css.indexOf("@media (max-width: 520px)"); assert.ok(mobileStart >= 0); assert.match(cssRule(css.slice(mobileStart), "\\.primaryRow"), /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+60px\s+44px\s+54px/);
  assert.match(card, /aria-pressed=\{line\.checkedIn === true\}/); assert.match(card, /Bấm lần nữa để bỏ check-in/);
});

test("GPS is captured only by the first manual click and never automatically reused", async () => {
  const view = await source("src/features/mcp/McpSessionCompactViewFinal2.tsx");
  assert.match(view, /navigator\.geolocation\.getCurrentPosition/); assert.match(view, /enableHighAccuracy:\s*true/); assert.match(view, /maximumAge:\s*0/);
  assert.match(view, /if \(line\.checkedIn\)[\s\S]*?saveManualCheckin\(line, false\)[\s\S]*?else[\s\S]*?currentSalesPosition\(\)[\s\S]*?saveManualCheckin\(line, true, position\)/);
  assert.match(view, /geoSource:\s*"browser_manual"/); assert.match(view, /operation:\s*"session-customer\.checkin\.set"/);
});

test("Có đơn is a direct reversible fact toggle; only real reporting actions open compact sheets", async () => {
  const view = await source("src/features/mcp/McpSessionCompactViewFinal2.tsx"); const card = await source("src/features/mcp/McpLineCard.tsx"); const sheet = await source("src/ui/overlay/BottomSheet.tsx"); const css = await source("src/features/mcp/McpSessionPopupCompact.module.css");
  assert.match(card, /\[hasOrder, setHasOrder\] = useState\(Boolean\(line\.hasOrder\)\)/); assert.match(card, /target = !hasOrder/); assert.match(card, /setHasOrder\(target\)[\s\S]*?orderSubmission\.current = null/); assert.match(card, /actionItems\(displayLine\)/); assert.match(card, /resultSummary\(displayLine\)/); assert.match(card, /line\.hasOrder \? "Đã có đơn" : "Có đơn"/); assert.match(card, /\/api\/backend\/mcp-day\/session-customer\/result/); assert.match(card, /session-customer\.result\.record/);
  assert.doesNotMatch(view, /Ghi nhận nhu cầu mua|Lưu nhu cầu mua|ProductPicker|OrderFields/); assert.doesNotMatch(view, /onAction\(line, "order"\)/); assert.match(view, /variant="compact"/); assert.match(sheet, /variant\?: "default" \| "compact"/); assert.match(css, /\.footer :global\(\.button\)[\s\S]*?min-height:\s*34px/);
});

test("session data exposes dedicated sales check-in fields instead of outlet GPS", async () => {
  const server = await source("apps/backend/server.js"); const types = await source("src/features/mcp-day/mcp-day.types.ts");
  for (const field of ["checkin_lat", "checkin_lng", "checkin_accuracy", "checkin_at", "checkin_source"]) assert.match(server, new RegExp(field));
  assert.match(server, /checkedIn:\s*Boolean\(snapshot\.checkin_at\)/); assert.match(types, /checkedIn\?: boolean/); assert.match(types, /checkinAccuracy\?: number/);
});

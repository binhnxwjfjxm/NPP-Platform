import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const cardSource = readFileSync(new URL("../src/features/mcp/McpLineCard.tsx", import.meta.url), "utf8");
const cardCss = readFileSync(new URL("../src/features/mcp/McpLineCard.module.css", import.meta.url), "utf8");

test("route session card preserves existing backend actions", () => {
  for (const action of ["order", "test", "market_report", "follow_up", "skip"]) {
    assert.match(cardSource, new RegExp(`action: "${action}"`));
  }
  assert.match(cardSource, /onToggleCheckin\(line\)/);
  assert.match(cardSource, /onAction\(line, action\)/);
  assert.match(cardSource, /officialOrderHref\(line\)/);
  assert.match(cardSource, /useMcpCustomerDirections/);
  assert.match(cardSource, /requestMcpCustomerProfile/);
});

test("route session card keeps one compact primary row and an explicit action tray", () => {
  assert.match(cardSource, /data-mcp-session-card="true"/);
  assert.match(cardSource, /data-session-primary-actions="4"/);
  assert.match(cardSource, /data-customer-action-menu="open"/);
  assert.match(cardSource, /data-customer-action-count="5"/);
  assert.match(cardSource, /aria-expanded=\{actionsOpen\}/);
  assert.match(cardSource, /<span>Thao tác<\/span>/);
  assert.match(cardSource, /<span>\{checkinBusy \? "Đang xử lý" : line\.checkedIn \? "Đã check-in" : "Check-in"\}<\/span>/);
  assert.match(cardCss, /border-radius:\s*14px/);
  assert.match(cardCss, /grid-template-columns:\s*minmax\(0, 1fr\) 48px 48px 58px/);
  assert.match(cardCss, /\.actions\s*\{[\s\S]*?grid-template-columns:\s*repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(cardCss, /\.actionMenu\s*\{[\s\S]*?animation:\s*revealActions/);
  assert.doesNotMatch(cardCss, /overflow-x:\s*auto/);
  assert.doesNotMatch(cardCss, /scroll-snap-type/);
});

test("route session card keeps the existing warm brand tone", () => {
  assert.match(cardCss, /var\(--brand-primary/);
  assert.doesNotMatch(cardCss, /#1d4ed8|#eff6ff|#dbeafe/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const cardSource = readFileSync(new URL("../src/features/mcp/McpLineCard.tsx", import.meta.url), "utf8");
const cardCss = readFileSync(new URL("../src/features/mcp/McpLineCard.module.css", import.meta.url), "utf8");

test("route session card preserves existing backend actions", () => {
  for (const action of ["order", "test", "market_report", "follow_up", "skip"]) {
    assert.match(cardSource, new RegExp(`action: \\\"${action}\\\"`));
  }
  assert.match(cardSource, /onToggleCheckin\(line\)/);
  assert.match(cardSource, /officialOrderHref\(line\)/);
  assert.match(cardSource, /useMcpCustomerDirections/);
  assert.match(cardSource, /requestMcpCustomerProfile/);
});

test("route session card uses app-style hierarchy without hiding actions", () => {
  assert.match(cardSource, /data-mcp-session-card="true"/);
  assert.match(cardSource, /styles\.primaryRow/);
  assert.match(cardSource, /Check-in điểm bán/);
  assert.match(cardSource, /ActionIcon/);
  assert.match(cardCss, /grid-template-columns: minmax\(0, 1fr\) 64px 64px/);
  assert.match(cardCss, /\.actions \{/);
  assert.doesNotMatch(cardCss, /display:\s*none/);
});

test("route session card keeps the existing warm brand tone", () => {
  assert.match(cardCss, /var\(--brand-primary/);
  assert.doesNotMatch(cardCss, /#1d4ed8|#eff6ff|#dbeafe/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const tokens = await readFile("src/ui/foundation/tokens.css", "utf8");
const styles = await readFile("src/ui/foundation/McpFoundation.module.css", "utf8");
const primitives = await readFile("src/ui/foundation/McpPrimitives.tsx", "utf8");
const bottomNav = await readFile("src/ui/foundation/McpBottomNav.tsx", "utf8");
const sheet = await readFile("src/ui/foundation/McpSheet.tsx", "utf8");
const layout = await readFile("src/app/layout.tsx", "utf8");

test("Lô 1 foundation matches MCP Mobile color, spacing and radius tokens", () => {
  const required = {
    "--mcp-color-primary": "#1677ff",
    "--mcp-color-primary-dark": "#0b356d",
    "--mcp-color-primary-deep": "#082b5a",
    "--mcp-color-primary-soft": "#eaf3ff",
    "--mcp-color-background": "#f3f6fa",
    "--mcp-color-surface": "#ffffff",
    "--mcp-color-border": "#dde5ef",
    "--mcp-color-text-primary": "#10233f",
    "--mcp-color-text-secondary": "#66768a",
    "--mcp-color-success": "#21b66f",
    "--mcp-color-warning": "#e69424",
    "--mcp-color-danger": "#ed5a64",
    "--mcp-space-xs": "6px",
    "--mcp-space-sm": "10px",
    "--mcp-space-md": "16px",
    "--mcp-space-lg": "20px",
    "--mcp-space-xl": "24px",
    "--mcp-space-xxl": "32px",
    "--mcp-radius-sm": "10px",
    "--mcp-radius-md": "14px",
    "--mcp-radius-lg": "18px",
    "--mcp-radius-xl": "24px",
    "--mcp-bottom-nav-height": "68px"
  };

  for (const [name, value] of Object.entries(required)) {
    assert.match(tokens, new RegExp(`${name}:\\s*${value}`, "i"), `${name} must match Mobile`);
  }
});

test("new foundation is isolated from legacy CSS instead of overriding it", () => {
  assert.match(layout, /import "@\/ui\/foundation\/tokens\.css";/);
  assert.doesNotMatch(tokens, /--npp-|--brand|--bg:|--panel:/);
  assert.doesNotMatch(tokens, /\.app-shell|\.sidebar|\.button|\.card|\.page-header|\.bottom-sheet/);
  assert.doesNotMatch(styles, /:global\(/);
  assert.doesNotMatch(`${tokens}\n${styles}`, /!important/);
  assert.doesNotMatch(`${primitives}\n${bottomNav}\n${sheet}`, /src\/app|globals\.css|npp-theme\.css|mobile-app-/);
});

test("foundation owns the required reusable office UI primitives", () => {
  for (const exported of [
    "McpScreen",
    "McpCard",
    "McpButton",
    "McpInput",
    "McpSelect",
    "McpTextarea",
    "McpSearchField",
    "McpStatusPill",
    "McpPageHeader",
    "McpFilterChip",
    "McpFilterRow",
    "McpListRow",
    "McpList",
    "McpStatePanel",
    "McpSkeleton"
  ]) {
    assert.match(primitives, new RegExp(`export function ${exported}\\b`), `${exported} must exist`);
  }

  for (const selector of [
    ".card",
    ".button",
    ".input",
    ".statusPill",
    ".pageHeader",
    ".filterChip",
    ".listRow",
    ".statePanel",
    ".bottomNav",
    ".sheet"
  ]) {
    assert.ok(styles.includes(selector), `${selector} must have one foundation owner`);
  }
});

test("foundation touch targets, safe areas and responsive behavior are explicit", () => {
  assert.match(tokens, /--mcp-touch-target:\s*44px/);
  assert.match(tokens, /--mcp-control-height:\s*52px/);
  assert.match(tokens, /safe-area-inset-top/);
  assert.match(tokens, /safe-area-inset-bottom/);
  assert.match(styles, /min-height:\s*var\(--mcp-control-height\)/);
  assert.match(styles, /min-height:\s*var\(--mcp-touch-target\)/);
  assert.match(styles, /calc\(var\(--mcp-bottom-nav-height\) \+ var\(--mcp-safe-bottom\)\)/);
  assert.match(styles, /@media \(max-width:\s*640px\)/);
  assert.match(styles, /@media \(prefers-reduced-motion:\s*reduce\)/);
});

test("sheet and bottom navigation keep accessibility contracts without legacy dependencies", () => {
  assert.match(sheet, /aria-modal="true"/);
  assert.match(sheet, /role="dialog"/);
  assert.match(sheet, /event\.key === "Escape"/);
  assert.match(sheet, /aria-label="Đóng"/);
  assert.match(bottomNav, /aria-label="Điều hướng chính"/);
  assert.match(bottomNav, /aria-current=\{active \? "page" : undefined\}/);
  assert.match(bottomNav, /prefetch=\{false\}/);
});

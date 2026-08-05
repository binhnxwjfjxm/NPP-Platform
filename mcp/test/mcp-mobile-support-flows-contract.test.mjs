import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const css = fs.readFileSync(new URL("../src/app/mcp-mobile-support-flows.css", import.meta.url), "utf8");
const layout = fs.readFileSync(new URL("../src/app/layout.tsx", import.meta.url), "utf8");

const scopedRoutes = [
  "/orders",
  "/reports",
  "/field-checks",
  "/plans",
  "/settings",
  "/mcp-setting"
];

test("lot 3 mobile stylesheet is loaded", () => {
  assert.match(layout, /import "\.\/mcp-mobile-support-flows\.css";/);
});

test("lot 3 stylesheet is mobile-only and route-scoped", () => {
  assert.match(css, /@media \(max-width: 820px\)/);
  for (const route of scopedRoutes) {
    assert.ok(css.includes(`[data-active-href="${route}"]`), `missing route scope ${route}`);
  }
});

test("lot 3 preserves page headers and action regions", () => {
  assert.doesNotMatch(css, /\.page-header\s*\{[^}]*display\s*:\s*none/is);
  assert.doesNotMatch(css, /:is\([^)]*(?:form-actions|settings-actions|report-actions)[^)]*\)\s*\{[^}]*display\s*:\s*none/is);
});

test("lot 3 does not alter brand color tokens", () => {
  assert.doesNotMatch(css, /--(?:color|brand|primary|accent)[\w-]*\s*:/i);
  assert.doesNotMatch(css, /(?:background|color|border-color)\s*:\s*#[0-9a-f]{3,8}/i);
});

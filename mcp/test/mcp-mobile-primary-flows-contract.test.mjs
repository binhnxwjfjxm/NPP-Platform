import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile(new URL("../src/app/mcp-mobile-primary-flows.css", import.meta.url), "utf8");
const layout = await readFile(new URL("../src/app/layout.tsx", import.meta.url), "utf8");

const protectedRoutes = [
  "/",
  "/routes",
  "/visits",
  "/mcp",
  "/mcp/sessions",
  "/customers",
  "/visits/order-intent"
];

test("lot 2 mobile CSS is imported after the shared mobile geometry", () => {
  const sharedIndex = layout.indexOf('import "./mobile-app-geometry.css"');
  const lotIndex = layout.indexOf('import "./mcp-mobile-primary-flows.css"');
  assert.ok(sharedIndex >= 0);
  assert.ok(lotIndex > sharedIndex);
});

test("lot 2 CSS is route-scoped and mobile-only", () => {
  assert.match(css, /@media \(max-width: 820px\)/);
  for (const route of protectedRoutes) {
    assert.ok(css.includes(`[data-active-href="${route}"]`), `missing route scope ${route}`);
  }
  assert.doesNotMatch(css, /\.page-header\s*\{[^}]*display\s*:\s*none/is);
  assert.doesNotMatch(css, /\.page-header-actions\s*\{[^}]*display\s*:\s*none/is);
});

test("lot 2 preserves app navigation and primary action geometry", () => {
  assert.match(css, /--app-bottom-nav-bar-height/);
  assert.match(css, /min-height:\s*46px/);
  assert.match(css, /position:\s*sticky/);
  assert.match(css, /grid-template-columns:\s*minmax\(0, 1fr\)/);
});

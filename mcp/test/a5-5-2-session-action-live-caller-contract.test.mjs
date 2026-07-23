import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile("src/features/mcp/McpSessionCompactViewFinal2.tsx", "utf8");

const routes = [
  ["order", "session-customer.order.create"],
  ["test", "session-customer.test.create"],
  ["report", "session-customer.report.create"],
  ["followup", "session-customer.followup.create"]
];

test("the four UI actions call the same canonical frontend proxy paths accepted by mutationOperation", () => {
  for (const [route, operation] of routes) {
    const path = `/api/backend/mcp-day/session-customer/${route}`;
    const escapedPath = path.replaceAll("/", "\\/");
    assert.match(source, new RegExp(`if \\(path === "${escapedPath}"\\)`));
    assert.match(source, new RegExp(`postJson\\("${escapedPath}"`));
    assert.match(source, new RegExp(operation.replaceAll(".", "\\.")));
  }
  assert.doesNotMatch(source, /postJson\("\/api\/mcp-orders\/from-session-customer"/);
});

test("canonical provider errors are mapped to a user-facing message", () => {
  assert.match(source, /function apiErrorMessage/);
  assert.match(source, /typeof value\.error === "string"/);
  assert.match(source, /value\.error\.message/);
});

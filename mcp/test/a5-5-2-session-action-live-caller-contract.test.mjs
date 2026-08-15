import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile("src/features/mcp/McpSessionCompactViewFinal2.tsx", "utf8");
const card = await readFile("src/features/mcp/McpLineCard.tsx", "utf8");

const routes = [["test", "session-customer.test.create"], ["report", "session-customer.report.create"], ["followup", "session-customer.followup.create"]];

test("Có đơn uses the result fact proxy while popup actions use canonical frontend proxy paths", () => {
  assert.match(card, /\/api\/backend\/mcp-day\/session-customer\/result/);
  assert.match(card, /session-customer\.result\.record/);
  assert.match(card, /hasOrder: target/);
  for (const [route, operation] of routes) {
    const path = `/api/backend/mcp-day/session-customer/${route}`;
    const escapedPath = path.replaceAll("/", "\\/");
    assert.match(source, new RegExp(`if \\(path === "${escapedPath}"\\)`));
    assert.match(source, new RegExp(`postJson\\("${escapedPath}"`));
    assert.match(source, new RegExp(operation.replaceAll(".", "\\.")));
  }
  assert.doesNotMatch(source, /postJson\("\/api\/backend\/mcp-day\/session-customer\/order"/);
  assert.doesNotMatch(source, /postJson\("\/api\/mcp-orders\/from-session-customer"/);
});

test("canonical provider errors are mapped to user-facing messages", () => {
  assert.match(source, /function apiErrorMessage/);
  assert.match(source, /typeof value\.error === "string"/);
  assert.match(source, /value\.error\.message/);
  assert.match(card, /function mutationError/);
});

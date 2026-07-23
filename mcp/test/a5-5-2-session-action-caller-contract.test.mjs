import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile("src/features/mcp/McpSessionCompactViewFinal2.tsx", "utf8");
const transitional = await readFile("apps/backend/foundation/transitional-api.js", "utf8");

test("four high-risk session actions use one stable-key mutation helper", () => {
  assert.match(source, /async function postJson[\s\S]*?idempotentMutationFetch\(/);
  for (const operation of [
    "session-customer.order.create",
    "session-customer.test.create",
    "session-customer.report.create",
    "session-customer.followup.create"
  ]) assert.match(source, new RegExp(operation.replaceAll(".", "\\.")));
  assert.doesNotMatch(source, /async function postJson[\s\S]*?const response = await fetch\(path/);
});

test("Foundation owns the four routes before legacy proxy fallback", () => {
  for (const route of [
    "/api/mcp-day/session-customer/order",
    "/api/mcp-day/session-customer/test",
    "/api/mcp-day/session-customer/report",
    "/api/mcp-day/session-customer/followup"
  ]) assert.match(transitional, new RegExp(route.replaceAll("/", "\\/")));
  for (const owner of [
    "createSessionCustomerOrder",
    "createSessionCustomerTest",
    "createSessionCustomerReport",
    "createSessionCustomerFollowup"
  ]) assert.match(transitional, new RegExp(owner));
});

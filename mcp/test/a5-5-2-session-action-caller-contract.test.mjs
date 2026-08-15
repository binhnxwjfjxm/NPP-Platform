import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile("src/features/mcp/McpSessionCompactViewFinal2.tsx", "utf8");
const card = await readFile("src/features/mcp/McpLineCard.tsx", "utf8");
const transitional = await readFile("apps/backend/foundation/transitional-api.js", "utf8");

test("session fact and remaining high-risk actions use canonical stable-key mutation helpers", () => {
  assert.match(card, /idempotentMutationFetch\(/);
  assert.match(card, /session-customer\.result\.record/);
  assert.match(card, /createIdempotencyKey\("session-customer\.result\.record"\)/);
  assert.match(source, /async function postJson[\s\S]*?idempotentMutationFetch\(/);
  for (const operation of ["session-customer.test.create", "session-customer.report.create", "session-customer.followup.create"]) assert.match(source, new RegExp(operation.replaceAll(".", "\\.")));
  assert.doesNotMatch(source, /session-customer\.order\.create/);
});

test("Foundation owns the reporting fact and remaining session action routes", () => {
  for (const route of ["/api/mcp-day/session-customer/result", "/api/mcp-day/session-customer/test", "/api/mcp-day/session-customer/report", "/api/mcp-day/session-customer/followup"]) assert.match(transitional, new RegExp(route.replaceAll("/", "\\/")));
  for (const owner of ["recordSessionCustomerResult", "createSessionCustomerTest", "createSessionCustomerReport", "createSessionCustomerFollowup"]) assert.match(transitional, new RegExp(owner));
});

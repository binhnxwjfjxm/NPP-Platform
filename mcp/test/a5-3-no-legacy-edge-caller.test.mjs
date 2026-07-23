import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("legacy server cannot call retired MCP day Edge functions", async () => {
  const source = await readFile(path.join(repositoryRoot, "apps/backend/server.js"), "utf8");
  assert.doesNotMatch(source, /proxySupabaseFunction\s*\(/);
  assert.doesNotMatch(source, /["'\`]mcp-day-8b3["'\`]/);
  assert.doesNotMatch(source, /["'\`]mcp-day-followup["'\`]/);
});

test("canonical result and add remain owned by the Foundation transitional API", async () => {
  const source = await readFile(path.join(repositoryRoot, "apps/backend/foundation/transitional-api.js"), "utf8");
  assert.match(source, /pathname === "\/api\/mcp-day\/session-customer\/result"/);
  assert.match(source, /return saveSessionCustomerResult\(/);
  assert.match(source, /pathname === "\/api\/mcp-day\/session-customer\/add"/);
  assert.match(source, /return saveAddedSessionCustomer\(/);
});

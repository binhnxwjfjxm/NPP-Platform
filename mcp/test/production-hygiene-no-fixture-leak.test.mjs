import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("smoke runner has one mandatory cleanup phase after all business writes", async () => {
  const source = await readFile(path.join(root, "scripts/smoke-mcp-v1-api.mjs"), "utf8");
  const cleanupCall = source.lastIndexOf("await cleanupAllRoutes()");
  const orderWrite = source.indexOf('"/api/mcp-day/session-customer/order"');
  const testWrite = source.indexOf('"/api/mcp-day/session-customer/test"');
  const reportWrite = source.indexOf('"/api/mcp-day/session-customer/report"');
  assert.ok(cleanupCall > orderWrite);
  assert.ok(cleanupCall > testWrite);
  assert.ok(cleanupCall > reportWrite);
  assert.match(source, /throw new AggregateError\([\s\S]*mcp_v1_api_smoke_failed/);
});

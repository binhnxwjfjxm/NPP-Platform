import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const retired = [
  "1dc555d44cc89f4bfaa50180",
  "abf55ef270a7e39894bf265d",
  "89edbaea655813b7ea00bc40",
  "7b35ad1f6bb6f4a506761a51",
  "4c9adfa1c08d263a002e5cde",
  "2dfa3c8e754823d8ce845e11",
  "6e5f15d9cd15ee8e012e151d"
];

test("legacy direct-table MCP day implementations are removed", async () => {
  const source = await readFile(path.join(root, "apps/backend/server.js"), "utf8");
  assert.doesNotMatch(source, /async function openMcpDaySession\(body\)/);
  assert.doesNotMatch(source, /async function updateMcpSessionCustomerStatus\(body\)/);
});

test("MCP day open and status routes remain RPC-owned", async () => {
  const source = await readFile(path.join(root, "apps/backend/server.js"), "utf8");
  assert.match(source, /openMcpDaySessionV1/);
  assert.match(source, /mcp_open_route_session/);
  assert.match(source, /updateMcpSessionCustomerStatusV1/);
  assert.match(source, /mcp_set_session_customer_status/);
  assert.match(source, /pathname === "\/api\/mcp-day\/open-session"/);
  assert.match(source, /pathname === "\/api\/mcp-day\/session-customer\/status"/);
});

test("all removed direct-table fingerprints remain in the immutable retirement ledger", async () => {
  const ledger = JSON.parse(await readFile(path.join(root, "scripts/direct-db-mutation-retirements.json"), "utf8"));
  const entry = ledger.entries.find((item) => item.phase === "A5.2");
  assert.ok(entry);
  for (const fingerprint of retired) assert.ok(entry.fingerprints.includes(fingerprint), fingerprint);
});

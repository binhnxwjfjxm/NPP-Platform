import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const main = await readFile("test/runtime/smoke-a5-5-2-session-actions.mjs", "utf8");
const fixture = await readFile("test/runtime/a5-5-2-smoke-fixture.mjs", "utf8");
const operation = await readFile("test/runtime/a5-5-2-smoke-operation.mjs", "utf8");

test("A5.5.2 runtime smoke covers all four typed operations", () => {
  for (const name of ["order", "test", "report", "followup"]) {
    assert.match(main, new RegExp(`name: "${name}"`));
  }
  for (const value of [
    "session-customer.order.create",
    "session-customer.test.create",
    "session-customer.report.create",
    "session-customer.followup.create"
  ]) assert.match(main, new RegExp(value.replaceAll(".", "\\.")));
  assert.equal((main.match(/await runOperation\(\{/g) || []).length, 4);
});

test("runtime smoke requires execute replay conflict audit context and cleanup", () => {
  for (const marker of ["execute", "replay", "conflict", "audit", "context"]) {
    assert.match(operation, new RegExp(`${marker}: "PASS"`));
  }
  assert.match(main, /A5_5_2_SESSION_ACTION_RUNTIME_SMOKE: "PASS"/);
  assert.match(main, /fixtureCleanup: "PENDING"/);
  assert.match(main, /output\.fixtureCleanup = "PASS"/);
  assert.match(fixture, /smokeCleanup === true/);
  assert.match(fixture, /verifyFixtureRemoved/);
});

test("fixture stays inside the guarded hard-delete contract", () => {
  assert.match(fixture, /__MCP_V1_API_FULL__/);
  assert.match(fixture, /area: "API Smoke"/);
  assert.match(fixture, /note: "temporary MCP v1 API smoke"/);
});

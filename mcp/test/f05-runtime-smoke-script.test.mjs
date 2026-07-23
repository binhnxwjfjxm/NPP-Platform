import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { asObject, readJsonValue } from "./runtime/json-response.mjs";

const scriptPath = new URL("./runtime/smoke-f05-runtime-closure.mjs", import.meta.url);
const packagePath = new URL("../package.json", import.meta.url);

async function source() {
  return readFile(scriptPath, "utf8");
}

test("F05 runtime smoke script has valid syntax", () => {
  const result = spawnSync(process.execPath, ["--check", fileURLToPath(scriptPath)], {
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("F05 JSON reader preserves Supabase row arrays", async () => {
  const rows = await readJsonValue(
    {
      status: 200,
      text: async () => '[{"id":"mrc_test","geo_lat":null}]'
    },
    "DB GET mcp_route_customers"
  );

  assert.deepEqual(rows, [{ id: "mrc_test", geo_lat: null }]);
  assert.equal(Array.isArray(rows), true);
  assert.deepEqual(asObject(rows), {});
});

test("F05 JSON reader keeps Gateway envelopes as objects", async () => {
  const envelope = await readJsonValue(
    {
      status: 200,
      text: async () => '{"data":{"ok":true},"requestId":"req-1","receivedAt":"now"}'
    },
    "GET /api/health"
  );

  assert.deepEqual(asObject(envelope), envelope);
});

test("F05 runtime smoke remains operational test tooling, not application code", async () => {
  const pkg = JSON.parse(await readFile(packagePath, "utf8"));
  assert.equal(
    pkg.scripts["smoke:f05-runtime"],
    "node test/runtime/smoke-f05-runtime-closure.mjs"
  );
});

test("F05 runtime smoke closes Gateway idempotency and check-in gates", async () => {
  const text = await source();

  for (const route of [
    "/api/route-customers",
    "/api/mcp-day/session-customer/checkin",
    "/api/mcp-day/session-customer/result",
    "/api/mcp-day/open-session",
    "/api/mcp-day/data"
  ]) {
    assert.match(text, new RegExp(route.replaceAll("/", "\\/")));
  }

  assert.match(text, /"Idempotency-Key": idempotencyKey/);
  assert.match(text, /"X-Backend-Token": backendToken/);
  assert.match(text, /"X-Request-Id": requestId/);
  assert.match(text, /const customerKey = `f05\.route-customer\.\$\{stamp\}`/);
  assert.match(text, /idempotencyKey: customerKey/);
  assert.match(text, /routeName: `__MCP_V1_API_FULL__\$\{stamp\}`/);
  assert.match(text, /area: "API Smoke"/);
  assert.match(text, /note: "temporary MCP v1 API smoke"/);
  assert.match(text, /route_customer_response_line_mismatch/);
  assert.match(text, /sameJson\(first\.payload\.data, second\.payload\.data\)/);
  assert.match(text, /mustConflict\("\/api\/mcp-day\/session-customer\/checkin"/);
  assert.match(text, /mustConflict\("\/api\/mcp-day\/session-customer\/result"/);
  assert.match(text, /checkedIn: false/);
  assert.match(text, /checkin_overwrote_outlet_gps/);
  assert.match(text, /checkin_changed_visit_status/);
  assert.match(text, /mcp_audit_events/);
  assert.match(text, /mcp_idempotency_records/);
  assert.match(text, /ensure\(Array\.isArray\(payload\), `DB GET \$\{path\}: response_not_array`\)/);
  assert.match(text, /cleanupAll\(\)/);
  assert.match(text, /flattenErrors\(error\)/);
  assert.match(text, /F05_RUNTIME_CLOSURE_SMOKE: "PASS"/);
});

test("F05 runtime smoke never prints backend or service-role secrets", async () => {
  const text = await source();

  assert.doesNotMatch(text, /console\.(?:log|error)\([^\n]*(?:backendToken|serviceRole)/);
  assert.doesNotMatch(text, /JSON\.stringify\([^)]*(?:backendToken|serviceRole)/);
});


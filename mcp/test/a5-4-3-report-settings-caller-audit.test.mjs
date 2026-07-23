import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const retiredFingerprints = [
  "6ae585a158e2fd800062fb45",
  "500b241ecd80ff8d74047e27",
  "ea3fdd0cec40084d8ba06c1f",
  "204c2501e1755878fd26bf36"
];

test("public report-setting routes remain backend proxies", async () => {
  const groupRoute = await readFile(path.join(root, "src/app/api/mcp-report-setting-groups/route.ts"), "utf8");
  const itemRoute = await readFile(path.join(root, "src/app/api/backend/mcp-report-settings/route.ts"), "utf8");
  assert.match(groupRoute, /proxyBackendRequest\(request, "\/api\/mcp-report-setting-groups", "POST"\)/);
  assert.match(groupRoute, /proxyBackendRequest\(request, "\/api\/mcp-report-setting-groups", "PATCH"\)/);
  assert.match(itemRoute, /proxyBackendRequest\(request, "\/api\/mcp-report-settings", "POST"\)/);
  assert.match(itemRoute, /proxyBackendRequest\(request, "\/api\/mcp-report-settings", "PATCH"\)/);
  assert.doesNotMatch(groupRoute, /SUPABASE_SERVICE_ROLE_KEY|\/rest\/v1\/mcp_setting_groups/);
  assert.doesNotMatch(itemRoute, /SUPABASE_SERVICE_ROLE_KEY|\/rest\/v1\/mcp_setting_items/);
});

test("Foundation owns all four report-setting mutations", async () => {
  const source = await readFile(path.join(root, "apps/backend/foundation/transitional-api.js"), "utf8");
  assert.match(source, /createReportSettingGroup/);
  assert.match(source, /updateReportSettingGroup/);
  assert.match(source, /createReportSettingItem/);
  assert.match(source, /updateReportSettingItem/);
  assert.match(source, /method === "POST" && pathname === "\/api\/mcp-report-setting-groups"/);
  assert.match(source, /method === "PATCH" && pathname === "\/api\/mcp-report-setting-groups"/);
  assert.match(source, /method === "POST" && pathname === "\/api\/mcp-report-settings"/);
  assert.match(source, /method === "PATCH" && pathname === "\/api\/mcp-report-settings"/);
  assert.doesNotMatch(source, /supabaseRest\(config, "mcp_setting_groups"/);
  assert.doesNotMatch(source, /mcp_setting_groups\?id=eq/);
});

test("legacy backend keeps the report-setting read model but no item mutation owner", async () => {
  const source = await readFile(path.join(root, "apps/backend/server.js"), "utf8");
  assert.match(source, /loadMcpReportSettingsV1/);
  assert.match(source, /url\.pathname === "\/api\/mcp-report-settings".*loadMcpReportSettingsV1/);
  assert.doesNotMatch(source, /createMcpReportSettingV1/);
  assert.doesNotMatch(source, /updateMcpReportSettingV1/);
  assert.doesNotMatch(source, /supabaseInsert\("mcp_setting_items"/);
  assert.doesNotMatch(source, /supabasePatch\("mcp_setting_items"/);
  assert.doesNotMatch(source, /url\.pathname === "\/api\/mcp-report-settings".*createMcpReportSettingV1/);
  assert.doesNotMatch(source, /url\.pathname === "\/api\/mcp-report-settings".*updateMcpReportSettingV1/);
});

test("all four A5.4.3 fingerprints are recorded in the retirement ledger", async () => {
  const ledger = JSON.parse(await readFile(path.join(root, "scripts/direct-db-mutation-retirements.json"), "utf8"));
  const entry = ledger.entries.find((item) => item.phase === "A5.4.3");
  assert.ok(entry);
  for (const fingerprint of retiredFingerprints) {
    assert.ok(entry.fingerprints.includes(fingerprint), fingerprint);
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const retiredRoutes = [
  "order-template",
  "test-template",
  "report-template",
  "followup-template",
  "skip-reason-template",
  "customer-add-rule",
  "session-status"
];

const retiredSymbols = [
  "normalizeMcpOrderTemplateItems",
  "saveMcpOrderTemplateSettings",
  "normalizeMcpTestTemplateItems",
  "saveMcpTestTemplateSettings",
  "saveMcpReportTemplateSettings",
  "saveMcpFollowupTemplateSettings",
  "normalizeMcpSkipReasonItems",
  "saveMcpSkipReasonTemplateSettings",
  "normalizeMcpCustomerAddMode",
  "saveMcpCustomerAddRuleSettings",
  "normalizeMcpRouteSessionStatus",
  "saveMcpRouteSessionStatusSettings"
];

const retiredFingerprints = [
  "da7ddec2ffc4e17ec590b3e4",
  "08a841ace1c4cef116ff9b22",
  "1c2a5e2584dd2b500a5d1130",
  "baccc48a7b8f071176d4626a",
  "43c2ba9d8f446c8bf28d2dc7",
  "61c3deb62040fe9b268388f3",
  "589555fa88626dd16813774b"
];

async function sourceFiles(root) {
  const output = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) output.push(...await sourceFiles(full));
    else if (/\.(?:js|jsx|mjs|ts|tsx)$/.test(entry.name)) output.push(full);
  }
  return output;
}

test("dead route-settings POST handlers and save helpers stay retired", async () => {
  const server = await readFile("apps/backend/server.js", "utf8");
  const postOwner = server.slice(server.indexOf("async function handlePost"), server.indexOf("async function handleGet"));

  for (const route of retiredRoutes) {
    assert.doesNotMatch(postOwner, new RegExp(`/api/mcp-settings/${route.replaceAll("-", "\\-")}`), route);
  }
  for (const symbol of retiredSymbols) assert.doesNotMatch(server, new RegExp(`\\b${symbol}\\b`), symbol);
});

test("required legacy GET readers remain available during source retirement", async () => {
  const server = await readFile("apps/backend/server.js", "utf8");
  const getOwner = server.slice(server.indexOf("async function handleGet"));

  for (const route of ["order-template", "skip-reason-template", "customer-add-rule", "session-status"]) {
    assert.match(getOwner, new RegExp(`/api/mcp-settings/${route.replaceAll("-", "\\-")}`), route);
  }
  assert.match(getOwner, /\/api\/mcp-settings\/templates/);
});

test("current MCP settings UI remains on the typed idempotent report-settings owner", async () => {
  const page = await readFile("src/features/mcp-settings/McpReportSettingsPage.tsx", "utf8");
  assert.match(page, /const REPORT_SETTINGS_API = "\/api\/mcp-report-settings"/);
  assert.match(page, /idempotentMutationFetch\(path[\s\S]*?report-setting-item\.\$\{method\.toLowerCase\(\)\}/);
  for (const route of retiredRoutes) assert.doesNotMatch(page, new RegExp(`/api/mcp-settings/${route}`), route);
});

test("no live source caller posts to a retired route-settings endpoint", async () => {
  const files = await sourceFiles(path.resolve("src"));
  const references = [];

  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const route of retiredRoutes) {
      const endpoint = `/api/mcp-settings/${route}`;
      if (source.includes(endpoint)) references.push({ file: path.relative(process.cwd(), file), route, source });
    }
  }

  assert.deepEqual(
    references.map(({ file, route }) => ({ file, route })),
    [{ file: "src/lib/api/api-client.ts", route: "session-status" }]
  );

  const apiClient = references[0].source;
  assert.match(apiClient, /fetchJson<McpSessionStatusData>\([\s\S]*?"\/api\/mcp-settings\/session-status"/);
  assert.doesNotMatch(apiClient, /post(?:Idempotent)?Json[^\n]*\/api\/mcp-settings\/session-status/);
});

test("retirement reclassification and completion ledger stay exact", async () => {
  const reclassifications = JSON.parse(await readFile("scripts/direct-db-mutation-retirement-reclassifications.json", "utf8"));
  const retirements = JSON.parse(await readFile("scripts/direct-db-mutation-retirements.json", "utf8"));

  assert.equal(reclassifications.schemaVersion, 1);
  assert.deepEqual(reclassifications.entries.map((entry) => entry.fingerprint), retiredFingerprints);
  for (const entry of reclassifications.entries) {
    assert.equal(entry.classification, "known-legacy-debt", entry.fingerprint);
    assert.equal(entry.operation, "mutation", entry.fingerprint);
    assert.equal(entry.owner, "legacy-backend", entry.fingerprint);
    assert.equal(entry.replacementPhase, "A5.5.2", entry.fingerprint);
    assert.equal(entry.replacementTarget, "retired legacy POST handler", entry.fingerprint);
  }

  const retirement = retirements.entries.find((entry) => entry.phase === "A5.5.2");
  assert.ok(retirement);
  assert.equal(retirement.owner, "route-settings-retirement");
  assert.deepEqual(retirement.fingerprints, retiredFingerprints);
});

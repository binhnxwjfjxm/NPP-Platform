import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const baseline = "46f43b473e35ac1103aa2b49412de3f64fe1646b";
const auditRoot = "audit/phase-6c0a";

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function exists(path) {
  await access(path);
  return true;
}

const inventory = await readJson(`${auditRoot}/dependency-inventory.json`);
const environment = await readJson(`${auditRoot}/environment-contract.json`);
const identity = await readJson(`${auditRoot}/identity-mapping-contract.json`);
const orderClasses = await readJson(`${auditRoot}/legacy-order-classification.json`);
const risks = await readJson(`${auditRoot}/risk-register.json`);
const fixture = await readJson(`${auditRoot}/fixtures/reconciliation-input.json`);
const reportSchema = await readJson(`${auditRoot}/reconciliation-report.schema.json`);
const auditDoc = await readFile("../docs/operations/phase-6c0a-mcp-legacy-audit.md", "utf8");
const auditSql = await readFile(`${auditRoot}/read-only-data-audit.sql`, "utf8");

test("all Phase 6C.0A contracts use the exact audited baseline", () => {
  for (const contract of [inventory, environment, identity, orderClasses, risks]) {
    assert.equal(contract.phase, "6C.0A");
    assert.equal(contract.baseline, baseline);
  }
  assert.match(auditDoc, new RegExp(baseline));
});

test("dependency inventory is complete enough to drive the next audit", async () => {
  const required = [
    "flow", "uiEntry", "clientHook", "nextRoute", "backendRoute", "backendHandler",
    "dataAccess", "provider", "operation", "authBoundary", "idempotencyBehavior",
    "currentOwner", "targetOwner", "classification", "lifecycle", "evidenceLevel",
    "evidenceFiles", "nextAuditStep"
  ];

  assert.ok(inventory.entries.length >= 14);
  for (const entry of inventory.entries) {
    for (const field of required) assert.ok(field in entry, `${entry.flow} missing ${field}`);
    assert.ok(String(entry.currentOwner).trim(), `${entry.flow} has no current owner`);
    assert.ok(String(entry.targetOwner).trim(), `${entry.flow} has no target owner`);
    assert.ok(String(entry.nextAuditStep).trim(), `${entry.flow} has no next audit step`);

    if (entry.lifecycle === "unknown" || entry.evidenceLevel === "unknown") {
      assert.ok(String(entry.unknownOwner || "").trim(), `${entry.flow} unknown has no owner`);
    }

    if (entry.evidenceLevel === "repository_verified") {
      assert.ok(entry.evidenceFiles.length > 0, `${entry.flow} has no repository evidence`);
      for (const path of entry.evidenceFiles) await exists(path);
    }
  }
});

test("the active UI chain remains distinct from legacy and dead-code findings", async () => {
  const visits = await readFile("src/app/visits/page.tsx", "utf8");
  const pageExport = await readFile("src/features/mcp/MCPPage.tsx", "utf8");
  const entry = await readFile("src/features/mcp/MCPPageEntryReportReady.tsx", "utf8");
  const compact = await readFile("src/features/mcp/McpSessionCompactView.tsx", "utf8");
  const finalView = await readFile("src/features/mcp/McpSessionCompactViewFinal2.tsx", "utf8");

  assert.match(visits, /from "@\/features\/mcp\/MCPPage"/);
  assert.match(pageExport, /MCPPageEntryReportReady/);
  assert.match(entry, /McpSessionCompactView/);
  assert.match(compact, /McpSessionCompactViewFinal2/);
  assert.match(finalView, /idempotentMutationFetch/);

  for (const action of ["order", "test", "report", "followup", "status", "checkin"]) {
    assert.match(finalView, new RegExp(`session-customer\\/${action}`));
  }
});

test("the active Next proxy and gateway retain the current strangler boundary", async () => {
  const route = await readFile("src/app/api/backend/[...path]/route.ts", "utf8");
  const proxy = await readFile("src/lib/api/backend-proxy.ts", "utf8");
  const bootstrap = await readFile("apps/backend/bootstrap.js", "utf8");
  const gateway = await readFile("apps/backend/foundation/gateway.js", "utf8");

  assert.match(route, /proxyBackendRequest/);
  assert.match(proxy, /X-Backend-Token/);
  assert.match(proxy, /MCP_LEGACY_ACTOR_ID/);
  assert.match(proxy, /Idempotency-Key/);
  assert.match(bootstrap, /await import\("\.\/server\.js"\)/);
  assert.match(bootstrap, /waitForLegacyHealth/);
  assert.match(gateway, /handleOrderApi/);
  assert.match(gateway, /handleRouteApi/);
  assert.match(gateway, /handleTransitionalApi/);
  assert.match(gateway, /proxyToLegacy/);
});

test("provider-specific frontend and backend dependencies stay explicitly inventoried", async () => {
  const nextConfig = await readFile("next.config.mjs", "utf8");
  const backendConfig = await readFile("apps/backend/foundation/config.js", "utf8");
  const exportReader = await readFile("src/lib/export/supabase-rest.ts", "utf8");
  const legacyServer = await readFile("apps/backend/server.js", "utf8");

  assert.match(nextConfig, /SUPABASE_URL/);
  assert.match(nextConfig, /SUPABASE_ANON_KEY/);
  assert.match(backendConfig, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(backendConfig, /AUTH_MODE=proxy-service/);
  assert.match(exportReader, /\/rest\/v1\//);
  assert.match(legacyServer, /SUPABASE_SERVICE_ROLE_KEY/);
});

test("environment inventory contains names and classifications but no values", () => {
  const names = new Set(environment.variables.map((entry) => entry.name));
  for (const name of [
    "BACKEND_API_BASE_URL", "BACKEND_API_TOKEN", "MCP_LEGACY_ACTOR_ID",
    "SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY",
    "INSTALLATION_ID", "NPP_CODE", "CORS_ORIGINS", "R2_BUCKET_NAME",
    "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"
  ]) {
    assert.ok(names.has(name), `missing ${name}`);
  }

  for (const entry of environment.variables) {
    assert.equal("value" in entry, false, `${entry.name} must not contain a value`);
    assert.ok(["server", "server_only", "server_transitional", "backend", "backend_only", "backend_internal", "runtime"].includes(entry.exposure));
  }
});

test("identity contract preserves outlet/customer separation", () => {
  const mappings = new Map(identity.mappings.map((entry) => [`${entry.source}->${entry.target}`, entry]));
  assert.ok(mappings.has("legacy_route_customer->mcp.field_outlet"));
  assert.equal(mappings.get("mcp.field_outlet->shared.customers").nullable, true);
  assert.equal(mappings.get("mcp.field_outlet->shared.customer_addresses").nullable, true);
  assert.match(identity.forbiddenShortcuts.join("\n"), /bulk insert legacy orders/i);
  assert.match(identity.forbiddenShortcuts.join("\n"), /name only/i);
});

test("legacy orders have exactly the locked five classifications", () => {
  const expected = [
    "OFFICIAL_ORDER_MIGRATION_CANDIDATE",
    "FIELD_ORDER_INTENT",
    "SAMPLE_TEST_DEMAND",
    "HISTORICAL_DISPLAY_ONLY",
    "INVALID_ORPHAN_RECONCILIATION_REQUIRED"
  ];
  assert.deepEqual(orderClasses.classes.map((entry) => entry.code), expected);
  assert.equal(orderClasses.classificationRules.exactlyOneClassRequired, true);
  assert.equal(orderClasses.classificationRules.bulkImportForbidden, true);

  const fixtureClasses = fixture.records.map((entry) => entry.classification).sort();
  assert.deepEqual(fixtureClasses, [...expected].sort());
});

test("read-only data audit cannot contain mutation statements", () => {
  const withoutComments = auditSql.replace(/--.*$/gm, "");
  assert.match(withoutComments, /BEGIN TRANSACTION READ ONLY/i);
  assert.match(withoutComments, /ROLLBACK/i);
  assert.doesNotMatch(withoutComments, /\b(INSERT|UPDATE|DELETE|MERGE|ALTER|DROP|CREATE|TRUNCATE|GRANT|REVOKE|CALL|DO)\b/i);

  for (const table of ["mcp_routes", "mcp_route_customers", "mcp_route_sessions", "mcp_route_session_customers", "orders", "order_items"]) {
    assert.match(auditSql, new RegExp(table));
  }
});

test("reconciliation report schema and risk register cover the cutover gates", () => {
  assert.equal(reportSchema.properties.phase.const, "6C.0A");
  assert.ok(reportSchema.required.includes("checks"));
  assert.ok(reportSchema.required.includes("legacyOrderClassification"));

  const riskText = risks.risks.map((entry) => entry.risk).join("\n");
  for (const fragment of ["dual write", "legacy fallback", "provider outage", "identity collision", "ambiguous legacy order", "manual retry", "stale frontend", "service actor", "R2 object", "rollback"]) {
    assert.match(riskText, new RegExp(fragment, "i"));
  }
});

test("the audit document keeps production and runtime changes out of scope", () => {
  assert.match(auditDoc, /DOCS\/TESTS\/READ-ONLY ONLY/);
  assert.match(auditDoc, /does not authorize/i);
  assert.match(auditDoc, /Production rollout remains a separate explicitly authorized operation/);
});

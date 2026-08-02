import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const baseline = "46f43b473e35ac1103aa2b49412de3f64fe1646b";
const mcpRoot = new URL("../", import.meta.url);
const repoRoot = new URL("../../", import.meta.url);

function mcpUrl(path) {
  return new URL(path, mcpRoot);
}

function repoUrl(path) {
  return new URL(path, repoRoot);
}

async function readJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

async function exists(url) {
  await access(url);
  return true;
}

test("all Phase 6C.0A contracts use the exact audited baseline", async () => {
  const contracts = await Promise.all([
    "dependency-inventory.json",
    "environment-contract.json",
    "identity-mapping-contract.json",
    "legacy-order-classification.json",
    "risk-register.json"
  ].map((name) => readJson(mcpUrl(`audit/phase-6c0a/${name}`))));
  const auditDoc = await readFile(repoUrl("docs/operations/phase-6c0a-mcp-legacy-audit.md"), "utf8");

  for (const contract of contracts) {
    assert.equal(contract.phase, "6C.0A");
    assert.equal(contract.baseline, baseline);
  }
  assert.match(auditDoc, new RegExp(baseline));
});

test("dependency inventory is complete enough to drive the next audit", async () => {
  const inventory = await readJson(mcpUrl("audit/phase-6c0a/dependency-inventory.json"));
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
      for (const path of entry.evidenceFiles) await exists(mcpUrl(path));
    }
  }
});

test("the active UI chain remains distinct from legacy and dead-code findings", async () => {
  const visits = await readFile(mcpUrl("src/app/visits/page.tsx"), "utf8");
  const pageExport = await readFile(mcpUrl("src/features/mcp/MCPPage.tsx"), "utf8");
  const entry = await readFile(mcpUrl("src/features/mcp/MCPPageEntryReportReady.tsx"), "utf8");
  const compact = await readFile(mcpUrl("src/features/mcp/McpSessionCompactView.tsx"), "utf8");
  const finalView = await readFile(mcpUrl("src/features/mcp/McpSessionCompactViewFinal2.tsx"), "utf8");

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
  const route = await readFile(mcpUrl("src/app/api/backend/[...path]/route.ts"), "utf8");
  const proxy = await readFile(mcpUrl("src/lib/api/backend-proxy.ts"), "utf8");
  const bootstrap = await readFile(mcpUrl("apps/backend/bootstrap.js"), "utf8");
  const gateway = await readFile(mcpUrl("apps/backend/foundation/gateway.js"), "utf8");
  const persistence = await readFile(mcpUrl("apps/backend/foundation/persistence.js"), "utf8");
  const legacyRuntime = await readFile(mcpUrl("apps/backend/foundation/legacy-runtime.js"), "utf8");

  assert.match(route, /proxyBackendRequest/);
  assert.match(proxy, /X-Backend-Token/);
  assert.match(proxy, /MCP_LEGACY_ACTOR_ID/);
  assert.match(proxy, /Idempotency-Key/);
  assert.match(bootstrap, /await createPersistence\(config\)/);
  assert.match(bootstrap, /if \(config\.legacyRuntime\.enabled\)/);
  assert.match(bootstrap, /await import\("\.\/foundation\/legacy-runtime\.js"\)/);
  assert.doesNotMatch(bootstrap, /await import\("\.\/server\.js"\)/);
  assert.match(gateway, /legacyHandlers\.handleOrderApi/);
  assert.match(gateway, /legacyHandlers\.handleRouteApi/);
  assert.match(gateway, /legacyHandlers\.handleTransitionalApi/);
  assert.match(gateway, /legacyHandlers\.proxyToLegacy/);
  assert.match(gateway, /if \(!legacyHandlers\)/);
  assert.match(persistence, /await import\("\.\/legacy-supabase-adapter\.js"\)/);
  assert.match(legacyRuntime, /await import\("\.\.\/server\.js"\)/);
});

test("provider-specific frontend and compatibility dependencies stay explicitly inventoried", async () => {
  const nextConfig = await readFile(mcpUrl("next.config.mjs"), "utf8");
  const backendConfig = await readFile(mcpUrl("apps/backend/foundation/config.js"), "utf8");
  const persistence = await readFile(mcpUrl("apps/backend/foundation/persistence.js"), "utf8");
  const postgresql = await readFile(mcpUrl("apps/backend/foundation/postgresql-adapter.js"), "utf8");
  const legacyRuntime = await readFile(mcpUrl("apps/backend/foundation/legacy-runtime.js"), "utf8");
  const exportReader = await readFile(mcpUrl("src/lib/export/supabase-rest.ts"), "utf8");
  const backendRead = await readFile(mcpUrl("src/lib/api/backend-read.ts"), "utf8");
  const legacyServer = await readFile(mcpUrl("apps/backend/server.js"), "utf8");

  assert.match(nextConfig, /BACKEND_API_BASE_URL/);
  assert.match(nextConfig, /BACKEND_API_TOKEN/);
  assert.match(nextConfig, /MCP_LEGACY_ACTOR_ID/);
  assert.doesNotMatch(nextConfig, /SUPABASE_URL|SUPABASE_ANON_KEY/);
  assert.match(backendConfig, /PERSISTENCE_PROVIDER/);
  assert.match(backendConfig, /DATABASE_URL/);
  assert.match(backendConfig, /production_persistence_provider_forbidden/);
  assert.match(backendConfig, /AUTH_MODE=proxy-service/);
  assert.match(persistence, /createPostgresqlPersistence/);
  assert.match(postgresql, /new PoolImpl/);
  assert.match(legacyRuntime, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(exportReader, /backendReadRows/);
  assert.doesNotMatch(exportReader, /\/rest\/v1\//);
  assert.match(backendRead, /\/api\/read/);
  assert.match(legacyServer, /SUPABASE_SERVICE_ROLE_KEY/);
});

test("environment inventory contains names and classifications but no values", async () => {
  const environment = await readJson(mcpUrl("audit/phase-6c0a/environment-contract.json"));
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

test("identity contract preserves outlet/customer separation and installation scope", async () => {
  const identity = await readJson(mcpUrl("audit/phase-6c0a/identity-mapping-contract.json"));
  const mappings = new Map(identity.mappings.map((entry) => [`${entry.source}->${entry.target}`, entry]));

  assert.deepEqual(identity.sourceIdentityRule.key, ["installation", "legacy id"]);
  for (const mapping of identity.mappings) {
    assert.deepEqual(mapping.sourceIdentityKey, ["installation", "legacy id"]);
    assert.ok(mapping.requiredEvidence.includes("installation"), `${mapping.source}->${mapping.target} lacks installation evidence`);
  }

  assert.ok(mappings.has("legacy_route_customer->mcp.field_outlet"));
  assert.equal(mappings.get("mcp.field_outlet->shared.customers").nullable, true);
  assert.equal(mappings.get("mcp.field_outlet->shared.customer_addresses").nullable, true);
  assert.match(identity.forbiddenShortcuts.join("\n"), /bulk insert legacy orders/i);
  assert.match(identity.forbiddenShortcuts.join("\n"), /name only/i);
});

test("legacy orders and fixture have exactly the locked five classifications", async () => {
  const orderClasses = await readJson(mcpUrl("audit/phase-6c0a/legacy-order-classification.json"));
  const fixture = await readJson(mcpUrl("audit/phase-6c0a/fixtures/reconciliation-input.json"));
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
  assert.deepEqual(Object.keys(fixture.expectedSummary.byClass).sort(), [...expected].sort());
  assert.equal(fixture.expectedSummary.total, fixture.records.length);
  assert.equal(fixture.expectedSummary.unclassified, 0);
  assert.equal(
    Object.values(fixture.expectedSummary.byClass).reduce((sum, count) => sum + count, 0),
    fixture.expectedSummary.total
  );
});

test("read-only data audit binds to deployed tables and persisted retry identity", async () => {
  const auditSql = await readFile(mcpUrl("audit/phase-6c0a/read-only-data-audit.sql"), "utf8");
  const withoutComments = auditSql.replace(/--.*$/gm, "");

  assert.match(withoutComments, /BEGIN TRANSACTION READ ONLY/i);
  assert.match(withoutComments, /ROLLBACK/i);
  assert.doesNotMatch(withoutComments, /\b(INSERT|UPDATE|DELETE|MERGE|ALTER|DROP|CREATE|TRUNCATE|GRANT|REVOKE|CALL|DO)\b/i);

  for (const table of [
    "mcp_routes", "mcp_route_customers", "mcp_route_sessions",
    "mcp_session_customers", "mcp_idempotency_records", "orders", "order_items"
  ]) {
    assert.match(auditSql, new RegExp(table));
  }

  assert.doesNotMatch(auditSql, /mcp_route_session_customers/);
  assert.match(auditSql, /visit_status/);
  assert.match(auditSql, /source_type/);
  assert.match(auditSql, /source_id/);
  assert.match(auditSql, /raw_payload/);
  assert.match(auditSql, /aggregate_id/);
  assert.match(auditSql, /idempotency_key/);
  assert.match(auditSql, /lower\(btrim\(regexp_replace/i);
});

test("reconciliation report schema rejects classifications outside the locked set", async () => {
  const reportSchema = await readJson(mcpUrl("audit/phase-6c0a/reconciliation-report.schema.json"));
  const orderClasses = await readJson(mcpUrl("audit/phase-6c0a/legacy-order-classification.json"));
  const fixture = await readJson(mcpUrl("audit/phase-6c0a/fixtures/reconciliation-input.json"));
  const byClass = reportSchema.properties.legacyOrderClassification.properties.byClass;
  const expected = orderClasses.classes.map((entry) => entry.code);

  assert.equal(reportSchema.properties.phase.const, "6C.0A");
  assert.ok(reportSchema.required.includes("checks"));
  assert.ok(reportSchema.required.includes("legacyOrderClassification"));
  assert.equal(byClass.additionalProperties, false);
  assert.deepEqual(Object.keys(byClass.properties).sort(), [...expected].sort());
  assert.deepEqual(byClass.required.slice().sort(), [...expected].sort());
  assert.deepEqual(Object.keys(fixture.expectedSummary.byClass).sort(), [...expected].sort());
});

test("risk register covers the cutover gates", async () => {
  const risks = await readJson(mcpUrl("audit/phase-6c0a/risk-register.json"));
  const riskText = risks.risks.map((entry) => entry.risk).join("\n");
  for (const fragment of ["dual write", "legacy fallback", "provider outage", "identity collision", "ambiguous legacy order", "manual retry", "stale frontend", "service actor", "R2 object", "rollback"]) {
    assert.match(riskText, new RegExp(fragment, "i"));
  }
});

test("the audit document keeps production and runtime changes out of scope", async () => {
  const auditDoc = await readFile(repoUrl("docs/operations/phase-6c0a-mcp-legacy-audit.md"), "utf8");
  assert.match(auditDoc, /DOCS\/TESTS\/READ-ONLY ONLY/);
  assert.match(auditDoc, /does not authorize/i);
  assert.match(auditDoc, /Production rollout remains a separate explicitly authorized operation/);
});

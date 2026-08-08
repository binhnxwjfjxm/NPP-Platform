import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  assessCutoverReadiness,
  captureInstallationAudit,
  captureRuntimeIdentity,
  digestCutoverPlan,
  evaluateProviderPreflight,
  redactSensitiveText,
  validateCutoverPlan
} from "./provider-cutover.js";
import {
  assessPhase96Gate,
  assessPhase96RuntimeDecommission,
  buildPhase96ImportPlan,
  PHASE_96_IMPORT_POLICY,
  PHASE_96_TEST_ONLY_POLICY
} from "./phase-9-6-cutover.js";

const plan = JSON.parse(readFileSync(
  new URL("../../../audit/phase-6c0f/fixtures/cutover-plan.json", import.meta.url),
  "utf8"
));

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
}
function canonicalJson(value) { return JSON.stringify(canonicalize(value)); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function rowsDigest(rows) { return sha256([...rows].map(canonicalJson).sort().join("\n")); }
function phase95Fixture() {
  const classifications = {
    routes: [{ sourceId: "route-test", disposition: "operational_import" }],
    orders: [{ sourceId: "order-test", disposition: "reconciliation_required" }],
    session_reports: [{ sourceId: "report-test", disposition: "archive_only" }]
  };
  const findings = [{ type: "mapping_collision", entity: "routes" }];
  const flattened = Object.entries(classifications).flatMap(([entity, rows]) => rows.map((row) => ({ entity, ...row })));
  const body = {
    phase: "9.5",
    installationId: "installation-test",
    classificationCount: flattened.length,
    classificationSha256: rowsDigest(flattened),
    findingCount: findings.length,
    findingsSha256: rowsDigest(findings),
    importReady: false
  };
  const manifest = { ...body, manifestSha256: sha256(canonicalJson(body)) };
  return { manifest, classifications, findings };
}

test("draft cutover plan is structurally valid but not operationally ready", () => {
  const validation = validateCutoverPlan(plan, { expectedSourceCommit: plan.source.commit });
  assert.deepEqual(validation, { valid: true, issues: [] });
  const readiness = assessCutoverReadiness(plan, { expectedSourceCommit: plan.source.commit });
  assert.equal(readiness.ready, false);
  assert.match(readiness.blockers.join(" "), /owner_approval_missing/);
  assert.match(digestCutoverPlan(plan), /^sha256:[0-9a-f]{64}$/);
});

test("cutover plan rejects secrets, runtime migrator credentials and mutation claims", () => {
  const invalid = structuredClone(plan);
  invalid.databaseUrl = "postgresql://user:secret@example.invalid/db";
  invalid.configVariableNames.push("MCP_MIGRATION_DATABASE_URL");
  invalid.productionMutations.databaseAttached = true;
  const validation = validateCutoverPlan(invalid);
  assert.equal(validation.valid, false);
  assert.match(validation.issues.join(" "), /forbidden_sensitive/);
  assert.match(validation.issues.join(" "), /migration_credential_must_not_be_runtime_config/);
  assert.match(validation.issues.join(" "), /production_mutation_must_be_false:databaseAttached/);
});

test("sensitive diagnostics are redacted", () => {
  const raw = "postgresql://runtime:secret@example.invalid/db https://provider.invalid runtime secret example.invalid";
  const redacted = redactSensitiveText(raw, ["runtime", "secret", "example.invalid"]);
  assert.equal(redacted.includes("secret"), false);
  assert.equal(redacted.includes("runtime"), false);
  assert.equal(redacted.includes("example.invalid"), false);
  assert.match(redacted, /REDACTED/);
});

test("runtime and audit snapshots use read-only transactions", async () => {
  const runtimeQueries = [];
  const runtimeAdapter = {
    async query(sql) {
      runtimeQueries.push(sql.trim());
      if (sql.includes("current_user")) {
        return { rows: [{
          role: "mcp_runtime",
          search_path: "mcp, public",
          database_name: "installation",
          server_version: "17.1",
          ssl: true
        }] };
      }
      return { rows: [] };
    }
  };
  const identity = await captureRuntimeIdentity(runtimeAdapter);
  assert.equal(identity.role, "mcp_runtime");
  assert.deepEqual(identity.searchPath, ["mcp", "public"]);
  assert.equal(runtimeQueries[0], "BEGIN READ ONLY");
  assert.equal(runtimeQueries.at(-1), "ROLLBACK");

  const auditQueries = [];
  const auditAdapter = {
    async query(sql) {
      const compact = sql.replace(/\s+/g, " ").trim();
      auditQueries.push(compact);
      if (compact.includes("current_database() AS database_name")) {
        return { rows: [{ database_name: "installation", server_version: "17.1" }] };
      }
      if (compact.includes("FROM pg_roles")) return { rows: [{ exists: true }] };
      if (compact.includes("schema_available")) {
        return { rows: [{ schema_available: true, registry_available: true }] };
      }
      if (compact.startsWith("SELECT id FROM shared.schema_migrations")) {
        return { rows: [{ id: "mcp_001_write_foundation" }] };
      }
      if (compact.includes("idempotency_table")) {
        return { rows: [{
          idempotency_table: true,
          audit_table: true,
          outbox_table: true,
          audit_append_only_trigger: true,
          outbox_pending_index: true
        }] };
      }
      if (compact.includes("mcp_schema_usage")) {
        return { rows: [{
          mcp_schema_usage: true,
          mcp_schema_create: false,
          idempotency_select: true,
          idempotency_insert: true,
          idempotency_update: true,
          idempotency_delete: false,
          audit_select: false,
          audit_insert: true,
          audit_update: false,
          audit_delete: false,
          outbox_select: false,
          outbox_insert: true,
          outbox_update: false,
          outbox_delete: false
        }] };
      }
      return { rows: [] };
    }
  };
  const audit = await captureInstallationAudit(auditAdapter, { runtimeRole: "mcp_runtime" });
  const evaluated = evaluateProviderPreflight(
    { runtimeIdentity: identity, installationAudit: audit },
    { expectedRole: "mcp_runtime" }
  );
  assert.deepEqual(evaluated, { ready: true, issues: [] });
  assert.equal(auditQueries[0], "BEGIN READ ONLY");
  assert.equal(auditQueries.at(-1), "ROLLBACK");
});

test("over-privileged runtime role fails closed", () => {
  const snapshots = {
    runtimeIdentity: {
      databaseFingerprint: "database:aaaaaaaaaaaa",
      role: "mcp_runtime",
      searchPath: ["mcp", "public"]
    },
    installationAudit: {
      databaseFingerprint: "database:aaaaaaaaaaaa",
      runtimeRoleExists: true,
      schemaAvailable: true,
      registryAvailable: true,
      migrations: ["mcp_001_write_foundation"],
      objects: {
        idempotencyTable: true,
        auditTable: true,
        outboxTable: true,
        auditAppendOnlyTrigger: true,
        outboxPendingIndex: true
      },
      privileges: {
        mcpSchemaUsage: true,
        mcpSchemaCreate: true,
        idempotency: { select: true, insert: true, update: true, delete: true },
        audit: { select: true, insert: true, update: true, delete: true },
        outbox: { select: true, insert: true, update: true, delete: true },
        coreSchemaCreate: ["sales"],
        coreTableWrites: ["sales.sales_orders"]
      }
    }
  };
  const result = evaluateProviderPreflight(snapshots, { expectedRole: "mcp_runtime" });
  assert.equal(result.ready, false);
  assert.match(result.issues.join(" "), /runtime_has_core_table_write/);
  assert.match(result.issues.join(" "), /runtime_has_mcp_schema_create/);
});

test("Phase 9.6 owner test-only decision creates a zero-import plan bound to the exact 9.5 snapshot", () => {
  const snapshot = phase95Fixture();
  const result = buildPhase96ImportPlan({
    snapshot,
    ownerDecision: {
      policy: PHASE_96_TEST_ONLY_POLICY,
      installationId: snapshot.manifest.installationId,
      snapshotManifestSha256: snapshot.manifest.manifestSha256
    }
  });
  assert.equal(result.ready, true);
  assert.equal(result.mode, "ZERO_OPERATIONAL_IMPORT");
  assert.equal(result.counts.import, 0);
  assert.equal(result.counts.archive, 3);
  assert.equal(result.counts.reconciliationObserved, 1);
});

test("Phase 9.6 refuses stale owner decisions and tampered snapshot classifications", () => {
  const snapshot = phase95Fixture();
  const stale = buildPhase96ImportPlan({
    snapshot,
    ownerDecision: {
      policy: PHASE_96_TEST_ONLY_POLICY,
      installationId: snapshot.manifest.installationId,
      snapshotManifestSha256: "b".repeat(64)
    }
  });
  assert.equal(stale.ready, false);
  assert.match(stale.blockers.join(" "), /owner_decision_snapshot_mismatch/);

  const tampered = structuredClone(snapshot);
  tampered.classifications.routes.push({ sourceId: "route-extra", disposition: "operational_import" });
  const invalid = buildPhase96ImportPlan({
    snapshot: tampered,
    ownerDecision: {
      policy: PHASE_96_TEST_ONLY_POLICY,
      installationId: snapshot.manifest.installationId,
      snapshotManifestSha256: snapshot.manifest.manifestSha256
    }
  });
  assert.equal(invalid.ready, false);
  assert.match(invalid.blockers.join(" "), /classification/);
});

test("Phase 9.6 real-import path still honors the Phase 9.5 import gate", () => {
  const snapshot = phase95Fixture();
  const result = buildPhase96ImportPlan({
    snapshot,
    ownerDecision: {
      policy: PHASE_96_IMPORT_POLICY,
      installationId: snapshot.manifest.installationId,
      snapshotManifestSha256: snapshot.manifest.manifestSha256
    }
  });
  assert.equal(result.ready, false);
  assert.match(result.blockers.join(" "), /phase_9_5_import_not_ready/);
});

test("Phase 9.6 runtime closure requires PostgreSQL, removes legacy runtime vars and verifies bridges", () => {
  const runtime = assessPhase96RuntimeDecommission({
    persistenceProvider: "postgresql",
    configVariableNames: ["DATABASE_URL", "PERSISTENCE_PROVIDER", "INSTALLATION_ID"],
    bridgeEvidence: { customerOnboarding: true, coreSalesOrder: true, retryIdempotency: true }
  });
  assert.equal(runtime.ready, true);

  const legacy = assessPhase96RuntimeDecommission({
    persistenceProvider: "postgresql",
    configVariableNames: ["DATABASE_URL", "PERSISTENCE_PROVIDER", "SUPABASE_URL"],
    bridgeEvidence: { customerOnboarding: true, coreSalesOrder: true, retryIdempotency: true }
  });
  assert.equal(legacy.ready, false);
  assert.match(legacy.blockers.join(" "), /SUPABASE_URL/);
});

test("Phase 9.6 final gate combines data and runtime evidence", () => {
  const snapshot = phase95Fixture();
  const importPlan = buildPhase96ImportPlan({
    snapshot,
    ownerDecision: {
      policy: PHASE_96_TEST_ONLY_POLICY,
      installationId: snapshot.manifest.installationId,
      snapshotManifestSha256: snapshot.manifest.manifestSha256
    }
  });
  const runtime = assessPhase96RuntimeDecommission({
    persistenceProvider: "postgresql",
    configVariableNames: ["DATABASE_URL", "PERSISTENCE_PROVIDER"],
    bridgeEvidence: { customerOnboarding: true, coreSalesOrder: true, retryIdempotency: true }
  });
  assert.deepEqual(assessPhase96Gate({ importPlan, runtime }), { ready: true, blockers: [] });
});

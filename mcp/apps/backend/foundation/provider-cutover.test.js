import test from "node:test";
import assert from "node:assert/strict";
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

const plan = JSON.parse(readFileSync(
  new URL("../../../audit/phase-6c0f/fixtures/cutover-plan.json", import.meta.url),
  "utf8"
));

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

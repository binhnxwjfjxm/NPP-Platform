import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertRehearsalSafety,
  cryptoHash,
  reconcileLegacyOrderFixture,
  reconcileSnapshots,
  redactOperationalText,
  safeDatabaseIdentifier,
  validateRehearsalReport
} from "../apps/backend/foundation/rehearsal.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => readFileSync(path.join(repoRoot, relative), "utf8");

function errorCode(code) {
  return (error) => error?.code === code;
}

test("rehearsal safety is explicit, local by default and production confirmations are forbidden", () => {
  assert.throws(
    () => assertRehearsalSafety({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://u:p@127.0.0.1/postgres",
      MCP_MIGRATION_REHEARSAL_CONFIRM: "temporary-database"
    }),
    errorCode("production_rehearsal_forbidden")
  );
  assert.throws(
    () => assertRehearsalSafety({ NODE_ENV: "test", DATABASE_URL: "postgresql://u:p@127.0.0.1/postgres" }),
    errorCode("rehearsal_confirmation_required")
  );
  assert.throws(
    () => assertRehearsalSafety({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://u:p@127.0.0.1/postgres",
      MCP_MIGRATION_REHEARSAL_CONFIRM: "temporary-database",
      MIGRATION_PRODUCTION_CONFIRM: "forbidden-here"
    }),
    errorCode("production_confirmation_forbidden")
  );
  assert.throws(
    () => assertRehearsalSafety({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://u:p@remote.example/postgres",
      MCP_MIGRATION_REHEARSAL_CONFIRM: "temporary-database"
    }),
    errorCode("remote_rehearsal_forbidden")
  );
  const local = assertRehearsalSafety({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://u:p@127.0.0.1/postgres",
    MCP_MIGRATION_REHEARSAL_CONFIRM: "temporary-database"
  });
  assert.equal(local.hostname, "127.0.0.1");
});

test("redaction and identifiers never expose raw connection details", () => {
  const redacted = redactOperationalText(
    "postgresql://user:ci-secret@db.example/app user ci-secret db.example",
    ["user", "ci-secret", "db.example"]
  );
  assert.equal(redacted.includes("postgresql://"), false);
  assert.equal(redacted.includes("ci-secret"), false);
  assert.equal(redacted.includes("db.example"), false);
  assert.match(safeDatabaseIdentifier("sensitive-name"), /^database:[0-9a-f]{12}$/);
});

test("snapshot reconciliation fails on any migration, schema or data drift", () => {
  const snapshot = {
    migrations: ["001", "mcp_001_write_foundation"],
    tables: ["mcp.audit_events"],
    rowCounts: { "mcp.audit_events": 1 },
    checksums: { "mcp.audit_events": cryptoHash("fixture") },
    constraints: ["constraint"],
    indexes: ["index"],
    triggers: ["mcp_audit_events_append_only"]
  };
  assert.equal(reconcileSnapshots(snapshot, structuredClone(snapshot)).overallMatch, true);
  const drift = structuredClone(snapshot);
  drift.checksums["mcp.audit_events"] = cryptoHash("changed");
  assert.equal(reconcileSnapshots(snapshot, drift).overallMatch, false);
});

test("the Phase 6C.0A fixture reconciles to exactly the locked five classes", () => {
  const fixture = JSON.parse(read("mcp/audit/phase-6c0a/fixtures/reconciliation-input.json"));
  assert.deepEqual(reconcileLegacyOrderFixture(fixture), fixture.expectedSummary);
});

test("runner and workflow lock source, restore, regression, backup and no-deploy boundaries", () => {
  const runner = read("mcp/apps/backend/scripts/rehearse-mcp-migrations.js");
  assert.match(runner, /CORE_API_MIGRATIONS/);
  assert.match(runner, /runMcpMigrations/);
  assert.match(runner, /pg_dump/);
  assert.match(runner, /pg_restore/);
  assert.match(runner, /npp_mcp6c0e_source_/);
  assert.match(runner, /npp_mcp6c0e_restore_/);
  assert.match(runner, /npp_mcp6c0e_regression_/);
  assert.equal(/heroku|vercel|supabase/i.test(runner), false);

  const workflow = read(".github/workflows/phase-6c0e-mcp-migration-rehearsal.yml");
  assert.match(workflow, /postgres:17/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /MCP_MIGRATION_REHEARSAL_CONFIRM: temporary-database/);
  assert.equal(/deploy|workflow_dispatch/i.test(workflow), false);
});

test("report schema and success validator require reconciliation, append-only proof and cleanup", () => {
  const schema = JSON.parse(read("mcp/audit/phase-6c0e/rehearsal-report.schema.json"));
  assert.equal(schema.properties.phase.const, "6C.0E");
  assert.equal(schema.properties.backup.properties.sha256.pattern, "^[0-9a-f]{64}$");
  assert.equal(schema.properties.legacyOrderClassification.properties.unclassified.minimum, 0);

  const valid = validateRehearsalReport({
    schemaVersion: 1,
    phase: "6C.0E",
    sourceCommit: "local",
    startedAt: new Date().toISOString(),
    generatedAt: new Date().toISOString(),
    status: "success",
    databases: {
      source: "database:111111111111",
      restore: "database:222222222222",
      regression: "database:333333333333"
    },
    migrations: {
      source: { coreVerified: true, mcpVerified: true },
      restore: { coreVerified: true, mcpVerified: true }
    },
    backup: { format: "postgresql-custom", sha256: "a".repeat(64), sizeBytes: 1 },
    reconciliation: { overallMatch: true },
    appendOnly: { source: true, restore: true },
    legacyOrderClassification: {
      total: 5,
      byClass: {
        OFFICIAL_ORDER_MIGRATION_CANDIDATE: 1,
        FIELD_ORDER_INTENT: 1,
        SAMPLE_TEST_DEMAND: 1,
        HISTORICAL_DISPLAY_ONLY: 1,
        INVALID_ORPHAN_RECONCILIATION_REQUIRED: 1
      },
      unclassified: 0
    },
    regression: { verified: true },
    cleanup: { source: "dropped", restore: "dropped", regression: "dropped", backup: "removed" },
    errors: []
  });
  assert.deepEqual(valid, { valid: true, issues: [] });
});

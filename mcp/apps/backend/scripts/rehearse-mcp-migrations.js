import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { CORE_API_MIGRATIONS, runMigrations as runCoreMigrations } from "../../../../npp-core/api/src/migrations/index.js";
import { migrationVerifyWithAdapter as verifyCoreMigrations } from "../../../../npp-core/api/src/migrations/cli.js";
import {
  MCP_MIGRATIONS,
  migrationVerifyWithAdapter as verifyMcpMigrations,
  runMcpMigrations
} from "../foundation/migrations/index.js";
import {
  assertRehearsalSafety,
  cryptoHash,
  parseDatabaseUrl,
  reconcileLegacyOrderFixture,
  reconcileSnapshots,
  redactOperationalText,
  safeDatabaseIdentifier,
  validateRehearsalReport
} from "../foundation/rehearsal.js";

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ARTIFACTS_DIR = path.resolve(__dirname, "../../../artifacts");
export const REPORT_FILE = path.join(ARTIFACTS_DIR, "migration-rehearsal-phase-6c0e-report.json");
const LEGACY_FIXTURE_FILE = path.resolve(
  __dirname,
  "../../../audit/phase-6c0a/fixtures/reconciliation-input.json"
);

function operationalError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function randomSuffix() {
  return randomBytes(5).toString("hex");
}

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function cloneDatabaseUrl(url, databaseName) {
  const clone = new URL(url.toString());
  clone.pathname = `/${databaseName}`;
  return clone.toString();
}

function buildAdminDatabaseUrl(url) {
  return url.toString();
}

export function buildSpawnEnv(connectionString, sourceEnv = process.env) {
  const parsed = parseDatabaseUrl(connectionString);
  const env = { ...sourceEnv };
  env.PGHOST = parsed.hostname;
  env.PGPORT = parsed.port || "5432";
  env.PGUSER = decodeURIComponent(parsed.username || "");
  env.PGPASSWORD = decodeURIComponent(parsed.password || "");
  env.PGDATABASE = decodeURIComponent(parsed.pathname.slice(1));
  const sslMode = parsed.searchParams.get("sslmode");
  if (sslMode) env.PGSSLMODE = sslMode;
  delete env.DATABASE_URL;
  delete env.MIGRATION_PRODUCTION_CONFIRM;
  delete env.MIGRATION_ALLOW_PRODUCTION;
  return Object.freeze({ env, databaseName: env.PGDATABASE });
}

function runCommand(command, args, env) {
  const result = spawnSync(command, args, { env, encoding: "utf8" });
  const secrets = [env.PGHOST, env.PGUSER, env.PGPASSWORD, env.PGDATABASE];
  if (result.error) {
    throw operationalError(
      `${path.basename(command).replace(/[^a-z0-9]+/gi, "_").toLowerCase()}_start_failed`,
      redactOperationalText(result.error.message, secrets)
    );
  }
  if (result.status !== 0) {
    throw operationalError(
      `${path.basename(command).replace(/[^a-z0-9]+/gi, "_").toLowerCase()}_failed`,
      redactOperationalText(result.stderr || `${command} exited with ${result.status}`, secrets)
    );
  }
  return String(result.stdout ?? "").trim();
}

async function withPool(databaseUrl, callback) {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    return await callback(pool);
  } finally {
    await pool.end();
  }
}

async function createDatabase(adminUrl, databaseName) {
  await withPool(adminUrl, (pool) => pool.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`));
}

async function terminateConnections(adminUrl, databaseName) {
  await withPool(adminUrl, (pool) =>
    pool.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      [databaseName]
    )
  );
}

async function dropDatabase(adminUrl, databaseName) {
  await terminateConnections(adminUrl, databaseName);
  await withPool(adminUrl, (pool) => pool.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`));
}

async function applyAndVerifyMigrations(databaseUrl, { expectFresh }) {
  return withPool(databaseUrl, async (pool) => {
    const coreFirst = await runCoreMigrations(pool, CORE_API_MIGRATIONS);
    const mcpFirst = await runMcpMigrations(pool, MCP_MIGRATIONS);
    const coreSecond = await runCoreMigrations(pool, CORE_API_MIGRATIONS);
    const mcpSecond = await runMcpMigrations(pool, MCP_MIGRATIONS);
    const coreVerification = await verifyCoreMigrations(pool);
    const mcpVerification = await verifyMcpMigrations(pool);

    if (coreVerification.verified !== true) {
      throw operationalError("core_migration_verification_failed", coreVerification.issues.join("; "));
    }
    if (mcpVerification.verified !== true) {
      throw operationalError("mcp_migration_verification_failed", mcpVerification.issues.join("; "));
    }
    if (coreSecond.applied.length || mcpSecond.applied.length) {
      throw operationalError("migration_second_run_not_noop");
    }
    if (expectFresh && (!coreFirst.applied.length || mcpFirst.applied.length !== MCP_MIGRATIONS.length)) {
      throw operationalError("fresh_migration_apply_incomplete");
    }
    if (!expectFresh && (coreFirst.applied.length || mcpFirst.applied.length)) {
      throw operationalError("restored_migration_registry_not_noop");
    }

    return Object.freeze({
      coreFirstApplied: Object.freeze([...coreFirst.applied]),
      mcpFirstApplied: Object.freeze([...mcpFirst.applied]),
      coreSecondApplied: Object.freeze([...coreSecond.applied]),
      mcpSecondApplied: Object.freeze([...mcpSecond.applied]),
      coreVerified: true,
      mcpVerified: true
    });
  });
}

async function seedMcpFixture(databaseUrl) {
  return withPool(databaseUrl, async (pool) => {
    const eventId = randomUUID();
    const idempotencyId = randomUUID();
    const installationId = "fixture-installation";
    const requestId = "fixture-request";
    const actorId = "fixture-actor";
    const key = `fixture-${randomSuffix()}`;
    const fingerprint = createHash("sha256").update("phase-6c0e-fixture").digest("hex");
    const occurredAt = "2026-08-02T00:00:00.000Z";

    await pool.query(
      `INSERT INTO mcp.idempotency_records (
         id, installation_id, command_name, idempotency_key, fingerprint,
         state, request_id, actor_id, response, completed_at
       ) VALUES ($1,$2,$3,$4,$5,'completed',$6,$7,$8::jsonb,$9::timestamptz)`,
      [
        idempotencyId,
        installationId,
        "mcp.rehearsal.create",
        key,
        fingerprint,
        requestId,
        actorId,
        JSON.stringify({ data: { fixture: true } }),
        occurredAt
      ]
    );

    const eventValues = [
      eventId,
      "mcp.rehearsal.created",
      "rehearsal",
      "fixture-aggregate",
      1,
      installationId,
      actorId,
      "service",
      requestId,
      key,
      "phase-6c0e-rehearsal",
      occurredAt,
      JSON.stringify({ fixture: true })
    ];

    await pool.query(
      `INSERT INTO mcp.audit_events (
         event_id, event_type, aggregate_type, aggregate_id, aggregate_version,
         installation_id, actor_id, actor_type, request_id, idempotency_key,
         source, action, permission, occurred_at, payload
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'mcp.rehearsal.create','mcp.rehearsal.write',$12::timestamptz,$13::jsonb)`,
      eventValues
    );

    await pool.query(
      `INSERT INTO mcp.outbox_events (
         event_id, event_type, aggregate_type, aggregate_id, aggregate_version,
         installation_id, actor_id, actor_type, request_id, idempotency_key,
         source, occurred_at, payload
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::timestamptz,$13::jsonb)`,
      eventValues
    );

    return Object.freeze({ eventId, idempotencyId });
  });
}

async function verifyAuditAppendOnly(databaseUrl) {
  return withPool(databaseUrl, async (pool) => {
    const result = await pool.query("SELECT event_id FROM mcp.audit_events ORDER BY created_at LIMIT 1");
    const eventId = result.rows?.[0]?.event_id;
    if (!eventId) throw operationalError("audit_fixture_missing");
    try {
      await pool.query("UPDATE mcp.audit_events SET action = 'tampered' WHERE event_id = $1", [eventId]);
    } catch (error) {
      if (error?.code === "55000" && String(error.message || "").includes("mcp_audit_events_append_only")) {
        return true;
      }
      throw error;
    }
    return false;
  });
}

async function captureSnapshot(databaseUrl) {
  return withPool(databaseUrl, async (pool) => {
    const migrationResult = await pool.query("SELECT id FROM shared.schema_migrations ORDER BY id");
    const tableResult = await pool.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'mcp' ORDER BY tablename"
    );
    const tables = (tableResult.rows ?? []).map((row) => `mcp.${row.tablename}`);
    const rowCounts = {};
    const checksums = {};
    for (const table of tables) {
      const quoted = table.split(".").map(quoteIdentifier).join(".");
      const count = await pool.query(`SELECT COUNT(1)::integer AS count FROM ${quoted}`);
      const rows = await pool.query(
        `SELECT to_jsonb(t)::text AS row_text FROM ${quoted} t ORDER BY to_jsonb(t)::text`
      );
      rowCounts[table] = Number(count.rows?.[0]?.count || 0);
      checksums[table] = cryptoHash((rows.rows ?? []).map((row) => row.row_text).join("|"));
    }

    const constraints = await pool.query(
      `SELECT c.conname
       FROM pg_constraint c
       JOIN pg_namespace n ON n.oid = c.connamespace
       WHERE n.nspname = 'mcp'
       ORDER BY c.conname`
    );
    const indexes = await pool.query(
      "SELECT indexname FROM pg_indexes WHERE schemaname = 'mcp' ORDER BY indexname"
    );
    const triggers = await pool.query(
      `SELECT g.tgname
       FROM pg_trigger g
       JOIN pg_class t ON t.oid = g.tgrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE n.nspname = 'mcp' AND NOT g.tgisinternal
       ORDER BY g.tgname`
    );
    const version = await pool.query("SELECT version() AS version");

    return Object.freeze({
      serverVersion: String(version.rows?.[0]?.version || "unknown"),
      migrations: Object.freeze((migrationResult.rows ?? []).map((row) => String(row.id))),
      tables: Object.freeze(tables),
      rowCounts: Object.freeze(rowCounts),
      checksums: Object.freeze(checksums),
      constraints: Object.freeze((constraints.rows ?? []).map((row) => String(row.conname))),
      indexes: Object.freeze((indexes.rows ?? []).map((row) => String(row.indexname))),
      triggers: Object.freeze((triggers.rows ?? []).map((row) => String(row.tgname)))
    });
  });
}

function backupDatabase(sourceUrl, backupPath, env) {
  const { env: spawnEnv } = buildSpawnEnv(sourceUrl, env);
  const command = env.MCP_PG_DUMP_BIN || "pg_dump";
  runCommand(command, ["--format=custom", "--no-owner", "--no-acl", "--file", backupPath], spawnEnv);
}

function restoreDatabase(restoreUrl, backupPath, env) {
  const { env: spawnEnv, databaseName } = buildSpawnEnv(restoreUrl, env);
  const command = env.MCP_PG_RESTORE_BIN || "pg_restore";
  runCommand(
    command,
    ["--no-owner", "--no-acl", "--exit-on-error", "--dbname", databaseName, backupPath],
    spawnEnv
  );
}

function backupChecksum(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function sanitizeError(error, secrets) {
  return Object.freeze({
    code: String(error?.code || "UNKNOWN_ERROR"),
    message: redactOperationalText(error?.message || error, secrets)
  });
}

async function cleanupResources({ adminUrl, names, created, backupPath, report, secrets }) {
  for (const key of ["restore", "regression", "source"]) {
    if (!created[key]) continue;
    try {
      await dropDatabase(adminUrl, names[key]);
      report.cleanup[key] = "dropped";
    } catch (error) {
      report.cleanup[key] = "failed";
      report.errors.push(sanitizeError(error, secrets));
    }
  }
  if (existsSync(backupPath)) {
    try {
      rmSync(backupPath, { force: true });
      report.cleanup.backup = "removed";
    } catch (error) {
      report.cleanup.backup = "failed";
      report.errors.push(sanitizeError(error, secrets));
    }
  }
}

export async function runMcpMigrationRehearsal(env = process.env) {
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  const report = {
    schemaVersion: 1,
    phase: "6C.0E",
    sourceCommit: /^[0-9a-f]{40}$/.test(String(env.MCP_REHEARSAL_SOURCE_COMMIT || env.GITHUB_SHA || ""))
      ? String(env.MCP_REHEARSAL_SOURCE_COMMIT || env.GITHUB_SHA)
      : "local",
    startedAt: new Date().toISOString(),
    generatedAt: null,
    status: "failure",
    databases: {},
    migrations: {},
    backup: null,
    reconciliation: null,
    appendOnly: { source: false, restore: false },
    legacyOrderClassification: null,
    regression: null,
    cleanup: { source: "not-created", restore: "not-created", regression: "not-created", backup: "not-created" },
    errors: []
  };

  let adminUrl;
  let secrets = [];
  const names = {
    source: `npp_mcp6c0e_source_${randomSuffix()}`,
    restore: `npp_mcp6c0e_restore_${randomSuffix()}`,
    regression: `npp_mcp6c0e_regression_${randomSuffix()}`
  };
  const created = { source: false, restore: false, regression: false };
  const backupPath = path.join(ARTIFACTS_DIR, `migration-rehearsal-phase-6c0e-${randomSuffix()}.dump`);

  try {
    const suppliedUrl = assertRehearsalSafety(env);
    adminUrl = buildAdminDatabaseUrl(suppliedUrl);
    secrets = [
      suppliedUrl.username,
      suppliedUrl.password,
      suppliedUrl.hostname,
      decodeURIComponent(suppliedUrl.username || ""),
      decodeURIComponent(suppliedUrl.password || "")
    ].filter(Boolean);

    report.databases = Object.freeze({
      source: safeDatabaseIdentifier(names.source),
      restore: safeDatabaseIdentifier(names.restore),
      regression: safeDatabaseIdentifier(names.regression)
    });

    await createDatabase(adminUrl, names.source);
    created.source = true;
    report.cleanup.source = "pending";
    const sourceUrl = cloneDatabaseUrl(suppliedUrl, names.source);
    const sourceMigrations = await applyAndVerifyMigrations(sourceUrl, { expectFresh: true });
    await seedMcpFixture(sourceUrl);
    report.appendOnly.source = await verifyAuditAppendOnly(sourceUrl);
    if (!report.appendOnly.source) throw operationalError("source_append_only_not_enforced");
    const sourceSnapshot = await captureSnapshot(sourceUrl);

    backupDatabase(sourceUrl, backupPath, env);
    report.cleanup.backup = "pending";
    report.backup = Object.freeze({
      format: "postgresql-custom",
      sha256: backupChecksum(backupPath),
      sizeBytes: statSync(backupPath).size
    });

    await createDatabase(adminUrl, names.restore);
    created.restore = true;
    report.cleanup.restore = "pending";
    const restoreUrl = cloneDatabaseUrl(suppliedUrl, names.restore);
    restoreDatabase(restoreUrl, backupPath, env);
    const restoreMigrations = await applyAndVerifyMigrations(restoreUrl, { expectFresh: false });
    report.appendOnly.restore = await verifyAuditAppendOnly(restoreUrl);
    if (!report.appendOnly.restore) throw operationalError("restore_append_only_not_enforced");
    const restoreSnapshot = await captureSnapshot(restoreUrl);
    const reconciliation = reconcileSnapshots(sourceSnapshot, restoreSnapshot);
    if (!reconciliation.overallMatch) throw operationalError("source_restore_reconciliation_failed");

    await createDatabase(adminUrl, names.regression);
    created.regression = true;
    report.cleanup.regression = "pending";
    const regressionUrl = cloneDatabaseUrl(suppliedUrl, names.regression);
    const regressionMigrations = await applyAndVerifyMigrations(regressionUrl, { expectFresh: true });

    const fixture = JSON.parse(readFileSync(LEGACY_FIXTURE_FILE, "utf8"));
    const legacyOrderClassification = reconcileLegacyOrderFixture(fixture);

    report.migrations = Object.freeze({ source: sourceMigrations, restore: restoreMigrations });
    report.reconciliation = reconciliation;
    report.legacyOrderClassification = legacyOrderClassification;
    report.regression = Object.freeze({ migrations: regressionMigrations, verified: true });
    report.postgresql = Object.freeze({ serverVersion: sourceSnapshot.serverVersion });
  } catch (error) {
    report.errors.push(sanitizeError(error, secrets));
  } finally {
    if (adminUrl) {
      await cleanupResources({ adminUrl, names, created, backupPath, report, secrets });
    } else if (existsSync(backupPath)) {
      try {
        rmSync(backupPath, { force: true });
        report.cleanup.backup = "removed";
      } catch (error) {
        report.cleanup.backup = "failed";
        report.errors.push(sanitizeError(error, secrets));
      }
    }
    report.generatedAt = new Date().toISOString();
    report.status = report.errors.length === 0 ? "success" : "failure";
    const validation = validateRehearsalReport(report);
    if (!validation.valid) {
      report.status = "failure";
      report.errors.push({ code: "invalid_rehearsal_report", message: validation.issues.join(", ") });
    }
    writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  return Object.freeze(report);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isMain) {
  const report = await runMcpMigrationRehearsal(process.env);
  process.stdout.write(
    `${JSON.stringify({ phase: report.phase, status: report.status, report: path.relative(process.cwd(), REPORT_FILE) })}\n`
  );
  if (report.status !== "success") process.exitCode = 1;
}

#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_TARGET_SCOPED_MIGRATION = "20260722060000_add_target_scoped_archive_proof_claims.sql";
const LEGACY_BASELINE_MAX_VERSION = "20260720224600_preserve_archive_terminal_failure.sql";
const HISTORY_TABLE_SQL = `
create table if not exists public.mcp_schema_migrations (
  version text primary key,
  checksum_sha256 text not null,
  applied_at timestamptz not null default now(),
  constraint mcp_schema_migrations_checksum_check check (checksum_sha256 ~ '^[0-9a-f]{64}$')
);
revoke all on table public.mcp_schema_migrations from public, anon, authenticated;
`;
const BASELINE_SENTINEL_SQL = `
select case
  when to_regprocedure('public.mcp_claim_archive_intent(text,text,text,text,text,jsonb,jsonb)') is not null
   and to_regprocedure('public.mcp_claim_archive_intent_unlocked(text,text,text,text,text,jsonb,jsonb)') is not null
   and to_regprocedure('public.mcp_finish_archive_intent(text,text,boolean,integer,jsonb,text,jsonb)') is not null
   and to_regprocedure('public.mcp_finish_archive_intent_mutable(text,text,boolean,integer,jsonb,text,jsonb)') is not null
  then 'baseline_ok'
  else ''
end;
`;
const POSTGREST_SCHEMA_RELOAD_SQL = "notify pgrst, 'reload schema';";

class MigrationError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fail(code) {
  throw new MigrationError(code);
}

function parseEnv(text) {
  const env = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const normalized = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const match = normalized.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[match[1]] = value;
  }
  return env;
}

function pgEnv(databaseUrl) {
  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    fail("migration_database_url_invalid");
  }
  if (!/^postgres(?:ql)?:$/.test(url.protocol) || !url.hostname || !url.pathname || url.pathname === "/" || !url.username) {
    fail("migration_database_url_invalid");
  }
  return {
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGSSLMODE: url.searchParams.get("sslmode") || "require"
  };
}

function spawnPsql(sql, env) {
  const result = spawnSync("psql", ["-v", "ON_ERROR_STOP=1", "-X", "-q", "-t", "-A"], {
    input: sql,
    encoding: "utf8",
    env: { PATH: process.env.PATH || "/usr/bin:/bin", ...env },
    stdio: ["pipe", "pipe", "pipe"]
  });
  if (result.status !== 0) fail("migration_psql_failed");
  return String(result.stdout || "").trim();
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function canRunTransactionally(sql) {
  return !/(?:^|\n)\s*(?:create\s+database|alter\s+system|vacuum|reindex\s+database|cluster\s+\w|create\s+index\s+concurrently|drop\s+index\s+concurrently)\b/i.test(sql);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function verifyTargetScopedCapability(env, { fetchImpl = fetch, sleep = delay } = {}) {
  const supabaseUrl = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
  const serviceRole = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const installationId = String(
    env.INSTALLATION_ID || env.MCP_INSTALLATION_ID || env.NPP_F05_EXPECTED_INSTALLATION_ID || ""
  ).trim();
  if (!supabaseUrl || !serviceRole || !installationId) fail("migration_capability_env_missing");

  let endpoint;
  try {
    endpoint = new URL(`${supabaseUrl}/rest/v1/rpc/mcp_f05_archive_proof_capabilities`);
  } catch {
    fail("migration_capability_endpoint_invalid");
  }

  const retryDelaysMs = [0, 250, 500, 1000, 2000];
  let sawSuccessfulHttpResponse = false;
  for (const waitMs of retryDelaysMs) {
    if (waitMs > 0) await sleep(waitMs);
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        apikey: serviceRole,
        Authorization: `Bearer ${serviceRole}`
      },
      body: JSON.stringify({
        p_installation_id: installationId,
        p_context: { requestId: "pullmcp-migration-capability-check" }
      })
    }).catch(() => null);

    if (!response?.ok) continue;
    sawSuccessfulHttpResponse = true;
    const payload = await response.json().catch(() => null);
    if (
      payload?.targetScopedMediaClaim === true
      && payload?.targetScopedDeleteJobClaim === true
      && payload?.broadBatchClaimsForbidden === true
    ) {
      return;
    }
  }

  fail(sawSuccessfulHttpResponse ? "migration_capability_rpc_invalid" : "migration_capability_rpc_failed");
}

async function readMigrationFiles(migrationsDir) {
  const versions = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
  return Promise.all(versions.map(async (file) => {
    const sql = await readFile(join(migrationsDir, file), "utf8");
    return {
      version: basename(file),
      sql,
      checksum: createHash("sha256").update(sql).digest("hex")
    };
  }));
}

function bootstrapLegacyHistory({ files, psql, connectionEnv, log }) {
  const rawCount = psql("select count(*)::text from public.mcp_schema_migrations;", connectionEnv);
  if (!/^\d+$/.test(rawCount)) fail("migration_history_count_invalid");
  const historyCount = Number(rawCount);
  if (historyCount !== 0) return historyCount;

  const legacyFiles = files.filter(({ version }) => version < REQUIRED_TARGET_SCOPED_MIGRATION);
  const lastLegacyVersion = legacyFiles.at(-1)?.version || "";
  if (lastLegacyVersion !== LEGACY_BASELINE_MAX_VERSION) fail("migration_baseline_manifest_changed");

  const sentinel = psql(BASELINE_SENTINEL_SQL, connectionEnv);
  if (sentinel !== "baseline_ok") fail("migration_baseline_unverified");

  if (legacyFiles.length > 0) {
    const values = legacyFiles
      .map(({ version, checksum }) => `(${sqlLiteral(version)}, ${sqlLiteral(checksum)})`)
      .join(",\n");
    psql(
      `begin;\ninsert into public.mcp_schema_migrations(version, checksum_sha256) values\n${values};\ncommit;`,
      connectionEnv
    );
  }
  log(`migration_baseline_adopted:${legacyFiles.length}`);
  return legacyFiles.length;
}

async function applySupabaseMigrations({
  envPath,
  migrationsDir,
  psql = spawnPsql,
  fetchImpl = fetch,
  sleep = delay,
  log = console.log
}) {
  if (!envPath || !migrationsDir) fail("migration_usage_error");
  const env = parseEnv(await readFile(envPath, "utf8").catch(() => fail("migration_env_read_failed")));
  const databaseUrl = String(env.DATABASE_URL || "").trim();
  if (!databaseUrl) fail("migration_database_url_missing");
  const connectionEnv = pgEnv(databaseUrl);

  psql(HISTORY_TABLE_SQL, connectionEnv);

  const files = await readMigrationFiles(migrationsDir);
  const versions = files.map(({ version }) => version);
  if (!versions.includes(LEGACY_BASELINE_MAX_VERSION)) fail("migration_baseline_sql_missing");
  if (!versions.includes(REQUIRED_TARGET_SCOPED_MIGRATION)) fail("migration_target_scoped_sql_missing");

  const historyRowCount = bootstrapLegacyHistory({ files, psql, connectionEnv, log });

  const states = files.map((file) => ({
    ...file,
    existing: psql(
      `select checksum_sha256 from public.mcp_schema_migrations where version = ${sqlLiteral(file.version)};`,
      connectionEnv
    )
  }));

  const knownAppliedCount = states.filter(({ existing }) => Boolean(existing)).length;
  if (knownAppliedCount !== historyRowCount) fail("migration_history_unknown_version");

  let pendingSeen = false;
  for (const { version, checksum, existing } of states) {
    if (!existing) {
      pendingSeen = true;
      continue;
    }
    if (pendingSeen) fail(`migration_history_gap:${version}`);
    if (existing !== checksum) fail(`migration_checksum_mismatch:${version}`);
  }

  for (const { version, sql, checksum, existing } of states) {
    if (existing) {
      log(`migration_skip_equal_checksum:${version}`);
      continue;
    }

    const historyInsert = `insert into public.mcp_schema_migrations(version, checksum_sha256) values (${sqlLiteral(version)}, ${sqlLiteral(checksum)});`;
    if (canRunTransactionally(sql)) {
      psql(`begin;\n${sql}\n${historyInsert}\ncommit;`, connectionEnv);
    } else {
      psql(sql, connectionEnv);
      psql(historyInsert, connectionEnv);
    }
    log(`migration_applied:${version}`);
  }

  psql(POSTGREST_SCHEMA_RELOAD_SQL, connectionEnv);
  await verifyTargetScopedCapability(env, { fetchImpl, sleep });
  log("migration_capability=target_scoped_archive_proof_ok");
}

async function main() {
  await applySupabaseMigrations({ envPath: process.argv[2], migrationsDir: process.argv[3] });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof MigrationError ? error.code : "migration_runner_failed");
    process.exit(1);
  });
}

export {
  applySupabaseMigrations,
  bootstrapLegacyHistory,
  canRunTransactionally,
  parseEnv,
  pgEnv,
  verifyTargetScopedCapability
};

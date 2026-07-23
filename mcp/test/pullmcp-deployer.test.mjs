import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applySupabaseMigrations } from "../ops/apply-supabase-migrations.mjs";

const script = await readFile(new URL("../ops/pullmcp", import.meta.url), "utf8");
const migrationRunner = await readFile(new URL("../ops/apply-supabase-migrations.mjs", import.meta.url), "utf8");
const PRIOR_BASELINE = "20260720224500_lock_archive_intent_claims.sql";
const BASELINE = "20260720224600_preserve_archive_terminal_failure.sql";
const TARGET = "20260722060000_add_target_scoped_archive_proof_claims.sql";

function position(fragment) {
  const index = script.indexOf(fragment);
  assert.notEqual(index, -1, `missing deploy fragment: ${fragment}`);
  return index;
}

async function runnerFixture({
  env = {},
  migrations = {},
  applied = {},
  baselineVerified = true,
  capabilityResponses = [{ ok: true, payload: { targetScopedMediaClaim: true, targetScopedDeleteJobClaim: true, broadBatchClaimsForbidden: true } }]
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "pullmcp-migrations-"));
  const envPath = join(root, ".env");
  const migrationsDir = join(root, "migrations");
  await mkdir(migrationsDir);
  const envValues = {
    DATABASE_URL: "postgres://deploy:secret@db.example.test:5432/mcp?sslmode=require",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
    INSTALLATION_ID: "installation-production",
    ...env
  };
  await writeFile(envPath, Object.entries(envValues).map(([key, value]) => `${key}=${value}`).join("\n"));

  const migrationFiles = {
    [PRIOR_BASELINE]: "select 'legacy prior baseline';",
    [BASELINE]: "select 'legacy baseline';",
    [TARGET]: "select 'target migration';",
    ...migrations
  };
  for (const [file, sql] of Object.entries(migrationFiles)) {
    await writeFile(join(migrationsDir, file), sql);
  }

  const history = new Map(Object.entries(applied));
  const psqlCalls = [];
  const events = [];
  const psql = (sql, pgEnv) => {
    psqlCalls.push({ sql, pgEnv });
    events.push({ type: "psql", sql });
    if (/select count\(\*\)::text from public\.mcp_schema_migrations/.test(sql)) {
      return String(history.size);
    }
    if (/to_regprocedure\('public\.mcp_claim_archive_intent/.test(sql)) {
      return baselineVerified ? "baseline_ok" : "";
    }
    if (/select checksum_sha256 from public\.mcp_schema_migrations/.test(sql)) {
      const version = sql.match(/version = '([^']+)'/)?.[1];
      return history.get(version) || "";
    }
    const inserts = sql.matchAll(/\('([^']+\.sql)', '([0-9a-f]{64})'\)/g);
    for (const match of inserts) history.set(match[1], match[2]);
    return "";
  };

  const fetchCalls = [];
  let responseIndex = 0;
  const fetchImpl = async (url, init) => {
    fetchCalls.push({ url: String(url), init });
    events.push({ type: "fetch" });
    const selected = capabilityResponses[Math.min(responseIndex, capabilityResponses.length - 1)];
    responseIndex += 1;
    return {
      ok: selected.ok,
      status: selected.status || (selected.ok ? 200 : 404),
      json: async () => selected.payload ?? null
    };
  };
  const sleeps = [];
  const logs = [];
  const sleep = async (ms) => sleeps.push(ms);

  return {
    envPath,
    migrationsDir,
    history,
    psqlCalls,
    fetchCalls,
    sleeps,
    logs,
    events,
    run: () => applySupabaseMigrations({
      envPath,
      migrationsDir,
      psql,
      fetchImpl,
      sleep,
      log: (line) => logs.push(line)
    })
  };
}

test("pullmcp verifies source and migrations before any runtime swap", () => {
  const verifySource = position('npm --prefix apps/backend run verify');
  const migrate = position('node "$SOURCE/ops/apply-supabase-migrations.mjs"');
  const stage = position('cp -a "$SOURCE/apps/backend/." "$STAGE/"');
  const swap = position('mv "$RUNTIME" "$BACKUP"');
  assert.ok(verifySource < migrate);
  assert.ok(migrate < stage);
  assert.ok(migrate < swap);
});

test("pullmcp is pinned to mcp-plan-backend and never mutates milktea", () => {
  assert.match(script, /PM2_NAME="mcp-plan-backend"/);
  assert.doesNotMatch(script, /MCP_PLAN_PM2_NAME|milktea-backend|pm2\s+(?:delete|restart|stop|reload)\s+2\b/i);
  assert.doesNotMatch(script, /\b3002\b/);
});

test("migration history is private and first-run bootstrap adopts verified legacy files", async () => {
  assert.match(migrationRunner, /revoke all on table public\.mcp_schema_migrations from public, anon, authenticated/);
  assert.match(migrationRunner, /mcp_finish_archive_intent_mutable/);
  const fixture = await runnerFixture({
    migrations: { "20260723000000_future.sql": "select 'future migration';" }
  });

  await fixture.run();

  assert.ok(fixture.logs.includes("migration_baseline_adopted:2"));
  assert.ok(fixture.logs.includes(`migration_applied:${TARGET}`));
  assert.ok(fixture.logs.includes("migration_applied:20260723000000_future.sql"));
  assert.equal(fixture.psqlCalls.filter(({ sql }) => sql.includes("select 'legacy prior baseline';")).length, 0);
  assert.equal(fixture.psqlCalls.filter(({ sql }) => sql.includes("select 'legacy baseline';")).length, 0);
  assert.ok(fixture.history.has(PRIOR_BASELINE));
  assert.ok(fixture.history.has(BASELINE));
  assert.ok(fixture.history.has(TARGET));
  assert.ok(fixture.psqlCalls.some(({ sql }) => sql === "notify pgrst, 'reload schema';"));
});

test("first-run bootstrap fails closed when the deployed legacy sentinel is absent", async () => {
  const fixture = await runnerFixture({ baselineVerified: false });
  await assert.rejects(fixture.run(), /migration_baseline_unverified/);
  assert.equal(fixture.fetchCalls.length, 0);
  assert.equal(fixture.psqlCalls.filter(({ sql }) => sql.includes("target migration")).length, 0);
});

test("first-run bootstrap rejects an unreviewed historical migration inserted after the locked baseline", async () => {
  const fixture = await runnerFixture({
    migrations: { "20260721000000_unreviewed.sql": "select 'unreviewed';" }
  });
  await assert.rejects(fixture.run(), /migration_baseline_manifest_changed/);
  assert.equal(fixture.fetchCalls.length, 0);
});

test("equal checksums skip SQL and checksum drift fails before capability verification", async () => {
  const priorBaselineSql = "select 'legacy prior baseline';";
  const baselineSql = "select 'legacy baseline';";
  const targetSql = "select 'target migration';";
  const priorBaselineChecksum = createHash("sha256").update(priorBaselineSql).digest("hex");
  const baselineChecksum = createHash("sha256").update(baselineSql).digest("hex");
  const targetChecksum = createHash("sha256").update(targetSql).digest("hex");
  const equal = await runnerFixture({
    applied: {
      [PRIOR_BASELINE]: priorBaselineChecksum,
      [BASELINE]: baselineChecksum,
      [TARGET]: targetChecksum
    }
  });
  await equal.run();
  assert.equal(equal.psqlCalls.filter(({ sql }) => sql.includes(targetSql)).length, 0);
  assert.ok(equal.logs.includes(`migration_skip_equal_checksum:${TARGET}`));

  const drift = await runnerFixture({
    applied: {
      [PRIOR_BASELINE]: priorBaselineChecksum,
      [BASELINE]: baselineChecksum,
      [TARGET]: "0".repeat(64)
    }
  });
  await assert.rejects(drift.run(), new RegExp(`migration_checksum_mismatch:${TARGET.replaceAll(".", "\\.")}`));
  assert.equal(drift.fetchCalls.length, 0);
});

test("migration history gaps and unknown versions fail before executing pending SQL", async () => {
  const baselineSql = "select 'legacy baseline';";
  const targetSql = "select 'target migration';";
  const gap = await runnerFixture({
    applied: { [TARGET]: createHash("sha256").update(targetSql).digest("hex") }
  });
  await assert.rejects(gap.run(), new RegExp(`migration_history_gap:${TARGET.replaceAll(".", "\\.")}`));
  assert.equal(gap.psqlCalls.filter(({ sql }) => sql.includes(baselineSql)).length, 0);

  const unknown = await runnerFixture({ applied: { "20990101000000_unknown.sql": "a".repeat(64) } });
  await assert.rejects(unknown.run(), /migration_history_unknown_version/);
  assert.equal(unknown.fetchCalls.length, 0);
});

test("capability verification uses INSTALLATION_ID and retries after schema reload", async () => {
  const fixture = await runnerFixture({
    capabilityResponses: [
      { ok: false, status: 404 },
      { ok: false, status: 404 },
      { ok: true, payload: { targetScopedMediaClaim: true, targetScopedDeleteJobClaim: true, broadBatchClaimsForbidden: true } }
    ]
  });

  await fixture.run();

  assert.equal(fixture.fetchCalls.length, 3);
  assert.deepEqual(fixture.sleeps, [250, 500]);
  const request = JSON.parse(fixture.fetchCalls[0].init.body);
  assert.equal(request.p_installation_id, "installation-production");
  const reloadIndex = fixture.events.findIndex((event) => event.type === "psql" && event.sql === "notify pgrst, 'reload schema';");
  const fetchIndex = fixture.events.findIndex((event) => event.type === "fetch");
  assert.ok(reloadIndex !== -1 && reloadIndex < fetchIndex);
});

test("runner redacts credentials and fails before database calls when DATABASE_URL is missing", async () => {
  assert.doesNotMatch(migrationRunner, /console\.(?:log|error)\([^)]*(?:PGPASSWORD|serviceRole|SUPABASE_SERVICE_ROLE_KEY|databaseUrl|stderr|stdout|sql)/i);
  const fixture = await runnerFixture({ env: { DATABASE_URL: "" } });
  await assert.rejects(fixture.run(), /migration_database_url_missing/);
  assert.equal(fixture.psqlCalls.length, 0);
  assert.equal(fixture.fetchCalls.length, 0);
});

async function makeExecutable(path, content) {
  await writeFile(path, content, { mode: 0o755 });
}

test("a migration failure leaves the runtime untouched and performs no PM2 mutation", async () => {
  const root = await mkdtemp(join(tmpdir(), "pullmcp-fail-closed-"));
  const source = join(root, "source");
  const runtime = join(root, "runtime");
  const fakeBin = join(root, "bin");
  const mutationLog = join(root, "pm2-mutations.log");

  await mkdir(join(source, ".git"), { recursive: true });
  await mkdir(join(source, "apps/backend/foundation"), { recursive: true });
  await mkdir(join(source, "supabase/migrations"), { recursive: true });
  await mkdir(join(source, "ops/systemd"), { recursive: true });
  await mkdir(runtime, { recursive: true });
  await mkdir(fakeBin, { recursive: true });

  await writeFile(join(source, "apps/backend/package.json"), '{"type":"module"}');
  await writeFile(join(source, "apps/backend/bootstrap.js"), "");
  await writeFile(join(source, "apps/backend/server.js"), "");
  await writeFile(join(source, "apps/backend/foundation/config.js"), "export function loadFoundationConfig(){ return { publicPort: 3001, internalPort: 3999 }; }\n");
  await writeFile(join(source, "supabase/migrations/20260715101500_add_atomic_session_customer_mutations.sql"), "select 1;");
  await writeFile(join(source, `supabase/migrations/${TARGET}`), "select 1;");
  await writeFile(join(source, "ops/apply-supabase-migrations.mjs"), "process.exit(1);\n");
  for (const relative of [
    "ops/install-outlet-media-cleanup-timer.sh",
    "ops/run-outlet-media-cleanup.sh",
    "ops/systemd/mcp-outlet-media-cleanup.service",
    "ops/systemd/mcp-outlet-media-cleanup.timer"
  ]) {
    await writeFile(join(source, relative), "");
  }
  await writeFile(join(runtime, ".env"), "DATABASE_URL=postgres://deploy:secret@db.example.test:5432/mcp\n");
  await writeFile(join(runtime, "runtime-marker"), "original");
  await writeFile(mutationLog, "");

  for (const command of ["git", "npm", "curl", "ss", "psql"]) {
    await makeExecutable(join(fakeBin, command), "#!/usr/bin/env bash\nexit 0\n");
  }
  await makeExecutable(join(fakeBin, "pm2"), `#!/usr/bin/env bash\nif [[ "$1" == "pid" ]]; then echo 0; exit 0; fi\nprintf '%s\\n' "$*" >> "${mutationLog}"\nexit 0\n`);

  const result = spawnSync("bash", [new URL("../ops/pullmcp", import.meta.url).pathname], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      HOME: root,
      PM2_HOME: join(root, ".pm2"),
      MCP_PLAN_SOURCE: source,
      MCP_PLAN_RUNTIME: runtime
    }
  });

  assert.notEqual(result.status, 0);
  assert.equal(await readFile(join(runtime, "runtime-marker"), "utf8"), "original");
  assert.equal(await readFile(mutationLog, "utf8"), "");
  const siblings = await readdir(root);
  assert.equal(siblings.some((name) => name.startsWith("runtime.backup.")), false);
  await stat(runtime);
});

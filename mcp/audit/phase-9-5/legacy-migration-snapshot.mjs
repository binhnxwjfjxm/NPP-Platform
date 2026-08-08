import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { buildPostgresqlSslConfig, resolvePostgresqlSslMode } from "../../apps/backend/foundation/postgresql-ssl.js";
import { buildSnapshotSummary, canonicalJson, rowsDigest, sha256 } from "../../apps/backend/foundation/legacy-migration-snapshot.js";

const requireFromBackend = createRequire(new URL("../../apps/backend/package.json", import.meta.url));
const { Pool } = requireFromBackend("pg");
const SAFE_SCHEMA = /^[a-z_][a-z0-9_]{0,62}$/;
const SHA40 = /^[0-9a-f]{40}$/;
const PAGE_SIZE = 1000;
const MAX_PAGES = 1000;
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
function text(value) { const normalized = String(value ?? "").trim(); return normalized || null; }
function fail(code) { const error = new Error(code); error.code = code; throw error; }
function required(name) { const value = text(process.env[name]); if (!value) fail(`missing_${name.toLowerCase()}`); return value; }
function sourceFingerprint(sourceUrl) { return sha256(new URL(sourceUrl).hostname.toLowerCase()); }
function resolveExecutionSourceSha() {
  const envSha = text(process.env.SNAPSHOT_SOURCE_SHA ?? process.env.GITHUB_SHA);
  let gitSha = null;
  try { gitSha = text(execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })); } catch {}
  if (envSha && gitSha && envSha !== gitSha) fail("snapshot_source_sha_mismatch");
  const resolved = envSha || gitSha;
  if (!resolved || !SHA40.test(resolved)) fail("missing_or_invalid_snapshot_source_sha");
  return resolved;
}

async function fetchLegacyTable(baseUrl, serviceKey, table, requiredTable, installationId) {
  const rows = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const start = page * PAGE_SIZE, end = start + PAGE_SIZE - 1;
    const url = new URL(`/rest/v1/${encodeURIComponent(table)}`, `${baseUrl.replace(/\/+$/, "")}/`);
    url.searchParams.set("select", "*"); url.searchParams.set("order", "id.asc");
    const response = await fetch(url, { method: "GET", headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Accept: "application/json", Range: `${start}-${end}`, Prefer: "count=exact" } });
    if (response.status === 404 && !requiredTable) return [];
    if (!response.ok && response.status !== 206) fail(`legacy_read_failed:${table}:${response.status}`);
    const pageRows = await response.json();
    if (!Array.isArray(pageRows)) fail(`legacy_read_invalid:${table}`);
    for (const row of pageRows) { const rowInstallation = text(row?.installation_id); if (rowInstallation && rowInstallation !== installationId) fail(`legacy_cross_installation_row:${table}`); rows.push(row); }
    if (pageRows.length < PAGE_SIZE) return rows;
  }
  fail(`legacy_read_page_limit:${table}`);
}
async function captureLegacyPass(baseUrl, serviceKey, installationId, contract) {
  const data = {};
  for (const entity of contract.entities) data[entity.name] = await fetchLegacyTable(baseUrl, serviceKey, entity.sourceTable, entity.required, installationId);
  return data;
}
function verifyStableLegacyPasses(first, second) {
  for (const name of new Set([...Object.keys(first), ...Object.keys(second)])) {
    const a = first[name] || [], b = second[name] || [];
    if (a.length !== b.length || rowsDigest(a) !== rowsDigest(b)) fail(`legacy_source_unstable:${name}`);
  }
}

async function readCanonicalSnapshot(databaseUrl, schema, installationId, contract) {
  if (!SAFE_SCHEMA.test(schema)) fail("invalid_mcp_db_schema");
  const pool = new Pool({ connectionString: databaseUrl, ssl: buildPostgresqlSslConfig(resolvePostgresqlSslMode({ nodeEnv: "production" })), max: 1, connectionTimeoutMillis: 10000, idleTimeoutMillis: 10000, application_name: "phase-9-5-legacy-snapshot", options: `-c search_path=${schema},public -c default_transaction_read_only=on -c statement_timeout=60000` });
  const client = await pool.connect();
  const targetByEntity = {};
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    for (const entity of contract.entities) {
      const table = entity.targetTable;
      if (!SAFE_SCHEMA.test(table)) fail(`invalid_target_table:${table}`);
      const regclass = await client.query("SELECT to_regclass($1) AS relation", [`${schema}.${table}`]);
      if (!regclass.rows[0]?.relation) { if (entity.required) fail(`missing_required_target_table:${table}`); targetByEntity[entity.name] = []; continue; }
      const response = await client.query(`SELECT to_jsonb(t) AS row_data FROM ${schema}.${table} t WHERE coalesce(to_jsonb(t)->>'installation_id', $1) = $1 ORDER BY to_jsonb(t)->>'id'`, [installationId]);
      targetByEntity[entity.name] = response.rows.map((row) => row.row_data);
    }
    const coreSales = await client.query("SELECT id::text FROM sales.sales_orders WHERE installation_id = $1", [installationId]);
    const coreCustomers = await client.query("SELECT id::text FROM shared.customers WHERE installation_id = $1 AND is_active = true", [installationId]);
    const coreAddresses = await client.query("SELECT id::text FROM shared.customer_addresses WHERE installation_id = $1", [installationId]);
    await client.query("COMMIT");
    return { targetByEntity, canonicalEvidence: { coreSalesOrderIds: new Set(coreSales.rows.map((r) => r.id)), coreCustomerIds: new Set(coreCustomers.rows.map((r) => r.id)), coreAddressIds: new Set(coreAddresses.rows.map((r) => r.id)) } };
  } catch (error) { try { await client.query("ROLLBACK"); } catch {} throw error; }
  finally { client.release(); await pool.end(); }
}

async function writeImmutableSnapshot(outputDir, payload) {
  await mkdir(outputDir, { recursive: false, mode: 0o700 });
  const entitiesDir = join(outputDir, "entities"); await mkdir(entitiesDir, { mode: 0o700 });
  for (const [entity, rows] of Object.entries(payload.sourceByEntity)) {
    const encoded = rows.map(canonicalJson).sort().join("\n");
    await writeFile(join(entitiesDir, `${entity}.jsonl`), encoded ? `${encoded}\n` : "", { mode: 0o600, flag: "wx" });
  }
  const mapping = Object.values(payload.summary.mappingsByEntity).flat().map(canonicalJson).sort().join("\n");
  await writeFile(join(outputDir, "mapping.jsonl"), mapping ? `${mapping}\n` : "", { mode: 0o600, flag: "wx" });
  await writeFile(join(outputDir, "findings.json"), `${JSON.stringify(payload.summary.findings, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await writeFile(join(outputDir, "classifications.json"), `${JSON.stringify(payload.summary.classifications, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await writeFile(join(outputDir, "manifest.json"), `${JSON.stringify(payload.manifest, null, 2)}\n`, { mode: 0o600, flag: "wx" });
}

async function main() {
  const sourceUrl = required("MCP_LEGACY_AUDIT_SUPABASE_URL"), sourceKey = required("MCP_LEGACY_AUDIT_SUPABASE_SERVICE_ROLE_KEY");
  const databaseUrl = required("DATABASE_URL"), installationId = required("INSTALLATION_ID"), outputDir = required("MCP_LEGACY_SNAPSHOT_DIR");
  const executionSourceSha = resolveExecutionSourceSha(), schema = text(process.env.MCP_DB_SCHEMA) || "mcp";
  const contract = JSON.parse(await readFile(new URL("./snapshot-contract.json", import.meta.url), "utf8"));
  const persistenceProvider = text(process.env.PERSISTENCE_PROVIDER)?.toLowerCase();
  if (persistenceProvider === "legacy-supabase" || /^(1|true|yes|on)$/i.test(text(process.env.MCP_LEGACY_RUNTIME_ENABLED) || "")) fail("legacy_runtime_must_remain_disabled");

  const firstPass = await captureLegacyPass(sourceUrl, sourceKey, installationId, contract);
  const sourceByEntity = await captureLegacyPass(sourceUrl, sourceKey, installationId, contract);
  verifyStableLegacyPasses(firstPass, sourceByEntity);
  const { targetByEntity, canonicalEvidence } = await readCanonicalSnapshot(databaseUrl, schema, installationId, contract);
  const summary = buildSnapshotSummary({ contract, sourceByEntity, targetByEntity, installationId, canonicalEvidence });

  const sourceEntities = Object.fromEntries(Object.entries(sourceByEntity).map(([name, rows]) => [name, { rows: rows.length, sha256: rowsDigest(rows) }]));
  const targetEntities = Object.fromEntries(Object.entries(targetByEntity).map(([name, rows]) => [name, { rows: rows.length, sha256: rowsDigest(rows) }]));
  const mappingRows = Object.values(summary.mappingsByEntity).flat();
  const classificationRows = Object.entries(summary.classifications).flatMap(([entity, rows]) => rows.map((row) => ({ entity, ...row })));
  const manifestBody = {
    schemaVersion: 1, phase: "9.5", auditedBaselineSha: contract.baseline, executionSourceSha, installationId, capturedAt: new Date().toISOString(),
    legacySourceFingerprintSha256: sourceFingerprint(sourceUrl), legacyConsistency: { mode: "double-read-stability", passes: 2, verified: true },
    canonicalConsistency: { isolation: "repeatable-read-read-only", verified: true }, sourceEntities, targetEntities,
    mappingCount: mappingRows.length, mappingSha256: rowsDigest(mappingRows), classificationCount: classificationRows.length, classificationSha256: rowsDigest(classificationRows),
    findingCount: summary.findings.length, findingsSha256: rowsDigest(summary.findings), blockingFindingCount: summary.blockingFindings.length, blockingFindingsSha256: rowsDigest(summary.blockingFindings),
    importReady: summary.importReady,
    immutability: { localWriteOncePackage: true, manifestSelfHash: true, externalRetentionEvidenceRequiredForPhaseClosure: true },
    boundaries: { productionImportPerformed: false, adapterSwitched: false, legacyRuntimeEnabled: false }
  };
  const manifest = { ...manifestBody, manifestSha256: sha256(canonicalJson(manifestBody)) };
  await writeImmutableSnapshot(outputDir, { sourceByEntity, summary, manifest });
  process.stdout.write([`PHASE_9_5_EXECUTION_SOURCE_SHA=${executionSourceSha}`, `PHASE_9_5_ENTITY_COUNT=${contract.entities.length}`, `PHASE_9_5_MAPPING_COUNT=${manifest.mappingCount}`, `PHASE_9_5_FINDING_COUNT=${manifest.findingCount}`, `PHASE_9_5_BLOCKING_FINDING_COUNT=${manifest.blockingFindingCount}`, `PHASE_9_5_IMPORT_READY=${manifest.importReady}`, `PHASE_9_5_MANIFEST_SHA256=${manifest.manifestSha256}`].join("\n") + "\n");
}
main().catch((error) => { const code = text(error?.code) || text(error?.message) || "phase_9_5_snapshot_failed"; process.stderr.write(`PHASE_9_5_SNAPSHOT_ERROR=${code}\n`); process.exitCode = 1; });

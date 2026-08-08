import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { buildPostgresqlSslConfig, resolvePostgresqlSslMode } from "../foundation/postgresql-ssl.js";
import {
  buildSnapshotSummary,
  canonicalJson,
  rowsDigest,
  sha256
} from "../foundation/legacy-migration-snapshot.js";

const { Pool } = pg;
const SAFE_SCHEMA = /^[a-z_][a-z0-9_]{0,62}$/;
const PAGE_SIZE = 1000;
const MAX_PAGES = 1000;

function text(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function required(name) {
  const value = text(process.env[name]);
  if (!value) fail(`missing_${name.toLowerCase()}`);
  return value;
}

function sourceFingerprint(sourceUrl) {
  const parsed = new URL(sourceUrl);
  return sha256(parsed.hostname.toLowerCase());
}

async function fetchLegacyTable(baseUrl, serviceKey, table, requiredTable) {
  const rows = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const start = page * PAGE_SIZE;
    const end = start + PAGE_SIZE - 1;
    const url = new URL(`/rest/v1/${encodeURIComponent(table)}`, `${baseUrl.replace(/\/+$/, "")}/`);
    url.searchParams.set("select", "*");
    url.searchParams.set("order", "id.asc");
    const response = await fetch(url, {
      method: "GET",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Accept: "application/json",
        Range: `${start}-${end}`,
        Prefer: "count=exact"
      }
    });
    if (response.status === 404 && !requiredTable) return [];
    if (!response.ok && response.status !== 206) fail(`legacy_read_failed:${table}:${response.status}`);
    const pageRows = await response.json();
    if (!Array.isArray(pageRows)) fail(`legacy_read_invalid:${table}`);
    rows.push(...pageRows);
    if (pageRows.length < PAGE_SIZE) return rows;
  }
  fail(`legacy_read_page_limit:${table}`);
}

async function readCanonicalTables(databaseUrl, schema, installationId, contract) {
  if (!SAFE_SCHEMA.test(schema)) fail("invalid_mcp_db_schema");
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: buildPostgresqlSslConfig(resolvePostgresqlSslMode({ nodeEnv: "production" })),
    max: 1,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 10000,
    application_name: "phase-9-5-legacy-snapshot",
    options: `-c search_path=${schema},public -c default_transaction_read_only=on -c statement_timeout=60000`
  });
  const client = await pool.connect();
  const result = {};
  try {
    await client.query("BEGIN READ ONLY");
    for (const entity of contract.entities) {
      const table = entity.targetTable;
      if (!/^[a-z_][a-z0-9_]{0,62}$/.test(table)) fail(`invalid_target_table:${table}`);
      try {
        const query = `SELECT to_jsonb(t) AS row_data FROM ${schema}.${table} t WHERE coalesce(to_jsonb(t)->>'installation_id', $1) = $1 ORDER BY to_jsonb(t)->>'id'`;
        const response = await client.query(query, [installationId]);
        result[entity.name] = response.rows.map((row) => row.row_data);
      } catch (error) {
        if (!entity.required && error?.code === "42P01") {
          result[entity.name] = [];
          continue;
        }
        throw error;
      }
    }
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function writeImmutableSnapshot(outputDir, payload) {
  await mkdir(outputDir, { recursive: false, mode: 0o700 });
  const entitiesDir = join(outputDir, "entities");
  await mkdir(entitiesDir, { mode: 0o700 });

  for (const [entity, rows] of Object.entries(payload.sourceByEntity)) {
    const encoded = rows.map((row) => canonicalJson(row)).sort().join("\n");
    await writeFile(join(entitiesDir, `${entity}.jsonl`), encoded ? `${encoded}\n` : "", { mode: 0o600, flag: "wx" });
  }

  const mappingLines = Object.values(payload.summary.mappingsByEntity)
    .flat()
    .map((row) => canonicalJson(row))
    .sort()
    .join("\n");
  await writeFile(join(outputDir, "mapping.jsonl"), mappingLines ? `${mappingLines}\n` : "", { mode: 0o600, flag: "wx" });
  await writeFile(join(outputDir, "findings.json"), `${JSON.stringify(payload.summary.findings, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await writeFile(join(outputDir, "classifications.json"), `${JSON.stringify(payload.summary.classifications, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await writeFile(join(outputDir, "manifest.json"), `${JSON.stringify(payload.manifest, null, 2)}\n`, { mode: 0o600, flag: "wx" });
}

async function main() {
  const sourceUrl = required("MCP_LEGACY_AUDIT_SUPABASE_URL");
  const sourceKey = required("MCP_LEGACY_AUDIT_SUPABASE_SERVICE_ROLE_KEY");
  const databaseUrl = required("DATABASE_URL");
  const installationId = required("INSTALLATION_ID");
  const auditedMainSha = required("AUDITED_MAIN_SHA");
  const outputDir = required("MCP_LEGACY_SNAPSHOT_DIR");
  const schema = text(process.env.MCP_DB_SCHEMA) || "mcp";
  const contractPath = new URL("../../../audit/phase-9-5/snapshot-contract.json", import.meta.url);
  const contract = JSON.parse(await readFile(contractPath, "utf8"));

  if (contract.baseline !== auditedMainSha) fail("audited_main_sha_mismatch");
  if (process.env.PERSISTENCE_PROVIDER === "legacy-supabase" || /^(1|true|yes|on)$/i.test(text(process.env.MCP_LEGACY_RUNTIME_ENABLED) || "")) {
    fail("legacy_runtime_must_remain_disabled");
  }

  const sourceByEntity = {};
  for (const entity of contract.entities) {
    sourceByEntity[entity.name] = await fetchLegacyTable(sourceUrl, sourceKey, entity.sourceTable, entity.required);
  }
  const targetByEntity = await readCanonicalTables(databaseUrl, schema, installationId, contract);
  const summary = buildSnapshotSummary({ contract, sourceByEntity, targetByEntity });

  const sourceEntities = Object.fromEntries(
    Object.entries(sourceByEntity).map(([name, rows]) => [name, { rows: rows.length, sha256: rowsDigest(rows) }])
  );
  const targetEntities = Object.fromEntries(
    Object.entries(targetByEntity).map(([name, rows]) => [name, { rows: rows.length, sha256: rowsDigest(rows) }])
  );
  const mappingRows = Object.values(summary.mappingsByEntity).flat();
  const classificationRows = Object.entries(summary.classifications).flatMap(([entity, rows]) =>
    rows.map((row) => ({ entity, ...row }))
  );
  const manifestBody = {
    schemaVersion: 1,
    phase: "9.5",
    auditedMainSha,
    installationId,
    capturedAt: new Date().toISOString(),
    legacySourceFingerprintSha256: sourceFingerprint(sourceUrl),
    sourceEntities,
    targetEntities,
    mappingCount: mappingRows.length,
    mappingSha256: rowsDigest(mappingRows),
    classificationCount: classificationRows.length,
    classificationSha256: rowsDigest(classificationRows),
    findingCount: summary.findings.length,
    findingsSha256: rowsDigest(summary.findings),
    blockingFindingCount: summary.blockingFindings.length,
    blockingFindingsSha256: rowsDigest(summary.blockingFindings),
    importReady: summary.importReady,
    boundaries: {
      productionImportPerformed: false,
      adapterSwitched: false,
      legacyRuntimeEnabled: false
    }
  };
  const manifest = { ...manifestBody, manifestSha256: sha256(canonicalJson(manifestBody)) };
  await writeImmutableSnapshot(outputDir, { sourceByEntity, summary, manifest });

  process.stdout.write([
    `PHASE_9_5_AUDITED_MAIN_SHA=${auditedMainSha}`,
    `PHASE_9_5_ENTITY_COUNT=${contract.entities.length}`,
    `PHASE_9_5_MAPPING_COUNT=${manifest.mappingCount}`,
    `PHASE_9_5_FINDING_COUNT=${manifest.findingCount}`,
    `PHASE_9_5_BLOCKING_FINDING_COUNT=${manifest.blockingFindingCount}`,
    `PHASE_9_5_IMPORT_READY=${manifest.importReady}`,
    `PHASE_9_5_MANIFEST_SHA256=${manifest.manifestSha256}`
  ].join("\n") + "\n");
}

main().catch((error) => {
  const code = text(error?.code) || text(error?.message) || "phase_9_5_snapshot_failed";
  process.stderr.write(`PHASE_9_5_SNAPSHOT_ERROR=${code}\n`);
  process.exitCode = 1;
});

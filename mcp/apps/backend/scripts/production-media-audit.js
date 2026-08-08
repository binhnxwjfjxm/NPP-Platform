import { createHash } from "node:crypto";
import pg from "pg";
import {
  signedR2GetRequest,
  signedR2LifecycleRequest,
  signedR2ListRequest
} from "../foundation/r2-storage.js";
import { buildPostgresqlSslConfig, resolvePostgresqlSslMode } from "../foundation/postgresql-ssl.js";

const { Pool } = pg;
const HEROKU_ACCEPT = "application/vnd.heroku+json; version=3";
const REQUIRED_CONFIG_NAMES = Object.freeze([
  "DATABASE_URL",
  "INSTALLATION_ID",
  "MCP_DB_SCHEMA",
  "PERSISTENCE_PROVIDER",
  "MCP_LEGACY_RUNTIME_ENABLED",
  "R2_BUCKET_NAME",
  "R2_ENDPOINT",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY"
]);
const SAFE_SCHEMA = /^[a-z_][a-z0-9_]{0,62}$/;
const STABILITY_WINDOW_MS = 5 * 60 * 1000;
const MAX_LIST_PAGES = 10000;
const MAX_CHECKSUM_BYTES = 512 * 1024 * 1024;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function text(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function safeSegment(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function digestLines(lines) {
  return sha256([...lines].sort().join("\n"));
}

function normalizeEtag(value) {
  const normalized = text(value);
  return normalized ? normalized.replace(/^"|"$/g, "").toLowerCase() : null;
}

function xmlDecode(value) {
  return String(value ?? "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function tagText(block, tag) {
  const match = String(block).match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? xmlDecode(match[1].trim()) : null;
}

function parseListObjectsXml(xml) {
  const contents = [];
  for (const match of String(xml).matchAll(/<Contents>([\s\S]*?)<\/Contents>/gi)) {
    const block = match[1];
    const key = tagText(block, "Key");
    const size = Number(tagText(block, "Size"));
    const etag = normalizeEtag(tagText(block, "ETag"));
    const lastModified = tagText(block, "LastModified");
    if (!key || !Number.isFinite(size) || !lastModified) fail("invalid_r2_list_response");
    contents.push({ key, size, etag, lastModified });
  }
  return {
    contents,
    truncated: String(tagText(xml, "IsTruncated")).toLowerCase() === "true",
    nextContinuationToken: tagText(xml, "NextContinuationToken")
  };
}

function parseLifecycleXml(xml) {
  const rules = [];
  for (const match of String(xml).matchAll(/<Rule>([\s\S]*?)<\/Rule>/gi)) {
    const block = match[1];
    const filter = block.match(/<Filter>([\s\S]*?)<\/Filter>/i)?.[1] || "";
    const prefix = tagText(filter, "Prefix") ?? tagText(block, "Prefix") ?? "";
    const expiration = block.match(/<Expiration>([\s\S]*?)<\/Expiration>/i)?.[1] || null;
    rules.push({
      status: tagText(block, "Status") || "",
      prefix,
      hasExpiration: Boolean(expiration && (
        tagText(expiration, "Days") ||
        tagText(expiration, "Date") ||
        String(tagText(expiration, "ExpiredObjectDeleteMarker")).toLowerCase() === "true"
      ))
    });
  }
  return rules;
}

function prefixesOverlap(left, right) {
  return left.startsWith(right) || right.startsWith(left);
}

function expectedObjectKey(row, installationId) {
  const extension = row.mime_type === "image/webp" ? "webp" : row.mime_type === "image/png" ? "png" : "jpg";
  return `mcp-plan/outlets/${safeSegment(installationId)}/${safeSegment(row.route_customer_id)}/${row.id}.${extension}`;
}

function isStable(value, cutoffMs) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed <= cutoffMs;
}

async function herokuConfig(appName, apiKey) {
  const response = await fetch(`https://api.heroku.com/apps/${encodeURIComponent(appName)}/config-vars`, {
    method: "GET",
    headers: {
      Accept: HEROKU_ACCEPT,
      Authorization: `Bearer ${apiKey}`
    }
  });
  if (!response.ok) fail("heroku_config_read_failed");
  const config = await response.json();
  for (const name of REQUIRED_CONFIG_NAMES) {
    if (!text(config?.[name])) fail(`missing_runtime_${name.toLowerCase()}`);
  }
  return config;
}

function r2ConfigFromRuntime(config) {
  return Object.freeze({
    bucket: config.R2_BUCKET_NAME,
    endpoint: config.R2_ENDPOINT,
    region: text(config.R2_REGION) || "auto",
    accessKeyId: config.R2_ACCESS_KEY_ID,
    secretAccessKey: config.R2_SECRET_ACCESS_KEY
  });
}

async function listR2Objects(r2, prefix) {
  const objects = [];
  let continuationToken = null;
  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    const request = signedR2ListRequest(r2, { prefix, continuationToken, maxKeys: 1000 });
    const response = await fetch(request.url, request.init);
    if (!response.ok) fail("r2_list_failed");
    const parsed = parseListObjectsXml(await response.text());
    objects.push(...parsed.contents);
    if (!parsed.truncated) return objects;
    if (!parsed.nextContinuationToken) fail("r2_list_pagination_missing_token");
    continuationToken = parsed.nextContinuationToken;
  }
  fail("r2_list_page_limit_exceeded");
}

async function readLifecycle(r2) {
  const request = signedR2LifecycleRequest(r2);
  const response = await fetch(request.url, request.init);
  const body = await response.text();
  if (response.status === 404 && /NoSuchLifecycleConfiguration/i.test(body)) return [];
  if (!response.ok) fail("r2_lifecycle_read_failed");
  return parseLifecycleXml(body);
}

async function contentChecksum(r2, objectKey, expectedMaxBytes) {
  const request = signedR2GetRequest(r2, objectKey);
  const response = await fetch(request.url, request.init);
  if (!response.ok || !response.body) return { ok: false, bytes: 0, sha256: null };
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > expectedMaxBytes) fail("media_checksum_budget_exceeded");
    hash.update(chunk);
  }
  return { ok: true, bytes, sha256: hash.digest("hex") };
}

async function readMediaRows(databaseUrl, schema, installationId) {
  if (!SAFE_SCHEMA.test(schema)) fail("invalid_mcp_db_schema");
  const sslMode = resolvePostgresqlSslMode({ nodeEnv: "production" });
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: buildPostgresqlSslConfig(sslMode),
    max: 1,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 10000,
    application_name: "phase-9-4-media-audit",
    options: `-c search_path=${schema},public -c statement_timeout=30000 -c default_transaction_read_only=on`
  });
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const result = await client.query(
      `SELECT id, installation_id, route_customer_id, session_id, object_key,
              media_type, mime_type, expected_byte_size, actual_byte_size,
              etag, status, created_at, updated_at
         FROM ${schema}.mcp_outlet_media
        WHERE installation_id = $1
        ORDER BY object_key, id`,
      [installationId]
    );
    await client.query("COMMIT");
    return result.rows || [];
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function main() {
  const appName = text(process.env.HEROKU_APP_NAME);
  const apiKey = text(process.env.HEROKU_API_KEY);
  const auditedMainSha = text(process.env.AUDITED_MAIN_SHA);
  const evidenceFile = text(process.env.MCP_MEDIA_AUDIT_EVIDENCE_FILE);
  if (!appName || !apiKey || !auditedMainSha || !evidenceFile) fail("media_audit_environment_incomplete");
  if (appName !== "hung-phat-mcp") fail("unexpected_mcp_app");

  const runtime = await herokuConfig(appName, apiKey);
  if (runtime.PERSISTENCE_PROVIDER !== "postgresql") fail("production_persistence_not_postgresql");
  if (!new Set(["false", "0", "no", "off"]).has(String(runtime.MCP_LEGACY_RUNTIME_ENABLED).trim().toLowerCase())) {
    fail("legacy_runtime_enabled");
  }

  const installationId = runtime.INSTALLATION_ID;
  const schema = text(runtime.MCP_DB_SCHEMA) || "mcp";
  const r2 = r2ConfigFromRuntime(runtime);
  const canonicalPrefix = `mcp-plan/outlets/${safeSegment(installationId)}/`;
  const cutoffMs = Date.now() - STABILITY_WINDOW_MS;

  const [rows, objects, lifecycleRules] = await Promise.all([
    readMediaRows(runtime.DATABASE_URL, schema, installationId),
    listR2Objects(r2, canonicalPrefix),
    readLifecycle(r2)
  ]);

  const objectByKey = new Map(objects.map((object) => [object.key, object]));
  const dbKeys = new Set(rows.map((row) => row.object_key));
  const stableRows = rows.filter((row) => isStable(row.updated_at, cutoffMs));
  const stableReady = stableRows.filter((row) => row.status === "ready");
  const stableDeleted = stableRows.filter((row) => row.status === "deleted");
  const staleNonterminal = stableRows.filter((row) => !new Set(["ready", "deleted"]).has(row.status));

  const nonCanonicalIds = new Set();
  const missingObjectIds = new Set();
  const sizeMismatchIds = new Set();
  const etagMismatchIds = new Set();
  const readFailureIds = new Set();
  let checksumBytes = 0;
  const contentManifest = [];

  for (const row of stableReady) {
    if (row.object_key !== expectedObjectKey(row, installationId)) nonCanonicalIds.add(row.id);
    const object = objectByKey.get(row.object_key);
    if (!object) {
      missingObjectIds.add(row.id);
      continue;
    }
    const expectedSize = Number(row.actual_byte_size ?? row.expected_byte_size);
    if (Number.isFinite(expectedSize) && expectedSize !== Number(object.size)) sizeMismatchIds.add(row.id);
    const dbEtag = normalizeEtag(row.etag);
    if (dbEtag && object.etag && dbEtag !== object.etag) etagMismatchIds.add(row.id);

    const remainingBudget = MAX_CHECKSUM_BYTES - checksumBytes;
    if (remainingBudget < 1) fail("media_checksum_budget_exceeded");
    const checksum = await contentChecksum(r2, row.object_key, remainingBudget);
    if (!checksum.ok) {
      readFailureIds.add(row.id);
      continue;
    }
    checksumBytes += checksum.bytes;
    if (checksum.bytes !== Number(object.size)) sizeMismatchIds.add(row.id);
    contentManifest.push(`${row.object_key}\t${checksum.bytes}\t${checksum.sha256}`);
  }

  const deletedObjectsPresent = stableDeleted.filter((row) => objectByKey.has(row.object_key)).length;
  const orphanObjects = objects.filter((object) => isStable(object.lastModified, cutoffMs) && !dbKeys.has(object.key)).length;
  const lifecycleAutoExpiry = lifecycleRules.some((rule) =>
    String(rule.status).toLowerCase() === "enabled" &&
    rule.hasExpiration &&
    prefixesOverlap(canonicalPrefix, rule.prefix || "")
  );

  const dbManifest = rows.map((row) => [
    row.id,
    row.installation_id,
    row.route_customer_id,
    row.session_id || "",
    row.object_key,
    row.media_type || "",
    row.mime_type,
    row.expected_byte_size ?? "",
    row.actual_byte_size ?? "",
    normalizeEtag(row.etag) || "",
    row.status,
    new Date(row.updated_at).toISOString()
  ].join("\t"));
  const r2Manifest = objects.map((object) => [
    object.key,
    object.size,
    object.etag || "",
    new Date(object.lastModified).toISOString()
  ].join("\t"));

  const nonCanonicalKeys = nonCanonicalIds.size;
  const missingObjects = missingObjectIds.size;
  const sizeMismatches = sizeMismatchIds.size;
  const etagMismatches = etagMismatchIds.size;
  const readFailures = readFailureIds.size;
  const copyRequired = nonCanonicalKeys + missingObjects + sizeMismatches + etagMismatches + readFailures > 0;
  const reconciliationReady = !copyRequired &&
    orphanObjects === 0 &&
    deletedObjectsPresent === 0 &&
    staleNonterminal.length === 0 &&
    lifecycleAutoExpiry === false;

  const targetFingerprint = sha256(`${new URL(r2.endpoint).hostname.toLowerCase()}\n${r2.bucket}`);
  const evidence = [
    `AUDITED_MAIN_SHA=${auditedMainSha}`,
    `HEROKU_APP_NAME=${appName}`,
    "MCP_MEDIA_RUNTIME_R2_CONFIGURED=true",
    `R2_TARGET_FINGERPRINT_SHA256=${targetFingerprint}`,
    `MCP_MEDIA_STABILITY_WINDOW_SECONDS=${Math.trunc(STABILITY_WINDOW_MS / 1000)}`,
    `MCP_MEDIA_DB_ROWS=${rows.length}`,
    `MCP_MEDIA_STABLE_READY_ROWS=${stableReady.length}`,
    `MCP_MEDIA_STABLE_DELETED_ROWS=${stableDeleted.length}`,
    `MCP_MEDIA_STALE_NONTERMINAL_ROWS=${staleNonterminal.length}`,
    `R2_CANONICAL_PREFIX_OBJECTS=${objects.length}`,
    `MCP_MEDIA_NON_CANONICAL_KEYS=${nonCanonicalKeys}`,
    `MCP_MEDIA_MISSING_OBJECTS=${missingObjects}`,
    `MCP_MEDIA_SIZE_MISMATCHES=${sizeMismatches}`,
    `MCP_MEDIA_ETAG_MISMATCHES=${etagMismatches}`,
    `MCP_MEDIA_READ_FAILURES=${readFailures}`,
    `MCP_MEDIA_ORPHAN_OBJECTS=${orphanObjects}`,
    `MCP_MEDIA_DELETED_OBJECTS_PRESENT=${deletedObjectsPresent}`,
    `R2_CANONICAL_PREFIX_AUTO_EXPIRY=${lifecycleAutoExpiry}`,
    `MCP_MEDIA_CHECKSUM_BYTES=${checksumBytes}`,
    `MCP_MEDIA_DB_MANIFEST_SHA256=${digestLines(dbManifest)}`,
    `R2_OBJECT_MANIFEST_SHA256=${digestLines(r2Manifest)}`,
    `R2_CONTENT_MANIFEST_SHA256=${digestLines(contentManifest)}`,
    `MCP_MEDIA_COPY_REQUIRED=${copyRequired}`,
    `MCP_MEDIA_RECONCILIATION_READY=${reconciliationReady}`
  ].join("\n") + "\n";

  await import("node:fs/promises").then(({ writeFile }) => writeFile(evidenceFile, evidence, { mode: 0o600 }));
  process.stdout.write(evidence);
  if (!reconciliationReady) process.exitCode = 2;
}

main().catch(async (error) => {
  const code = text(error?.code) || "media_audit_failed";
  const evidenceFile = text(process.env.MCP_MEDIA_AUDIT_EVIDENCE_FILE);
  const auditedMainSha = text(process.env.AUDITED_MAIN_SHA) || "unknown";
  const evidence = [
    `AUDITED_MAIN_SHA=${auditedMainSha}`,
    `PHASE_9_4_MEDIA_AUDIT_ERROR=${code}`,
    "MCP_MEDIA_RECONCILIATION_READY=false"
  ].join("\n") + "\n";
  if (evidenceFile) {
    try {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(evidenceFile, evidence, { mode: 0o600 });
    } catch {}
  }
  process.stderr.write(evidence);
  process.exitCode = 1;
});

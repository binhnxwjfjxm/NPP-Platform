import pg from "pg";
import { buildPostgresqlSslConfig, resolvePostgresqlSslMode } from "./postgresql-ssl.js";
const { Pool } = pg;

const SCHEMA_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;

function unavailable(code, cause) {
  const error = new Error(code);
  error.code = code;
  error.statusCode = 503;
  if (cause) error.cause = cause;
  return error;
}

function safeReadiness(provider, configured, ready, code = null) {
  return Object.freeze({ provider, configured, ready, ...(code ? { code } : {}) });
}

function activeSearchPath(value) {
  return String(value ?? "")
    .split(",")
    .map((part) => part.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
}

function quotedSchema(value) {
  const schema = String(value ?? "").trim();
  if (!SCHEMA_PATTERN.test(schema)) throw unavailable("invalid_persistence_schema");
  return `"${schema}"`;
}

export function createPostgresqlPersistence(config, { PoolImpl = Pool } = {}) {
  const settings = config.persistence || config;
  const schema = String(settings.schema ?? "").trim();
  if (!SCHEMA_PATTERN.test(schema)) throw unavailable("invalid_persistence_schema");
  const sslMode = resolvePostgresqlSslMode({
    nodeEnv: config.nodeEnv ?? settings.nodeEnv,
    mode: settings.sslMode
  });
  let pool = null;
  let closed = false;

  function getPool() {
    if (closed) throw unavailable("persistence_closed");
    if (!settings.databaseUrl) throw unavailable("missing_database_url");
    if (!pool) {
      pool = new PoolImpl({
        connectionString: settings.databaseUrl,
        ssl: buildPostgresqlSslConfig(sslMode),
        max: settings.poolMax,
        connectionTimeoutMillis: settings.connectionTimeoutMs,
        idleTimeoutMillis: settings.idleTimeoutMs,
        application_name: "mcp-plan-backend",
        options: `-c search_path=${schema},public -c statement_timeout=${settings.statementTimeoutMs}`
      });
    }
    return pool;
  }

  async function readiness() {
    if (!settings.databaseUrl) return safeReadiness("postgresql", false, false, "missing_database_url");
    try {
      const result = await getPool().query(
        "select current_user as role, current_setting('search_path') as search_path, to_regnamespace($1) is not null as schema_available",
        [schema]
      );
      const row = result.rows?.[0] || {};
      if (row.schema_available !== true) return safeReadiness("postgresql", true, false, "persistence_schema_unavailable");
      if (activeSearchPath(row.search_path)[0] !== schema) return safeReadiness("postgresql", true, false, "persistence_search_path_mismatch");
      if (settings.expectedRole && row.role !== settings.expectedRole) return safeReadiness("postgresql", true, false, "persistence_role_mismatch");
      return safeReadiness("postgresql", true, true);
    } catch {
      return safeReadiness("postgresql", true, false, "persistence_unavailable");
    }
  }

  async function assertReady() {
    const status = await readiness();
    if (!status.ready) throw unavailable(status.code || "persistence_unavailable");
    return status;
  }

  async function withTransaction(work) {
    if (typeof work !== "function") throw new TypeError("transaction_work_required");
    const activePool = getPool();
    if (typeof activePool.connect !== "function") throw unavailable("persistence_transaction_unavailable");
    const client = await activePool.connect();
    let began = false;
    try {
      await client.query("BEGIN");
      began = true;
      await client.query(`SET LOCAL search_path TO ${quotedSchema(schema)}, public`);
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      if (began) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Preserve the original transaction failure.
        }
      }
      throw error;
    } finally {
      if (typeof client.release === "function") client.release();
    }
  }

  async function close() {
    closed = true;
    if (pool) await pool.end();
  }

  return Object.freeze({
    provider: "postgresql",
    schema,
    configured: Boolean(settings.databaseUrl),
    readiness,
    assertReady,
    withTransaction,
    close
  });
}

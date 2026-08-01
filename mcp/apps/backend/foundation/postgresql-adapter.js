import pg from "pg";
const { Pool } = pg;

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

export function createPostgresqlPersistence(config, { PoolImpl = Pool } = {}) {
  const settings = config.persistence || config;
  let pool = null;
  let closed = false;

  function getPool() {
    if (closed) throw unavailable("persistence_closed");
    if (!settings.databaseUrl) throw unavailable("missing_database_url");
    if (!pool) {
      pool = new PoolImpl({
        connectionString: settings.databaseUrl,
        max: settings.poolMax,
        connectionTimeoutMillis: settings.connectionTimeoutMs,
        idleTimeoutMillis: settings.idleTimeoutMs,
        application_name: "mcp-plan-backend",
        options: `-c search_path=${settings.schema},public -c statement_timeout=${settings.statementTimeoutMs}`
      });
    }
    return pool;
  }

  async function readiness() {
    if (!settings.databaseUrl) return safeReadiness("postgresql", false, false, "missing_database_url");
    try {
      const result = await getPool().query(
        "select current_user as role, current_setting('search_path') as search_path, to_regnamespace($1) is not null as schema_available",
        [settings.schema]
      );
      const row = result.rows?.[0] || {};
      if (row.schema_available !== true) return safeReadiness("postgresql", true, false, "persistence_schema_unavailable");
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

  async function close() {
    closed = true;
    if (pool) await pool.end();
  }

  return Object.freeze({ provider: "postgresql", configured: Boolean(settings.databaseUrl), readiness, assertReady, close });
}

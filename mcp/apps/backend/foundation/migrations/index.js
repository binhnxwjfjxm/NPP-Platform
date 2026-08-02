import { readFileSync } from "node:fs";

const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._-]{1,127}$/;
const MCP_WRITE_FOUNDATION_SQL = readFileSync(
  new URL("./sql/001_mcp_write_foundation.sql", import.meta.url),
  "utf8"
);
const MCP_DOMAIN_READ_MODELS_SQL = readFileSync(
  new URL("./sql/002_mcp_domain_read_models.sql", import.meta.url),
  "utf8"
);

export const MCP_MIGRATIONS = Object.freeze([
  Object.freeze({ id: "mcp_001_write_foundation", sql: MCP_WRITE_FOUNDATION_SQL }),
  Object.freeze({ id: "mcp_002_domain_read_models", sql: MCP_DOMAIN_READ_MODELS_SQL })
]);

function migrationError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function validateMigration(migration) {
  if (!migration || !IDENTIFIER_PATTERN.test(String(migration.id ?? ""))) {
    throw migrationError("invalid_migration_id");
  }
  if (typeof migration.sql !== "string" && typeof migration.up !== "function") {
    throw migrationError("invalid_migration_body");
  }
}

async function registryExists(adapter) {
  const result = await adapter.query("SELECT to_regclass('shared.schema_migrations') IS NOT NULL AS exists");
  return result.rows?.[0]?.exists === true;
}

export async function migrationStatusWithAdapter(adapter, migrations = MCP_MIGRATIONS) {
  if (!adapter || typeof adapter.query !== "function") throw migrationError("invalid_migration_adapter");
  const ordered = [...migrations].sort((left, right) => left.id.localeCompare(right.id));
  ordered.forEach(validateMigration);
  if (!(await registryExists(adapter))) {
    return Object.freeze({ applied: Object.freeze([]), pending: Object.freeze(ordered.map((item) => item.id)) });
  }
  const result = await adapter.query(
    "SELECT id FROM shared.schema_migrations WHERE split_part(id, '_', 1) = 'mcp' ORDER BY id"
  );
  const applied = Object.freeze((result.rows ?? []).map((row) => String(row.id)));
  const appliedSet = new Set(applied);
  return Object.freeze({
    applied,
    pending: Object.freeze(ordered.filter((item) => !appliedSet.has(item.id)).map((item) => item.id))
  });
}

export async function runMcpMigrations(adapter, migrations = MCP_MIGRATIONS) {
  if (!adapter || typeof adapter.query !== "function") throw migrationError("invalid_migration_adapter");
  const ordered = [...migrations].sort((left, right) => left.id.localeCompare(right.id));
  ordered.forEach(validateMigration);

  await adapter.query("BEGIN");
  try {
    await adapter.query("SELECT pg_advisory_xact_lock(hashtext('npp-platform:mcp-migrations'))");
    await adapter.query("CREATE SCHEMA IF NOT EXISTS shared");
    await adapter.query(`
      CREATE TABLE IF NOT EXISTS shared.schema_migrations (
        id text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const existing = await adapter.query("SELECT id FROM shared.schema_migrations ORDER BY id");
    const appliedIds = new Set((existing.rows ?? []).map((row) => String(row.id)));
    const applied = [];

    for (const migration of ordered) {
      if (appliedIds.has(migration.id)) continue;
      if (typeof migration.up === "function") await migration.up(adapter);
      else await adapter.query(migration.sql);
      await adapter.query("INSERT INTO shared.schema_migrations (id) VALUES ($1)", [migration.id]);
      applied.push(migration.id);
    }

    await adapter.query("COMMIT");
    return Object.freeze({ status: "complete", applied: Object.freeze(applied) });
  } catch (error) {
    try {
      await adapter.query("ROLLBACK");
    } catch {
      // Preserve the original migration failure.
    }
    throw error;
  }
}

async function exists(adapter, sql, values = []) {
  const result = await adapter.query(sql, values);
  return result.rows?.[0]?.exists === true;
}

async function tableExists(adapter, table) {
  return exists(adapter, "SELECT to_regclass($1) IS NOT NULL AS exists", [`mcp.${table}`]);
}

async function functionExists(adapter, signature) {
  return exists(adapter, "SELECT to_regprocedure($1) IS NOT NULL AS exists", [signature]);
}

async function constraintExists(adapter, table, constraint) {
  return exists(
    adapter,
    `SELECT EXISTS (
       SELECT 1
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE n.nspname = 'mcp' AND t.relname = $1 AND c.conname = $2
     ) AS exists`,
    [table, constraint]
  );
}

async function indexExists(adapter, index) {
  return exists(
    adapter,
    "SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'mcp' AND indexname = $1) AS exists",
    [index]
  );
}

async function triggerExists(adapter, table, trigger) {
  return exists(
    adapter,
    `SELECT EXISTS (
       SELECT 1
       FROM pg_trigger g
       JOIN pg_class t ON t.oid = g.tgrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE n.nspname = 'mcp' AND t.relname = $1 AND g.tgname = $2 AND NOT g.tgisinternal
     ) AS exists`,
    [table, trigger]
  );
}

export async function migrationVerifyWithAdapter(adapter, migrations = MCP_MIGRATIONS) {
  const status = await migrationStatusWithAdapter(adapter, migrations);
  const checks = Object.freeze({
    schema: await exists(adapter, "SELECT to_regnamespace('mcp') IS NOT NULL AS exists"),
    idempotencyTable: await tableExists(adapter, "idempotency_records"),
    auditTable: await tableExists(adapter, "audit_events"),
    outboxTable: await tableExists(adapter, "outbox_events"),
    routeTable: await tableExists(adapter, "mcp_routes"),
    routeCustomerTable: await tableExists(adapter, "mcp_route_customers"),
    routeSessionTable: await tableExists(adapter, "mcp_route_sessions"),
    sessionCustomerTable: await tableExists(adapter, "mcp_session_customers"),
    accountView: await tableExists(adapter, "accounts"),
    productView: await tableExists(adapter, "products"),
    orderView: await tableExists(adapter, "orders"),
    runtimeGrantFunction: await functionExists(adapter, "shared.grant_mcp_runtime_access(name)"),
    idempotencyScopeConstraint: await constraintExists(
      adapter,
      "idempotency_records",
      "mcp_idempotency_records_scope_key"
    ),
    idempotencyStateConstraint: await constraintExists(
      adapter,
      "idempotency_records",
      "mcp_idempotency_records_state_shape"
    ),
    outboxStateConstraint: await constraintExists(
      adapter,
      "outbox_events",
      "mcp_outbox_events_published_shape"
    ),
    auditAppendOnlyTrigger: await triggerExists(
      adapter,
      "audit_events",
      "mcp_audit_events_append_only"
    ),
    outboxPendingIndex: await indexExists(adapter, "mcp_outbox_events_pending_available_idx"),
    routeCustomerOrderIndex: await indexExists(adapter, "mcp_route_customers_route_sort_idx")
  });
  const issues = [];
  if (status.pending.length) issues.push(`pending migrations: ${status.pending.join(", ")}`);
  for (const [name, value] of Object.entries(checks)) {
    if (!value) issues.push(`missing MCP migration contract: ${name}`);
  }
  return Object.freeze({ verified: issues.length === 0, issues: Object.freeze(issues), checks, status });
}

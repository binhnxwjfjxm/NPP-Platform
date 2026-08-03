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
const MCP_LEGACY_WRITE_CONTRACT_SQL = readFileSync(
  new URL("./sql/003_mcp_legacy_write_contract.sql", import.meta.url),
  "utf8"
);
const MCP_PROFILE_MEDIA_CONTRACT_SQL = readFileSync(
  new URL("./sql/004_mcp_profile_media_contract.sql", import.meta.url),
  "utf8"
);
const MCP_SESSION_RUNTIME_CONTRACT_SQL = readFileSync(
  new URL("./sql/005_mcp_session_runtime_contract.sql", import.meta.url),
  "utf8"
);
const MCP_CUSTOMER_ONBOARDING_SYNC_SQL = readFileSync(
  new URL("./sql/006_mcp_customer_onboarding_sync.sql", import.meta.url),
  "utf8"
);
const MCP_CORE_SALES_ORDER_SYNC_SQL = readFileSync(
  new URL("./sql/007_mcp_core_sales_order_sync.sql", import.meta.url),
  "utf8"
);

export const MCP_MIGRATIONS = Object.freeze([
  Object.freeze({ id: "mcp_001_write_foundation", sql: MCP_WRITE_FOUNDATION_SQL }),
  Object.freeze({ id: "mcp_002_domain_read_models", sql: MCP_DOMAIN_READ_MODELS_SQL }),
  Object.freeze({ id: "mcp_003_legacy_write_contract", sql: MCP_LEGACY_WRITE_CONTRACT_SQL }),
  Object.freeze({ id: "mcp_004_profile_media_contract", sql: MCP_PROFILE_MEDIA_CONTRACT_SQL }),
  Object.freeze({ id: "mcp_005_session_runtime_contract", sql: MCP_SESSION_RUNTIME_CONTRACT_SQL }),
  Object.freeze({ id: "mcp_006_customer_onboarding_sync", sql: MCP_CUSTOMER_ONBOARDING_SYNC_SQL }),
  Object.freeze({ id: "mcp_007_core_sales_order_sync", sql: MCP_CORE_SALES_ORDER_SYNC_SQL })
]);

const MCP_READ_MODELS = Object.freeze([
  "accounts",
  "market_reports",
  "mcp_archive_intents",
  "mcp_followups",
  "mcp_outlet_media",
  "mcp_report_setting_groups",
  "mcp_report_settings",
  "mcp_report_templates",
  "mcp_route_customers",
  "mcp_route_sessions",
  "mcp_routes",
  "mcp_session_customers",
  "mcp_session_reports",
  "mcp_storage_delete_jobs",
  "mcp_visits",
  "order_items",
  "orders",
  "product_variants",
  "products",
  "route_customers",
  "test_customer_results",
  "test_customers",
  "test_file_products",
  "test_files"
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

async function columnExists(adapter, table, column) {
  return exists(
    adapter,
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'mcp' AND table_name = $1 AND column_name = $2
     ) AS exists`,
    [table, column]
  );
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
  const readModelChecks = Object.fromEntries(
    await Promise.all(MCP_READ_MODELS.map(async (name) => [`readModel:${name}`, await tableExists(adapter, name)]))
  );
  const checks = Object.freeze({
    schema: await exists(adapter, "SELECT to_regnamespace('mcp') IS NOT NULL AS exists"),
    idempotencyTable: await tableExists(adapter, "idempotency_records"),
    auditTable: await tableExists(adapter, "audit_events"),
    outboxTable: await tableExists(adapter, "outbox_events"),
    runtimeGrantFunction: await functionExists(adapter, "shared.grant_mcp_runtime_access(name)"),
    profileMediaLimitFunction: await functionExists(adapter, "mcp.enforce_outlet_media_limit()"),
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
    profileMediaLimitTrigger: await triggerExists(
      adapter,
      "mcp_outlet_media",
      "mcp_outlet_media_limit"
    ),
    sessionVisitedCounterTrigger: await triggerExists(
      adapter,
      "mcp_session_customers",
      "mcp_session_customers_visited_counter"
    ),
    customerOnboardingRequestColumn: await columnExists(adapter, "orders", "customer_onboarding_request_id"),
    customerOnboardingStatusColumn: await columnExists(adapter, "orders", "customer_onboarding_status"),
    customerOnboardingFingerprintColumn: await columnExists(adapter, "orders", "customer_onboarding_fingerprint"),
    customerOnboardingShapeConstraint: await constraintExists(
      adapter,
      "orders",
      "mcp_orders_customer_onboarding_shape"
    ),
    customerOnboardingRequestIndex: await indexExists(adapter, "mcp_orders_customer_onboarding_request_unique"),
    coreSalesOrderIdColumn: await columnExists(adapter, "orders", "core_sales_order_id"),
    coreSalesOrderStatusColumn: await columnExists(adapter, "orders", "core_sales_order_status"),
    coreSalesOrderFingerprintColumn: await columnExists(adapter, "orders", "core_sales_order_fingerprint"),
    coreSalesOrderShapeConstraint: await constraintExists(
      adapter,
      "orders",
      "mcp_orders_core_sales_order_shape"
    ),
    coreSalesOrderUniqueIndex: await indexExists(adapter, "mcp_orders_core_sales_order_unique"),
    outboxPendingIndex: await indexExists(adapter, "mcp_outbox_events_pending_available_idx"),
    routeCustomerOrderIndex: await indexExists(adapter, "mcp_route_customers_route_sort_idx"),
    orderItemsIndex: await indexExists(adapter, "order_items_order_idx"),
    outletMediaRouteCustomerIndex: await indexExists(adapter, "mcp_outlet_media_route_customer_idx"),
    outletMediaDeleteRetryIndex: await indexExists(adapter, "mcp_outlet_media_delete_retry_idx"),
    archiveIntentStatusIndex: await indexExists(adapter, "mcp_archive_intents_status_idx"),
    ...readModelChecks
  });
  const issues = [];
  if (status.pending.length) issues.push(`pending migrations: ${status.pending.join(", ")}`);
  for (const [name, value] of Object.entries(checks)) {
    if (!value) issues.push(`missing MCP migration contract: ${name}`);
  }
  return Object.freeze({ verified: issues.length === 0, issues: Object.freeze(issues), checks, status });
}

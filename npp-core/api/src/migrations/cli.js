import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { CORE_API_MIGRATIONS, runMigrations } from './index.js';
import { PERMISSION_CATALOG } from '../access/permissions.js';

export const PRODUCTION_ALLOW_ENV = 'MIGRATION_ALLOW_PRODUCTION';
export const PRODUCTION_CONFIRM_ENV = 'MIGRATION_PRODUCTION_CONFIRM';
export const PRODUCTION_CONFIRM_VALUE = 'I_UNDERSTAND_THIS_TARGETS_PRODUCTION';

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

export function parseDatabaseUrl(value) {
  if (!value) fail('missing_database_url', 'DATABASE_URL is required for migration commands');
  let url;
  try {
    url = new URL(value);
  } catch {
    fail('invalid_database_url', 'DATABASE_URL must be a valid PostgreSQL connection string');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    fail('invalid_database_url', 'DATABASE_URL must use postgres or postgresql scheme');
  }
  return url.toString();
}

function hashIdentifier(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 12);
}

export function sanitizeDatabaseIdentifier(connectionString) {
  try {
    const url = new URL(connectionString);
    const dbName = url.pathname ? decodeURIComponent(url.pathname.slice(1)) : 'unknown';
    return `database:${hashIdentifier(dbName || 'unknown')}`;
  } catch {
    return 'database:unknown';
  }
}

export function redactSensitiveText(value, connectionString) {
  let text = String(value ?? '');
  if (connectionString) text = text.split(String(connectionString)).join('[REDACTED_DATABASE_URL]');
  text = text.replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gi, '[REDACTED_DATABASE_URL]');

  try {
    const url = new URL(connectionString);
    const sensitiveParts = [url.username, url.password, url.hostname].filter(Boolean);
    for (const part of sensitiveParts) {
      text = text.split(decodeURIComponent(part)).join('[REDACTED]');
      text = text.split(part).join('[REDACTED]');
    }
  } catch {
    // The generic PostgreSQL URL pattern above still protects raw URLs.
  }

  return text;
}

export function assertMigrationSafety({
  nodeEnv = process.env.NODE_ENV,
  allowProduction = process.env[PRODUCTION_ALLOW_ENV],
  productionConfirm = process.env[PRODUCTION_CONFIRM_ENV],
} = {}) {
  const isProduction = String(nodeEnv ?? '').trim().toLowerCase() === 'production';
  if (!isProduction) return;

  if (allowProduction !== 'true' || productionConfirm !== PRODUCTION_CONFIRM_VALUE) {
    fail(
      'production_migration_forbidden',
      `Production migration commands require both ${PRODUCTION_ALLOW_ENV}=true and ${PRODUCTION_CONFIRM_ENV}=${PRODUCTION_CONFIRM_VALUE}`,
    );
  }
}

function jsonLog(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function createPool(connectionString) {
  return new Pool({ connectionString });
}

async function closePool(pool) {
  if (pool) await pool.end();
}

async function schemaMigrationsTableExists(adapter) {
  const result = await adapter.query(
    `SELECT to_regclass('shared.schema_migrations') IS NOT NULL AS exists`,
  );
  return result.rows?.[0]?.exists === true;
}

export function buildMigrationStatus(applied, all = CORE_API_MIGRATIONS) {
  const appliedSet = new Set(applied);
  return Object.freeze({
    applied: Object.freeze([...applied]),
    pending: Object.freeze(all.filter((migration) => !appliedSet.has(migration.id)).map((migration) => migration.id)),
  });
}

export async function migrationStatusWithAdapter(adapter, migrations = CORE_API_MIGRATIONS) {
  if (!(await schemaMigrationsTableExists(adapter))) return buildMigrationStatus([], migrations);
  const result = await adapter.query('SELECT id FROM shared.schema_migrations ORDER BY id');
  const applied = (result.rows ?? []).map((row) => String(row.id));
  return buildMigrationStatus(applied, migrations);
}

export async function migrationStatus({ databaseUrl }) {
  const connectionString = parseDatabaseUrl(databaseUrl);
  const pool = createPool(connectionString);
  try {
    return await migrationStatusWithAdapter(pool);
  } finally {
    await closePool(pool);
  }
}

export async function migrationMigrate({ databaseUrl }) {
  const connectionString = parseDatabaseUrl(databaseUrl);
  const pool = createPool(connectionString);
  try {
    const result = await runMigrations(pool, CORE_API_MIGRATIONS);
    return Object.freeze({ applied: result.applied });
  } finally {
    await closePool(pool);
  }
}

async function tableExists(adapter, schema, table) {
  const result = await adapter.query('SELECT to_regclass($1) IS NOT NULL AS exists', [`${schema}.${table}`]);
  return result.rows?.[0]?.exists === true;
}

async function constraintExists(adapter, schema, table, constraint) {
  const result = await adapter.query(
    `SELECT EXISTS (
       SELECT 1
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE n.nspname = $1 AND t.relname = $2 AND c.conname = $3
     ) AS exists`,
    [schema, table, constraint],
  );
  return result.rows?.[0]?.exists === true;
}

async function indexExists(adapter, schema, index) {
  const result = await adapter.query(
    'SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = $1 AND indexname = $2) AS exists',
    [schema, index],
  );
  return result.rows?.[0]?.exists === true;
}

async function triggerExists(adapter, schema, table, trigger) {
  const result = await adapter.query(
    `SELECT EXISTS (
       SELECT 1
       FROM pg_trigger g
       JOIN pg_class t ON t.oid = g.tgrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE n.nspname = $1 AND t.relname = $2 AND g.tgname = $3 AND NOT g.tgisinternal
     ) AS exists`,
    [schema, table, trigger],
  );
  return result.rows?.[0]?.exists === true;
}

async function permissionCatalogRows(adapter) {
  const result = await adapter.query(
    `SELECT permission_key, module, label, description, is_system
     FROM shared.permission_catalog
     ORDER BY permission_key ASC`,
  );
  return result.rows ?? [];
}

function comparePermissionCatalog(rows) {
  const issues = [];
  const expected = new Map(PERMISSION_CATALOG.map((entry) => [
    entry.permissionKey,
    {
      module: entry.module,
      label: entry.label,
      description: entry.description,
      is_system: entry.isSystem,
    },
  ]));
  const actual = new Map((rows ?? []).map((row) => [
    String(row.permission_key),
    {
      module: String(row.module),
      label: String(row.label),
      description: String(row.description),
      is_system: Boolean(row.is_system),
    },
  ]));

  for (const [permissionKey, expectedRow] of expected.entries()) {
    const actualRow = actual.get(permissionKey);
    if (!actualRow) {
      issues.push(`missing permission catalog row ${permissionKey}`);
      continue;
    }
    if (actualRow.module !== expectedRow.module) issues.push(`permission catalog module mismatch for ${permissionKey}`);
    if (actualRow.label !== expectedRow.label) issues.push(`permission catalog label mismatch for ${permissionKey}`);
    if (actualRow.description !== expectedRow.description) issues.push(`permission catalog description mismatch for ${permissionKey}`);
    if (actualRow.is_system !== expectedRow.is_system) issues.push(`permission catalog system flag mismatch for ${permissionKey}`);
  }

  for (const permissionKey of actual.keys()) {
    if (!expected.has(permissionKey)) {
      issues.push(`unexpected permission catalog row ${permissionKey}`);
    }
  }

  return issues;
}

export function collectVerificationIssues({ status, tables, constraints, triggers, indexes }) {
  const issues = [];
  if (status.pending.length > 0) issues.push(`pending migrations: ${status.pending.join(', ')}`);

  for (const [name, exists] of Object.entries(tables)) {
    if (!exists) issues.push(`missing table ${name}`);
  }
  for (const [name, exists] of Object.entries(constraints)) {
    if (!exists) issues.push(`missing constraint ${name}`);
  }
  for (const [name, exists] of Object.entries(triggers)) {
    if (!exists) issues.push(`missing trigger ${name}`);
  }
  for (const [name, exists] of Object.entries(indexes)) {
    if (!exists) issues.push(`missing index ${name}`);
  }
  return issues;
}

export async function migrationVerifyWithAdapter(adapter) {
  const status = await migrationStatusWithAdapter(adapter);
  const tables = {
    'shared.schema_migrations': await tableExists(adapter, 'shared', 'schema_migrations'),
    'shared.core_idempotency_records': await tableExists(adapter, 'shared', 'core_idempotency_records'),
    'shared.core_audit_records': await tableExists(adapter, 'shared', 'core_audit_records'),
    'shared.core_outbox_events': await tableExists(adapter, 'shared', 'core_outbox_events'),
    'shared.branches': await tableExists(adapter, 'shared', 'branches'),
    'shared.warehouses': await tableExists(adapter, 'shared', 'warehouses'),
    'shared.warehouse_locations': await tableExists(adapter, 'shared', 'warehouse_locations'),
    'shared.employees': await tableExists(adapter, 'shared', 'employees'),
    'shared.permission_catalog': await tableExists(adapter, 'shared', 'permission_catalog'),
    'shared.roles': await tableExists(adapter, 'shared', 'roles'),
    'shared.role_permissions': await tableExists(adapter, 'shared', 'role_permissions'),
    'inventory.inventory_scope_versions': await tableExists(adapter, 'inventory', 'inventory_scope_versions'),
    'inventory.stocktakes': await tableExists(adapter, 'inventory', 'stocktakes'),
    'inventory.stocktake_rounds': await tableExists(adapter, 'inventory', 'stocktake_rounds'),
    'inventory.stocktake_lines': await tableExists(adapter, 'inventory', 'stocktake_lines'),
  };
  const constraints = {
    core_idempotency_records_scope_key: await constraintExists(adapter, 'shared', 'core_idempotency_records', 'core_idempotency_records_scope_key'),
    core_idempotency_records_state_shape: await constraintExists(adapter, 'shared', 'core_idempotency_records', 'core_idempotency_records_state_shape'),
    core_outbox_events_published_state: await constraintExists(adapter, 'shared', 'core_outbox_events', 'core_outbox_events_published_state'),
    branches_code_installation_unique: await constraintExists(adapter, 'shared', 'branches', 'branches_code_installation_unique'),
    warehouses_code_installation_unique: await constraintExists(adapter, 'shared', 'warehouses', 'warehouses_code_installation_unique'),
    warehouse_locations_code_warehouse_unique: await constraintExists(adapter, 'shared', 'warehouse_locations', 'warehouse_locations_code_warehouse_unique'),
    employees_code_installation_unique: await constraintExists(adapter, 'shared', 'employees', 'employees_code_installation_unique'),
    employees_branch_installation_fk: await constraintExists(adapter, 'shared', 'employees', 'employees_branch_installation_fk'),
    permission_catalog_pkey: await constraintExists(adapter, 'shared', 'permission_catalog', 'permission_catalog_pkey'),
    roles_code_installation_unique: await constraintExists(adapter, 'shared', 'roles', 'roles_code_installation_unique'),
    roles_id_installation_unique: await constraintExists(adapter, 'shared', 'roles', 'roles_id_installation_unique'),
    role_permissions_pkey: await constraintExists(adapter, 'shared', 'role_permissions', 'role_permissions_pkey'),
    role_permissions_role_installation_fk: await constraintExists(adapter, 'shared', 'role_permissions', 'role_permissions_role_installation_fk'),
    role_permissions_permission_catalog_fk: await constraintExists(adapter, 'shared', 'role_permissions', 'role_permissions_permission_catalog_fk'),
  };
  const triggers = {
    core_audit_records_append_only: await triggerExists(adapter, 'shared', 'core_audit_records', 'core_audit_records_append_only'),
    roles_code_immutable: await triggerExists(adapter, 'shared', 'roles', 'roles_code_immutable'),
    inventory_movement_lines_scope_version: await triggerExists(adapter, 'inventory', 'inventory_movement_lines', 'inventory_movement_lines_scope_version'),
    stocktake_lines_history_guard: await triggerExists(adapter, 'inventory', 'stocktake_lines', 'stocktake_lines_history_guard'),
  };
  const indexes = {
    core_outbox_events_pending_available_idx: await indexExists(adapter, 'shared', 'core_outbox_events_pending_available_idx'),
    branches_installation_active_idx: await indexExists(adapter, 'shared', 'branches_installation_active_idx'),
    warehouses_branch_idx: await indexExists(adapter, 'shared', 'warehouses_branch_idx'),
    warehouse_locations_warehouse_idx: await indexExists(adapter, 'shared', 'warehouse_locations_warehouse_idx'),
    employees_installation_active_idx: await indexExists(adapter, 'shared', 'employees_installation_active_idx'),
    employees_installation_branch_idx: await indexExists(adapter, 'shared', 'employees_installation_branch_idx'),
    permission_catalog_module_idx: await indexExists(adapter, 'shared', 'permission_catalog_module_idx'),
    roles_installation_active_idx: await indexExists(adapter, 'shared', 'roles_installation_active_idx'),
    roles_installation_code_idx: await indexExists(adapter, 'shared', 'roles_installation_code_idx'),
    role_permissions_role_idx: await indexExists(adapter, 'shared', 'role_permissions_role_idx'),
    role_permissions_permission_idx: await indexExists(adapter, 'shared', 'role_permissions_permission_idx'),
    stocktakes_list_idx: await indexExists(adapter, 'inventory', 'stocktakes_list_idx'),
    stocktake_rounds_stocktake_idx: await indexExists(adapter, 'inventory', 'stocktake_rounds_stocktake_idx'),
    stocktake_lines_scope_idx: await indexExists(adapter, 'inventory', 'stocktake_lines_scope_idx'),
  };

  const issues = collectVerificationIssues({ status, tables, constraints, triggers, indexes });
  if (tables['shared.permission_catalog']) {
    issues.push(...comparePermissionCatalog(await permissionCatalogRows(adapter)));
  }
  return Object.freeze({ verified: issues.length === 0, issues: Object.freeze(issues) });
}

export async function migrationVerify({ databaseUrl }) {
  const connectionString = parseDatabaseUrl(databaseUrl);
  const pool = createPool(connectionString);
  try {
    return await migrationVerifyWithAdapter(pool);
  } finally {
    await closePool(pool);
  }
}

function usage() {
  process.stderr.write('Usage: node src/migrations/cli.js <status|migrate|verify>\n');
}

export async function runMigrationCommand(command, env = process.env) {
  let databaseUrl = null;
  let identifier = 'database:unknown';

  try {
    databaseUrl = parseDatabaseUrl(env.DATABASE_URL);
    assertMigrationSafety({
      nodeEnv: env.NODE_ENV,
      allowProduction: env[PRODUCTION_ALLOW_ENV],
      productionConfirm: env[PRODUCTION_CONFIRM_ENV],
    });
    identifier = sanitizeDatabaseIdentifier(databaseUrl);
    jsonLog({ timestamp: new Date().toISOString(), command, databaseIdentifier: identifier, status: 'started' });

    let result;
    if (command === 'status') result = await migrationStatus({ databaseUrl });
    else if (command === 'migrate') result = await migrationMigrate({ databaseUrl });
    else if (command === 'verify') result = await migrationVerify({ databaseUrl });
    else {
      usage();
      return 2;
    }

    jsonLog({ timestamp: new Date().toISOString(), command, databaseIdentifier: identifier, status: 'success', result });
    return command === 'verify' && result.verified === false ? 1 : 0;
  } catch (error) {
    jsonLog({
      timestamp: new Date().toISOString(),
      command,
      databaseIdentifier: identifier,
      status: 'error',
      error: {
        code: error.code || 'UNKNOWN_ERROR',
        message: redactSensitiveText(error.message, databaseUrl),
      },
    });
    return 1;
  }
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  const command = process.argv[2];
  if (!command) {
    usage();
    process.exitCode = 2;
  } else {
    process.exitCode = await runMigrationCommand(command);
  }
}

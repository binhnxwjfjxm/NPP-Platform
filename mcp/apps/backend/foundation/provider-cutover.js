import { createHash } from "node:crypto";

export const CORE_OWNED_SCHEMAS = Object.freeze([
  "shared",
  "sales",
  "purchasing",
  "inventory",
  "logistics",
  "accounting",
  "reporting"
]);
export const REQUIRED_MCP_MIGRATIONS = Object.freeze(["mcp_001_write_foundation"]);
export const REQUIRED_RUNTIME_CONFIG_NAMES = Object.freeze([
  "AUTH_MODE",
  "BACKEND_API_TOKEN",
  "CORS_ORIGINS",
  "DATABASE_URL",
  "INSTALLATION_ID",
  "MCP_DB_ROLE",
  "MCP_DB_SCHEMA",
  "MCP_LEGACY_ACTOR_ID",
  "MCP_LEGACY_RUNTIME_ENABLED",
  "MCP_SERVICE_PERMISSIONS",
  "MCP_SERVICE_ROLES",
  "MCP_SERVICE_SCOPES",
  "NODE_ENV",
  "NPP_CODE",
  "PERSISTENCE_PROVIDER"
]);
export const REQUIRED_CUTOVER_SEQUENCE = Object.freeze([
  "audit-provider-state",
  "verify-current-backup",
  "verify-restore-rehearsal",
  "provision-separate-migrator-role",
  "provision-restricted-runtime-role",
  "attach-runtime-database",
  "run-mcp-migrations",
  "run-read-only-preflight",
  "deploy-mcp-backend",
  "smoke-health-live",
  "smoke-health-ready",
  "hold-field-traffic-cutover"
]);

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const ROLE_PATTERN = /^[a-z_][a-z0-9_]{1,62}$/;
const VARIABLE_PATTERN = /^[A-Z][A-Z0-9_]{1,127}$/;
const EVIDENCE_PATTERN = /^(?:NOT_VERIFIED|[a-z][a-z0-9_-]{1,31}:[A-Za-z0-9._:-]{2,255})$/;
const FORBIDDEN_KEY_PATTERN = /(token|password|secret|database.?url|connection.?string|attachment.?value|api.?key)/i;
const FORBIDDEN_VALUE_PATTERNS = [
  /https?:\/\//i,
  /postgres(?:ql)?:\/\//i,
  /\b(?:password|secret|token|api[_-]?key)\s*[:=]/i
];

function text(value) {
  return String(value ?? "").trim();
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function issue(list, code) {
  if (!list.includes(code)) list.push(code);
}

function validEvidence(value) {
  return EVIDENCE_PATTERN.test(text(value));
}

function scanForSecrets(value, issues, path = "plan") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForSecrets(item, issues, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && FORBIDDEN_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
      issue(issues, `forbidden_sensitive_value:${path}`);
    }
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (FORBIDDEN_KEY_PATTERN.test(key)) issue(issues, `forbidden_sensitive_key:${childPath}`);
    scanForSecrets(child, issues, childPath);
  }
}

export function hashIdentifier(value, prefix = "value") {
  return `${prefix}:${createHash("sha256").update(String(value ?? "")).digest("hex").slice(0, 12)}`;
}

export function redactSensitiveText(value, secrets = []) {
  let output = String(value ?? "");
  output = output.replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gi, "[REDACTED_DATABASE_URL]");
  output = output.replace(/https?:\/\/[^\s'"`]+/gi, "[REDACTED_URL]");
  for (const secret of (Array.isArray(secrets) ? secrets : [secrets]).filter(Boolean)) {
    const raw = String(secret);
    for (const part of new Set([raw, (() => { try { return decodeURIComponent(raw); } catch { return raw; } })()])) {
      if (part) output = output.split(part).join("[REDACTED]");
    }
  }
  return output;
}

export function digestCutoverPlan(plan) {
  return `sha256:${createHash("sha256").update(JSON.stringify(plan)).digest("hex")}`;
}

export function validateCutoverPlan(plan, { expectedSourceCommit = null } = {}) {
  const issues = [];
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    return Object.freeze({ valid: false, issues: Object.freeze(["plan_object_required"]) });
  }
  scanForSecrets(plan, issues);

  if (plan.schemaVersion !== 1) issue(issues, "unsupported_schema_version");
  if (plan.phase !== "6C.0F") issue(issues, "phase_mismatch");
  if (!new Set(["DRAFT_NOT_AUTHORIZED", "READY_FOR_OWNER_APPROVAL", "APPROVED_FOR_OPERATION"]).has(plan.approvalState)) {
    issue(issues, "invalid_approval_state");
  }

  const source = plan.source ?? {};
  if (source.repository !== "binhnxwjfjxm/NPP-Platform") issue(issues, "source_repository_mismatch");
  if (source.branch !== "main") issue(issues, "source_branch_mismatch");
  if (!SHA_PATTERN.test(text(source.commit))) issue(issues, "invalid_source_commit");
  if (expectedSourceCommit && source.commit !== expectedSourceCommit) issue(issues, "source_commit_mismatch");

  const providerAudit = plan.providerAudit ?? {};
  if (!validEvidence(providerAudit.evidenceRef)) issue(issues, "invalid_provider_audit_evidence");
  if (providerAudit.heroku?.coreApp !== "hung-phat") issue(issues, "core_app_mismatch");
  if (providerAudit.heroku?.mcpApp !== "hung-phat-mcp") issue(issues, "mcp_app_mismatch");
  if (providerAudit.heroku?.autoDeployOff !== true) issue(issues, "heroku_auto_deploy_must_be_off");
  if (providerAudit.vercel?.autoDeployOff !== true) issue(issues, "vercel_auto_deploy_must_be_off");
  if (!validEvidence(providerAudit.heroku?.currentMcpReleaseRef)) issue(issues, "invalid_mcp_release_evidence");
  if (!validEvidence(providerAudit.vercel?.currentMcpDeploymentRef)) issue(issues, "invalid_mcp_deployment_evidence");

  const backup = plan.backup ?? {};
  if (!new Set(["NOT_VERIFIED", "VERIFIED"]).has(backup.status)) issue(issues, "invalid_backup_status");
  if (!validEvidence(backup.evidenceRef)) issue(issues, "invalid_backup_evidence");
  if (!new Set(["NOT_VERIFIED", "VERIFIED"]).has(backup.restoreRehearsalStatus)) issue(issues, "invalid_restore_rehearsal_status");
  if (!validEvidence(backup.restoreRehearsalRef)) issue(issues, "invalid_restore_rehearsal_evidence");

  const roles = plan.roles ?? {};
  if (!ROLE_PATTERN.test(text(roles.runtime))) issue(issues, "invalid_runtime_role");
  if (!ROLE_PATTERN.test(text(roles.migrator))) issue(issues, "invalid_migrator_role");
  if (roles.runtime === roles.migrator || roles.distinct !== true) issue(issues, "runtime_migrator_roles_not_distinct");

  const configNames = Array.isArray(plan.configVariableNames) ? plan.configVariableNames : [];
  if (!configNames.length || configNames.some((name) => !VARIABLE_PATTERN.test(text(name)))) issue(issues, "invalid_config_variable_names");
  if (new Set(configNames).size !== configNames.length) issue(issues, "duplicate_config_variable_names");
  for (const requiredName of REQUIRED_RUNTIME_CONFIG_NAMES) {
    if (!configNames.includes(requiredName)) issue(issues, `missing_config_variable_name:${requiredName}`);
  }
  if (configNames.includes("MCP_MIGRATION_DATABASE_URL")) issue(issues, "migration_credential_must_not_be_runtime_config");

  const sequence = Array.isArray(plan.sequence) ? plan.sequence : [];
  if (JSON.stringify(sequence) !== JSON.stringify(REQUIRED_CUTOVER_SEQUENCE)) issue(issues, "cutover_sequence_mismatch");

  const rollback = plan.rollback ?? {};
  if (!text(rollback.owner)) issue(issues, "rollback_owner_required");
  if (!Array.isArray(rollback.decisionCriteria) || rollback.decisionCriteria.length < 2) issue(issues, "rollback_criteria_incomplete");
  if (!validEvidence(rollback.previousReleaseRef)) issue(issues, "invalid_previous_release_evidence");
  if (!validEvidence(rollback.previousConfigEvidenceRef)) issue(issues, "invalid_previous_config_evidence");
  if (rollback.databaseStrategy !== "LEAVE_ADDITIVE_MCP_SCHEMA_INERT") issue(issues, "invalid_database_rollback_strategy");

  const maintenance = plan.maintenanceWindow ?? {};
  if (!text(maintenance.startsAt) || !text(maintenance.endsAt) || !text(maintenance.timezone)) issue(issues, "maintenance_window_incomplete");
  if (maintenance.startsAt && Number.isNaN(Date.parse(maintenance.startsAt))) issue(issues, "invalid_maintenance_start");
  if (maintenance.endsAt && Number.isNaN(Date.parse(maintenance.endsAt))) issue(issues, "invalid_maintenance_end");
  if (Date.parse(maintenance.endsAt) <= Date.parse(maintenance.startsAt)) issue(issues, "maintenance_window_order_invalid");

  if (!text(plan.accountableOperator)) issue(issues, "accountable_operator_required");
  if (!Array.isArray(plan.abortCriteria) || plan.abortCriteria.length < 3) issue(issues, "abort_criteria_incomplete");

  const mutations = plan.productionMutations ?? {};
  for (const key of [
    "databaseAttached",
    "rolesOrGrantsChanged",
    "backupRequested",
    "migrationRun",
    "backendDeployed",
    "trafficCutover"
  ]) {
    if (mutations[key] !== false) issue(issues, `production_mutation_must_be_false:${key}`);
  }

  return Object.freeze({ valid: issues.length === 0, issues: Object.freeze(issues.sort()) });
}

export function assessCutoverReadiness(plan, options = {}) {
  const validation = validateCutoverPlan(plan, options);
  const blockers = [...validation.issues];
  if (plan?.approvalState !== "APPROVED_FOR_OPERATION") issue(blockers, "owner_approval_missing");
  if (plan?.providerAudit?.evidenceRef === "NOT_VERIFIED") issue(blockers, "provider_audit_not_verified");
  if (plan?.providerAudit?.heroku?.currentMcpReleaseRef === "NOT_VERIFIED") issue(blockers, "mcp_release_not_verified");
  if (plan?.providerAudit?.vercel?.currentMcpDeploymentRef === "NOT_VERIFIED") issue(blockers, "mcp_deployment_not_verified");
  if (plan?.backup?.status !== "VERIFIED") issue(blockers, "current_backup_not_verified");
  if (plan?.backup?.restoreRehearsalStatus !== "VERIFIED") issue(blockers, "restore_rehearsal_not_verified");
  if (plan?.rollback?.previousReleaseRef === "NOT_VERIFIED") issue(blockers, "rollback_release_not_verified");
  if (plan?.rollback?.previousConfigEvidenceRef === "NOT_VERIFIED") issue(blockers, "rollback_config_not_verified");
  return Object.freeze({ ready: blockers.length === 0, blockers: Object.freeze(blockers.sort()) });
}

function activeSearchPath(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
}

function rows(result) {
  return Array.isArray(result?.rows) ? result.rows : [];
}

async function rollback(adapter) {
  try { await adapter.query("ROLLBACK"); } catch { /* preserve original failure */ }
}

export async function captureRuntimeIdentity(adapter) {
  if (!adapter || typeof adapter.query !== "function") throw new TypeError("runtime_adapter_required");
  let began = false;
  try {
    await adapter.query("BEGIN READ ONLY");
    began = true;
    const result = await adapter.query(`
      SELECT current_user AS role,
             current_setting('search_path') AS search_path,
             current_database() AS database_name,
             current_setting('server_version') AS server_version,
             COALESCE((SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()), false) AS ssl
    `);
    const row = rows(result)[0] ?? {};
    await adapter.query("ROLLBACK");
    began = false;
    return deepFreeze({
      databaseFingerprint: hashIdentifier(row.database_name, "database"),
      role: text(row.role),
      searchPath: activeSearchPath(row.search_path),
      serverVersion: text(row.server_version),
      ssl: row.ssl === true
    });
  } catch (error) {
    if (began) await rollback(adapter);
    throw error;
  }
}

export async function captureInstallationAudit(adapter, { runtimeRole, coreSchemas = CORE_OWNED_SCHEMAS } = {}) {
  if (!adapter || typeof adapter.query !== "function") throw new TypeError("audit_adapter_required");
  if (!ROLE_PATTERN.test(text(runtimeRole))) throw new TypeError("runtime_role_invalid");
  let began = false;
  try {
    await adapter.query("BEGIN READ ONLY");
    began = true;
    const identity = rows(await adapter.query(`
      SELECT current_database() AS database_name,
             current_setting('server_version') AS server_version
    `))[0] ?? {};
    const role = rows(await adapter.query(
      "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS exists",
      [runtimeRole]
    ))[0] ?? {};
    const schema = rows(await adapter.query(
      "SELECT to_regnamespace('mcp') IS NOT NULL AS schema_available, to_regclass('shared.schema_migrations') IS NOT NULL AS registry_available"
    ))[0] ?? {};
    let migrations = [];
    if (schema.registry_available === true) {
      migrations = rows(await adapter.query(
        "SELECT id FROM shared.schema_migrations WHERE split_part(id, '_', 1) = 'mcp' ORDER BY id"
      )).map((row) => text(row.id));
    }
    const objects = rows(await adapter.query(`
      SELECT
        to_regclass('mcp.idempotency_records') IS NOT NULL AS idempotency_table,
        to_regclass('mcp.audit_events') IS NOT NULL AS audit_table,
        to_regclass('mcp.outbox_events') IS NOT NULL AS outbox_table,
        EXISTS (
          SELECT 1 FROM pg_trigger g
          JOIN pg_class t ON t.oid = g.tgrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
          WHERE n.nspname = 'mcp' AND t.relname = 'audit_events'
            AND g.tgname = 'mcp_audit_events_append_only' AND NOT g.tgisinternal
        ) AS audit_append_only_trigger,
        EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE schemaname = 'mcp' AND indexname = 'mcp_outbox_events_pending_available_idx'
        ) AS outbox_pending_index
    `))[0] ?? {};
    let privileges = {};
    let schemaWrites = [];
    let tableWrites = [];
    if (role.exists === true) {
      privileges = rows(await adapter.query(`
        SELECT
          CASE WHEN to_regnamespace('mcp') IS NULL THEN false ELSE has_schema_privilege($1, to_regnamespace('mcp'), 'USAGE') END AS mcp_schema_usage,
          CASE WHEN to_regnamespace('mcp') IS NULL THEN false ELSE has_schema_privilege($1, to_regnamespace('mcp'), 'CREATE') END AS mcp_schema_create,
          CASE WHEN to_regclass('mcp.idempotency_records') IS NULL THEN false ELSE has_table_privilege($1, to_regclass('mcp.idempotency_records'), 'SELECT') END AS idempotency_select,
          CASE WHEN to_regclass('mcp.idempotency_records') IS NULL THEN false ELSE has_table_privilege($1, to_regclass('mcp.idempotency_records'), 'INSERT') END AS idempotency_insert,
          CASE WHEN to_regclass('mcp.idempotency_records') IS NULL THEN false ELSE has_table_privilege($1, to_regclass('mcp.idempotency_records'), 'UPDATE') END AS idempotency_update,
          CASE WHEN to_regclass('mcp.idempotency_records') IS NULL THEN false ELSE has_table_privilege($1, to_regclass('mcp.idempotency_records'), 'DELETE') END AS idempotency_delete,
          CASE WHEN to_regclass('mcp.audit_events') IS NULL THEN false ELSE has_table_privilege($1, to_regclass('mcp.audit_events'), 'SELECT') END AS audit_select,
          CASE WHEN to_regclass('mcp.audit_events') IS NULL THEN false ELSE has_table_privilege($1, to_regclass('mcp.audit_events'), 'INSERT') END AS audit_insert,
          CASE WHEN to_regclass('mcp.audit_events') IS NULL THEN false ELSE has_table_privilege($1, to_regclass('mcp.audit_events'), 'UPDATE') END AS audit_update,
          CASE WHEN to_regclass('mcp.audit_events') IS NULL THEN false ELSE has_table_privilege($1, to_regclass('mcp.audit_events'), 'DELETE') END AS audit_delete,
          CASE WHEN to_regclass('mcp.outbox_events') IS NULL THEN false ELSE has_table_privilege($1, to_regclass('mcp.outbox_events'), 'SELECT') END AS outbox_select,
          CASE WHEN to_regclass('mcp.outbox_events') IS NULL THEN false ELSE has_table_privilege($1, to_regclass('mcp.outbox_events'), 'INSERT') END AS outbox_insert,
          CASE WHEN to_regclass('mcp.outbox_events') IS NULL THEN false ELSE has_table_privilege($1, to_regclass('mcp.outbox_events'), 'UPDATE') END AS outbox_update,
          CASE WHEN to_regclass('mcp.outbox_events') IS NULL THEN false ELSE has_table_privilege($1, to_regclass('mcp.outbox_events'), 'DELETE') END AS outbox_delete
      `, [runtimeRole]))[0] ?? {};
      schemaWrites = rows(await adapter.query(`
        SELECT nspname AS schema_name
        FROM pg_namespace
        WHERE nspname = ANY($2::text[])
          AND has_schema_privilege($1, oid, 'CREATE')
        ORDER BY nspname
      `, [runtimeRole, coreSchemas])).map((row) => text(row.schema_name));
      tableWrites = rows(await adapter.query(`
        SELECT n.nspname AS schema_name, c.relname AS table_name
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = ANY($2::text[])
          AND c.relkind IN ('r', 'p')
          AND (
            has_table_privilege($1, c.oid, 'INSERT') OR
            has_table_privilege($1, c.oid, 'UPDATE') OR
            has_table_privilege($1, c.oid, 'DELETE') OR
            has_table_privilege($1, c.oid, 'TRUNCATE') OR
            has_table_privilege($1, c.oid, 'REFERENCES') OR
            has_table_privilege($1, c.oid, 'TRIGGER')
          )
        ORDER BY n.nspname, c.relname
      `, [runtimeRole, coreSchemas])).map((row) => `${text(row.schema_name)}.${text(row.table_name)}`);
    }
    await adapter.query("ROLLBACK");
    began = false;
    return deepFreeze({
      databaseFingerprint: hashIdentifier(identity.database_name, "database"),
      serverVersion: text(identity.server_version),
      runtimeRoleExists: role.exists === true,
      schemaAvailable: schema.schema_available === true,
      registryAvailable: schema.registry_available === true,
      migrations,
      objects: {
        idempotencyTable: objects.idempotency_table === true,
        auditTable: objects.audit_table === true,
        outboxTable: objects.outbox_table === true,
        auditAppendOnlyTrigger: objects.audit_append_only_trigger === true,
        outboxPendingIndex: objects.outbox_pending_index === true
      },
      privileges: {
        mcpSchemaUsage: privileges.mcp_schema_usage === true,
        mcpSchemaCreate: privileges.mcp_schema_create === true,
        idempotency: {
          select: privileges.idempotency_select === true,
          insert: privileges.idempotency_insert === true,
          update: privileges.idempotency_update === true,
          delete: privileges.idempotency_delete === true
        },
        audit: {
          select: privileges.audit_select === true,
          insert: privileges.audit_insert === true,
          update: privileges.audit_update === true,
          delete: privileges.audit_delete === true
        },
        outbox: {
          select: privileges.outbox_select === true,
          insert: privileges.outbox_insert === true,
          update: privileges.outbox_update === true,
          delete: privileges.outbox_delete === true
        },
        coreSchemaCreate: schemaWrites,
        coreTableWrites: tableWrites
      }
    });
  } catch (error) {
    if (began) await rollback(adapter);
    throw error;
  }
}

export function evaluateProviderPreflight({ runtimeIdentity, installationAudit }, {
  expectedRole,
  expectedMigrations = REQUIRED_MCP_MIGRATIONS
} = {}) {
  const issues = [];
  if (!runtimeIdentity || !installationAudit) issue(issues, "preflight_snapshots_required");
  if (runtimeIdentity?.databaseFingerprint !== installationAudit?.databaseFingerprint) issue(issues, "database_fingerprint_mismatch");
  if (runtimeIdentity?.role !== expectedRole) issue(issues, "runtime_role_mismatch");
  if (runtimeIdentity?.searchPath?.[0] !== "mcp") issue(issues, "runtime_search_path_mismatch");
  if (installationAudit?.runtimeRoleExists !== true) issue(issues, "runtime_role_missing");
  if (installationAudit?.schemaAvailable !== true) issue(issues, "mcp_schema_missing");
  if (installationAudit?.registryAvailable !== true) issue(issues, "migration_registry_missing");
  if (JSON.stringify(installationAudit?.migrations ?? []) !== JSON.stringify(expectedMigrations)) issue(issues, "mcp_migration_set_mismatch");
  for (const [name, present] of Object.entries(installationAudit?.objects ?? {})) {
    if (present !== true) issue(issues, `missing_mcp_object:${name}`);
  }
  const privileges = installationAudit?.privileges ?? {};
  if (privileges.mcpSchemaUsage !== true) issue(issues, "runtime_missing_mcp_schema_usage");
  if (privileges.mcpSchemaCreate !== false) issue(issues, "runtime_has_mcp_schema_create");
  const idempotency = privileges.idempotency ?? {};
  if (!(idempotency.select && idempotency.insert && idempotency.update) || idempotency.delete) issue(issues, "runtime_idempotency_privileges_invalid");
  const audit = privileges.audit ?? {};
  if (audit.insert !== true || audit.select || audit.update || audit.delete) issue(issues, "runtime_audit_privileges_invalid");
  const outbox = privileges.outbox ?? {};
  if (outbox.insert !== true || outbox.select || outbox.update || outbox.delete) issue(issues, "runtime_outbox_privileges_invalid");
  if ((privileges.coreSchemaCreate ?? []).length) issue(issues, "runtime_has_core_schema_create");
  if ((privileges.coreTableWrites ?? []).length) issue(issues, "runtime_has_core_table_write");
  return Object.freeze({ ready: issues.length === 0, issues: Object.freeze(issues.sort()) });
}

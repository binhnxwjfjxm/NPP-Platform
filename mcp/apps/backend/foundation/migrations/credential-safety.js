export const MIGRATION_DATABASE_URL_ENV = "MCP_MIGRATION_DATABASE_URL";
export const MIGRATION_CREDENTIAL_MODE_ENV = "MCP_MIGRATION_CREDENTIAL_MODE";
export const MIGRATION_CREDENTIAL_MODE_SEPARATED = "separated";
export const MIGRATION_CREDENTIAL_MODE_ESSENTIAL_OWNER = "essential_owner";
export const ESSENTIAL_OWNER_CONFIRM_ENV = "MCP_MIGRATION_ESSENTIAL_OWNER_CONFIRM";
export const ESSENTIAL_OWNER_CONFIRM_VALUE = "I_ACKNOWLEDGE_OWNER_CREDENTIAL_IS_NOT_LEAST_PRIVILEGE";

function fail(code, message = code) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

export function parseDatabaseUrl(value) {
  if (!value) fail("missing_database_url", "A PostgreSQL database URL is required for MCP migration commands");
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail("invalid_database_url", "Database URL must be a valid PostgreSQL connection string");
  }
  if (!new Set(["postgres:", "postgresql:"]).has(parsed.protocol)) {
    fail("invalid_database_url", "Database URL must use postgres or postgresql");
  }
  return parsed.toString();
}

function normalizedDatabaseUrl(connectionString) {
  return new URL(parseDatabaseUrl(connectionString));
}

export function databaseCredentialIdentity(connectionString) {
  const parsed = normalizedDatabaseUrl(connectionString);
  const user = decodeURIComponent(parsed.username || "").toLowerCase();
  const host = parsed.hostname.toLowerCase();
  const port = parsed.port || "5432";
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  return `${user}@${host}:${port}/${database}`;
}

export function databaseTargetIdentity(connectionString) {
  const parsed = normalizedDatabaseUrl(connectionString);
  const host = parsed.hostname.toLowerCase();
  const port = parsed.port || "5432";
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  return `${host}:${port}/${database}`;
}

export function resolveMigrationCredentialMode(env = process.env) {
  const rawMode = String(env[MIGRATION_CREDENTIAL_MODE_ENV] ?? "").trim().toLowerCase();
  const mode = rawMode || MIGRATION_CREDENTIAL_MODE_SEPARATED;
  if (!new Set([
    MIGRATION_CREDENTIAL_MODE_SEPARATED,
    MIGRATION_CREDENTIAL_MODE_ESSENTIAL_OWNER
  ]).has(mode)) {
    fail("invalid_migration_credential_mode", `Unsupported ${MIGRATION_CREDENTIAL_MODE_ENV}`);
  }
  return mode;
}

export function resolveMigrationCredentialContext(env = process.env) {
  const nodeEnv = String(env.NODE_ENV ?? "").trim().toLowerCase();
  const runtimeRaw = env.DATABASE_URL;
  const migrationRaw = env[MIGRATION_DATABASE_URL_ENV];

  if (nodeEnv !== "production") {
    return {
      connectionString: parseDatabaseUrl(migrationRaw || runtimeRaw),
      credentialMode: "non_production",
      leastPrivilege: null
    };
  }

  if (!runtimeRaw) fail("missing_runtime_database_url", "DATABASE_URL is required to prove the production migration target");
  if (!migrationRaw) fail("missing_migration_database_url", `${MIGRATION_DATABASE_URL_ENV} is required for production MCP migration commands`);

  const runtimeUrl = parseDatabaseUrl(runtimeRaw);
  const migrationUrl = parseDatabaseUrl(migrationRaw);
  if (databaseTargetIdentity(runtimeUrl) !== databaseTargetIdentity(migrationUrl)) {
    fail("runtime_and_migrator_target_different_databases", "Runtime and migration URLs must target the same PostgreSQL host, port and database");
  }

  const mode = resolveMigrationCredentialMode(env);
  const sameCredentialIdentity = databaseCredentialIdentity(runtimeUrl) === databaseCredentialIdentity(migrationUrl);

  if (mode === MIGRATION_CREDENTIAL_MODE_SEPARATED) {
    if (sameCredentialIdentity) {
      fail("migration_runtime_credential_not_separated", "Production MCP migrations require a distinct migrator credential identity by default");
    }
    return {
      connectionString: migrationUrl,
      credentialMode: mode,
      leastPrivilege: true
    };
  }

  if (env[ESSENTIAL_OWNER_CONFIRM_ENV] !== ESSENTIAL_OWNER_CONFIRM_VALUE) {
    fail(
      "essential_owner_migration_not_authorized",
      `Essential owner mode requires ${ESSENTIAL_OWNER_CONFIRM_ENV}=${ESSENTIAL_OWNER_CONFIRM_VALUE}`
    );
  }
  if (!sameCredentialIdentity) {
    fail("essential_owner_requires_shared_credential_identity", "Essential owner mode is only valid when runtime and migration use the same provider credential identity");
  }

  return {
    connectionString: migrationUrl,
    credentialMode: mode,
    leastPrivilege: false
  };
}

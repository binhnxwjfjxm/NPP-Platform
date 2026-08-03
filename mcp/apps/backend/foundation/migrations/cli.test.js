import test from "node:test";
import assert from "node:assert/strict";
import {
  ESSENTIAL_OWNER_CONFIRM_ENV,
  ESSENTIAL_OWNER_CONFIRM_VALUE,
  MIGRATION_CREDENTIAL_MODE_ENV,
  MIGRATION_CREDENTIAL_MODE_ESSENTIAL_OWNER,
  MIGRATION_CREDENTIAL_MODE_SEPARATED,
  MIGRATION_DATABASE_URL_ENV,
  PRODUCTION_ALLOW_ENV,
  PRODUCTION_CONFIRM_ENV,
  PRODUCTION_CONFIRM_VALUE,
  assertMigrationSafety,
  createMigrationPoolOptions,
  databaseCredentialIdentity,
  parseDatabaseUrl,
  redactSensitiveText,
  resolveMigrationConnectionString,
  resolveMigrationCredentialContext,
  runMigrationCommand
} from "./cli.js";

test("MCP migration CLI rejects unsafe production execution", () => {
  assert.throws(
    () => assertMigrationSafety({ nodeEnv: "production" }),
    (error) => error.code === "production_migration_forbidden"
  );
  assert.doesNotThrow(() => assertMigrationSafety({
    nodeEnv: "production",
    allowProduction: "true",
    productionConfirm: PRODUCTION_CONFIRM_VALUE
  }));
});

test("production migration defaults to separated credentials", () => {
  assert.throws(
    () => resolveMigrationConnectionString({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://mcp_runtime:runtime@example.invalid/installation"
    }),
    (error) => error.code === "missing_migration_database_url"
  );
  assert.throws(
    () => resolveMigrationConnectionString({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://mcp_runtime:runtime@example.invalid/installation",
      [MIGRATION_DATABASE_URL_ENV]: "postgresql://mcp_runtime:different-password@example.invalid/installation"
    }),
    (error) => error.code === "migration_runtime_credential_not_separated"
  );

  const context = resolveMigrationCredentialContext({
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://mcp_runtime:runtime@example.invalid/installation",
    [MIGRATION_DATABASE_URL_ENV]: "postgresql://mcp_migrator:migrate@example.invalid/installation"
  });
  assert.equal(context.credentialMode, MIGRATION_CREDENTIAL_MODE_SEPARATED);
  assert.equal(context.leastPrivilege, true);
  assert.equal(databaseCredentialIdentity(context.connectionString), "mcp_migrator@example.invalid:5432/installation");
});

test("production migration rejects a different target in every credential mode", () => {
  const common = {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://owner:runtime@example.invalid/installation",
    [MIGRATION_DATABASE_URL_ENV]: "postgresql://migrator:migrate@example.invalid/other-installation"
  };
  assert.throws(
    () => resolveMigrationCredentialContext(common),
    (error) => error.code === "runtime_and_migrator_target_different_databases"
  );
  assert.throws(
    () => resolveMigrationCredentialContext({
      ...common,
      [MIGRATION_CREDENTIAL_MODE_ENV]: MIGRATION_CREDENTIAL_MODE_ESSENTIAL_OWNER,
      [ESSENTIAL_OWNER_CONFIRM_ENV]: ESSENTIAL_OWNER_CONFIRM_VALUE
    }),
    (error) => error.code === "runtime_and_migrator_target_different_databases"
  );
});

test("Essential owner mode is explicit, authorized and reports no least privilege", () => {
  const ownerEnv = {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://essential_owner:runtime@example.invalid/installation",
    [MIGRATION_DATABASE_URL_ENV]: "postgresql://essential_owner:migrate@example.invalid/installation",
    [MIGRATION_CREDENTIAL_MODE_ENV]: MIGRATION_CREDENTIAL_MODE_ESSENTIAL_OWNER
  };

  assert.throws(
    () => resolveMigrationCredentialContext(ownerEnv),
    (error) => error.code === "essential_owner_migration_not_authorized"
  );

  const context = resolveMigrationCredentialContext({
    ...ownerEnv,
    [ESSENTIAL_OWNER_CONFIRM_ENV]: ESSENTIAL_OWNER_CONFIRM_VALUE
  });
  assert.equal(context.credentialMode, MIGRATION_CREDENTIAL_MODE_ESSENTIAL_OWNER);
  assert.equal(context.leastPrivilege, false);
  assert.equal(databaseCredentialIdentity(context.connectionString), "essential_owner@example.invalid:5432/installation");

  assert.throws(
    () => resolveMigrationCredentialContext({
      ...ownerEnv,
      [MIGRATION_DATABASE_URL_ENV]: "postgresql://different_migrator:migrate@example.invalid/installation",
      [ESSENTIAL_OWNER_CONFIRM_ENV]: ESSENTIAL_OWNER_CONFIRM_VALUE
    }),
    (error) => error.code === "essential_owner_requires_shared_credential_identity"
  );

  assert.throws(
    () => resolveMigrationCredentialContext({
      ...ownerEnv,
      [MIGRATION_CREDENTIAL_MODE_ENV]: "unknown_mode",
      [ESSENTIAL_OWNER_CONFIRM_ENV]: ESSENTIAL_OWNER_CONFIRM_VALUE
    }),
    (error) => error.code === "invalid_migration_credential_mode"
  );
});

test("development migration may use the runtime URL or an explicit migration URL", () => {
  assert.match(resolveMigrationConnectionString({ NODE_ENV: "test", DATABASE_URL: "postgresql://local/test" }), /postgresql:\/\/local\/test/);
  assert.match(resolveMigrationConnectionString({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://runtime/test",
    [MIGRATION_DATABASE_URL_ENV]: "postgresql://migrator/test"
  }), /postgresql:\/\/migrator\/test/);
});

test("production migration pool requires TLS while rehearsal stays local", () => {
  assert.deepEqual(
    createMigrationPoolOptions("postgresql://example.invalid/installation", { NODE_ENV: "production" }).ssl,
    { rejectUnauthorized: false }
  );
  assert.equal(
    createMigrationPoolOptions("postgresql://localhost/installation", { NODE_ENV: "test" }).ssl,
    false
  );
  assert.throws(
    () => createMigrationPoolOptions("postgresql://example.invalid/installation", {
      NODE_ENV: "production",
      MCP_DB_SSL_MODE: "disable"
    }),
    (error) => error.code === "production_mcp_database_ssl_required"
  );
});

test("database URL parsing and diagnostics never expose either credential", () => {
  const runtime = parseDatabaseUrl("postgresql://mcp_runtime:runtime-secret@example.invalid:5432/installation");
  const migrator = parseDatabaseUrl("postgresql://mcp_migrator:migration-secret@example.invalid:5432/installation");
  const redacted = redactSensitiveText(`failed for ${runtime} and ${migrator} mcp_runtime mcp_migrator runtime-secret migration-secret example.invalid`, [runtime, migrator]);
  for (const forbidden of ["runtime-secret", "migration-secret", "mcp_runtime", "mcp_migrator", "example.invalid"]) {
    assert.equal(redacted.includes(forbidden), false);
  }
  assert.match(redacted, /REDACTED/);
});

test("unknown migration command exits without opening a database pool", async () => {
  class ForbiddenPool { constructor() { throw new Error("must_not_construct"); } }
  const code = await runMigrationCommand("unknown", {
    DATABASE_URL: "postgresql://example.invalid/test",
    NODE_ENV: "test",
    [PRODUCTION_ALLOW_ENV]: "",
    [PRODUCTION_CONFIRM_ENV]: ""
  }, { PoolImpl: ForbiddenPool });
  assert.equal(code, 2);
});

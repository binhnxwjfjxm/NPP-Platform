import test from "node:test";
import assert from "node:assert/strict";
import {
  MIGRATION_DATABASE_URL_ENV,
  PRODUCTION_ALLOW_ENV,
  PRODUCTION_CONFIRM_ENV,
  PRODUCTION_CONFIRM_VALUE,
  assertMigrationSafety,
  databaseCredentialIdentity,
  parseDatabaseUrl,
  redactSensitiveText,
  resolveMigrationConnectionString,
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

test("production migration uses a separate migrator credential", () => {
  assert.throws(
    () => resolveMigrationConnectionString({ NODE_ENV: "production", DATABASE_URL: "postgresql://mcp_runtime:runtime@example.invalid/installation" }),
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
  const resolved = resolveMigrationConnectionString({
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://mcp_runtime:runtime@example.invalid/installation",
    [MIGRATION_DATABASE_URL_ENV]: "postgresql://mcp_migrator:migrate@example.invalid/installation"
  });
  assert.equal(databaseCredentialIdentity(resolved), "mcp_migrator@example.invalid:5432/installation");
});

test("development migration may use the runtime URL or an explicit migration URL", () => {
  assert.match(resolveMigrationConnectionString({ NODE_ENV: "test", DATABASE_URL: "postgresql://local/test" }), /postgresql:\/\/local\/test/);
  assert.match(resolveMigrationConnectionString({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://runtime/test",
    [MIGRATION_DATABASE_URL_ENV]: "postgresql://migrator/test"
  }), /postgresql:\/\/migrator\/test/);
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

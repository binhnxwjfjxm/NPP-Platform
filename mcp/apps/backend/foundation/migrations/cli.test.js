import test from "node:test";
import assert from "node:assert/strict";
import {
  PRODUCTION_ALLOW_ENV,
  PRODUCTION_CONFIRM_ENV,
  PRODUCTION_CONFIRM_VALUE,
  assertMigrationSafety,
  parseDatabaseUrl,
  redactSensitiveText,
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

test("database URL parsing and diagnostics never expose credentials", () => {
  const url = parseDatabaseUrl("postgresql://mcp_user:secret@example.invalid:5432/installation");
  const redacted = redactSensitiveText(`failed for ${url} mcp_user secret example.invalid`, url);
  assert.equal(redacted.includes("secret"), false);
  assert.equal(redacted.includes("mcp_user"), false);
  assert.equal(redacted.includes("example.invalid"), false);
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

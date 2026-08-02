import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  MCP_MIGRATIONS,
  migrationStatusWithAdapter,
  migrationVerifyWithAdapter,
  runMcpMigrations
} from "./index.js";

const { Pool } = pg;
export const PRODUCTION_ALLOW_ENV = "MCP_MIGRATION_ALLOW_PRODUCTION";
export const PRODUCTION_CONFIRM_ENV = "MCP_MIGRATION_PRODUCTION_CONFIRM";
export const PRODUCTION_CONFIRM_VALUE = "I_UNDERSTAND_THIS_TARGETS_PRODUCTION";

function fail(code, message = code) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

export function parseDatabaseUrl(value) {
  if (!value) fail("missing_database_url", "DATABASE_URL is required for MCP migration commands");
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail("invalid_database_url", "DATABASE_URL must be a valid PostgreSQL connection string");
  }
  if (!new Set(["postgres:", "postgresql:"]).has(parsed.protocol)) {
    fail("invalid_database_url", "DATABASE_URL must use postgres or postgresql");
  }
  return parsed.toString();
}

export function assertMigrationSafety({
  nodeEnv = process.env.NODE_ENV,
  allowProduction = process.env[PRODUCTION_ALLOW_ENV],
  productionConfirm = process.env[PRODUCTION_CONFIRM_ENV]
} = {}) {
  if (String(nodeEnv ?? "").trim().toLowerCase() !== "production") return;
  if (allowProduction !== "true" || productionConfirm !== PRODUCTION_CONFIRM_VALUE) {
    fail(
      "production_migration_forbidden",
      `Production MCP migration commands require ${PRODUCTION_ALLOW_ENV}=true and ${PRODUCTION_CONFIRM_ENV}=${PRODUCTION_CONFIRM_VALUE}`
    );
  }
}

function hashIdentifier(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
}

export function sanitizeDatabaseIdentifier(connectionString) {
  try {
    const parsed = new URL(connectionString);
    const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, "")) || "unknown";
    return `database:${hashIdentifier(databaseName)}`;
  } catch {
    return "database:unknown";
  }
}

export function redactSensitiveText(value, connectionString = null) {
  let output = String(value ?? "");
  if (connectionString) output = output.split(String(connectionString)).join("[REDACTED_DATABASE_URL]");
  output = output.replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gi, "[REDACTED_DATABASE_URL]");
  try {
    const parsed = new URL(connectionString);
    for (const raw of [parsed.username, parsed.password, parsed.hostname].filter(Boolean)) {
      for (const part of new Set([raw, decodeURIComponent(raw)])) {
        output = output.split(part).join("[REDACTED]");
      }
    }
  } catch {
    // Generic URL redaction above still applies.
  }
  return output;
}

function log(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

export async function runMigrationCommand(command, env = process.env, { PoolImpl = Pool } = {}) {
  let connectionString = null;
  let databaseIdentifier = "database:unknown";
  let pool = null;
  try {
    if (!new Set(["status", "migrate", "verify"]).has(command)) return 2;
    connectionString = parseDatabaseUrl(env.DATABASE_URL);
    assertMigrationSafety({
      nodeEnv: env.NODE_ENV,
      allowProduction: env[PRODUCTION_ALLOW_ENV],
      productionConfirm: env[PRODUCTION_CONFIRM_ENV]
    });
    databaseIdentifier = sanitizeDatabaseIdentifier(connectionString);
    pool = new PoolImpl({ connectionString, application_name: "mcp-migration-cli" });
    log({ timestamp: new Date().toISOString(), command, databaseIdentifier, status: "started" });

    let result;
    if (command === "status") result = await migrationStatusWithAdapter(pool, MCP_MIGRATIONS);
    else if (command === "migrate") result = await runMcpMigrations(pool, MCP_MIGRATIONS);
    else result = await migrationVerifyWithAdapter(pool, MCP_MIGRATIONS);

    log({ timestamp: new Date().toISOString(), command, databaseIdentifier, status: "success", result });
    return command === "verify" && result.verified === false ? 1 : 0;
  } catch (error) {
    log({
      timestamp: new Date().toISOString(),
      command,
      databaseIdentifier,
      status: "error",
      error: {
        code: error.code || "UNKNOWN_ERROR",
        message: redactSensitiveText(error.message, connectionString)
      }
    });
    return 1;
  } finally {
    if (pool) await pool.end();
  }
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  const command = process.argv[2];
  if (!command) {
    process.stderr.write("Usage: node foundation/migrations/cli.js <status|migrate|verify>\n");
    process.exitCode = 2;
  } else {
    process.exitCode = await runMigrationCommand(command);
  }
}

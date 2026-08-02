const IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{1,127}$/;
const SCHEMA_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;

function text(value) { return String(value ?? "").trim(); }
function fail(code, detail) { const error = new Error(code); error.code = code; error.detail = detail; throw error; }
function required(env, name) { const value = text(env[name]); if (!value) fail(`missing_${name.toLowerCase()}`, `${name} is required`); return value; }
function identifier(env, name) { const value = required(env, name); if (!IDENTIFIER_PATTERN.test(value)) fail(`invalid_${name.toLowerCase()}`, `${name} is invalid`); return value; }
function optionalBoolean(value, fallback = false, name = "value") { const raw = text(value).toLowerCase(); if (!raw) return fallback; if (["1","true","yes","on"].includes(raw)) return true; if (["0","false","no","off"].includes(raw)) return false; fail(`invalid_${name.toLowerCase()}`, `${name} must be boolean`); }
function port(value, fallback, name) { const raw = text(value); const parsed = raw ? Number(raw) : fallback; if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) fail(`invalid_${name.toLowerCase()}`, `${name} must be an integer from 1 to 65535`); return parsed; }
function positiveInteger(value, fallback, name) { const raw = text(value); const parsed = raw ? Number(raw) : fallback; if (!Number.isInteger(parsed) || parsed < 1) fail(`invalid_${name.toLowerCase()}`, `${name} must be a positive integer`); return parsed; }
function csvList(value) { return Object.freeze(Array.from(new Set(text(value).split(",").map((item) => item.trim().toLowerCase()).filter(Boolean))).sort()); }
function httpUrlValue(value, name, { httpsInProduction = false, nodeEnv = "development" } = {}) { let parsed; try { parsed = new URL(value); } catch { fail(`invalid_${name.toLowerCase()}`, `${name} must be a valid URL`); } if (!/^https?:$/.test(parsed.protocol)) fail(`invalid_${name.toLowerCase()}`, `${name} must use http or https`); if (httpsInProduction && nodeEnv === "production" && parsed.protocol !== "https:") fail(`${name.toLowerCase()}_https_required`, `${name} must use https in production`); return parsed.toString().replace(/\/+$/, ""); }
function databaseUrlValue(value) { const raw = text(value); if (!raw) return null; let parsed; try { parsed = new URL(raw); } catch { fail("invalid_database_url", "DATABASE_URL must be a valid URL"); } if (!["postgres:", "postgresql:"].includes(parsed.protocol)) fail("invalid_database_url", "DATABASE_URL must use postgres or postgresql"); return raw; }

function loadR2Config(env, nodeEnv) {
  const names = ["R2_BUCKET_NAME", "R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"];
  const present = names.filter((name) => text(env[name]));
  if (present.length === 0) return Object.freeze({ configured: false });
  if (present.length !== names.length) fail("incomplete_r2_config", `Missing R2 values: ${names.filter((name) => !text(env[name])).join(", ")}`);
  return Object.freeze({ configured: true, bucket: identifier(env, "R2_BUCKET_NAME"), endpoint: httpUrlValue(required(env, "R2_ENDPOINT"), "R2_ENDPOINT", { httpsInProduction: true, nodeEnv }), region: text(env.R2_REGION) || "auto", accessKeyId: required(env, "R2_ACCESS_KEY_ID"), secretAccessKey: required(env, "R2_SECRET_ACCESS_KEY") });
}

export function parseCorsOrigins(value, { nodeEnv = "development" } = {}) {
  const raw = text(value);
  if (!raw) { if (nodeEnv === "production") fail("missing_cors_origins", "CORS_ORIGINS is required in production"); return Object.freeze(["http://localhost:3000", "http://127.0.0.1:3000"]); }
  const origins = Array.from(new Set(raw.split(",").map((item) => item.trim()).filter(Boolean)));
  if (!origins.length) fail("missing_cors_origins", "CORS_ORIGINS is empty");
  if (origins.includes("*")) fail("cors_wildcard_forbidden", "CORS_ORIGINS cannot contain *");
  for (const origin of origins) { let parsed; try { parsed = new URL(origin); } catch { fail("invalid_cors_origin", `Invalid CORS origin: ${origin}`); } if (!/^https?:$/.test(parsed.protocol) || parsed.origin !== origin) fail("invalid_cors_origin", `CORS origin must be an exact http(s) origin: ${origin}`); }
  return Object.freeze(origins);
}

function validateBackendToken(token, nodeEnv) { const minimumLength = nodeEnv === "production" ? 32 : 16; if (token.length < minimumLength) fail("backend_api_token_too_short", `BACKEND_API_TOKEN must contain at least ${minimumLength} characters`); if (nodeEnv === "production" && /replace|change[-_ ]?me|example|dev[-_ ]?only/i.test(token)) fail("backend_api_token_placeholder", "BACKEND_API_TOKEN still contains a placeholder value"); }

function loadPersistenceConfig(env, nodeEnv) {
  const provider = text(env.PERSISTENCE_PROVIDER) || "postgresql";
  if (!new Set(["postgresql", "legacy-supabase"]).has(provider)) fail("invalid_persistence_provider", "PERSISTENCE_PROVIDER is not supported");
  if (nodeEnv === "production" && provider !== "postgresql") fail("production_persistence_provider_forbidden", "Production must use PostgreSQL");
  const schema = text(env.MCP_DB_SCHEMA) || "mcp";
  if (!SCHEMA_PATTERN.test(schema)) fail("invalid_mcp_db_schema", "MCP_DB_SCHEMA must be a safe PostgreSQL identifier");
  return Object.freeze({
    provider,
    databaseUrl: databaseUrlValue(env.DATABASE_URL),
    configured: provider === "postgresql" ? Boolean(text(env.DATABASE_URL)) : Boolean(text(env.SUPABASE_URL) && text(env.SUPABASE_SERVICE_ROLE_KEY)),
    schema,
    expectedRole: text(env.MCP_DB_ROLE) || null,
    poolMax: positiveInteger(env.MCP_DB_POOL_MAX, 5, "MCP_DB_POOL_MAX"),
    connectionTimeoutMs: positiveInteger(env.MCP_DB_CONNECT_TIMEOUT_MS, 5000, "MCP_DB_CONNECT_TIMEOUT_MS"),
    idleTimeoutMs: positiveInteger(env.MCP_DB_IDLE_TIMEOUT_MS, 30000, "MCP_DB_IDLE_TIMEOUT_MS"),
    statementTimeoutMs: positiveInteger(env.MCP_DB_STATEMENT_TIMEOUT_MS, 15000, "MCP_DB_STATEMENT_TIMEOUT_MS")
  });
}

export function loadFoundationConfig(env = process.env) {
  const nodeEnv = text(env.NODE_ENV) || "development";
  if (nodeEnv === "production" && text(env.MCP_MIGRATION_DATABASE_URL)) {
    fail("migration_credential_forbidden_in_runtime", "MCP_MIGRATION_DATABASE_URL must not be stored in the production runtime environment");
  }
  const publicHost = text(env.HOST) || "127.0.0.1";
  const publicPort = port(env.PORT, 3001, "PORT");
  const internalHost = "127.0.0.1";
  const internalPort = port(env.LEGACY_INTERNAL_PORT, publicPort + 1, "LEGACY_INTERNAL_PORT");
  if (internalPort === publicPort) fail("legacy_internal_port_conflict", "LEGACY_INTERNAL_PORT must differ from PORT");
  const installationId = identifier(env, "INSTALLATION_ID");
  const nppCode = identifier(env, "NPP_CODE");
  const legacyActorId = identifier(env, "MCP_LEGACY_ACTOR_ID");
  const backendApiToken = required(env, "BACKEND_API_TOKEN");
  validateBackendToken(backendApiToken, nodeEnv);
  const authMode = text(env.AUTH_MODE) || "proxy-service";
  if (authMode !== "proxy-service") fail("invalid_auth_mode", "F0.2 supports AUTH_MODE=proxy-service only");
  const persistence = loadPersistenceConfig(env, nodeEnv);
  const legacyRuntimeEnabled = optionalBoolean(env.MCP_LEGACY_RUNTIME_ENABLED, false, "MCP_LEGACY_RUNTIME_ENABLED");
  if (nodeEnv === "production" && legacyRuntimeEnabled) fail("legacy_runtime_forbidden_in_production", "Legacy Supabase runtime is forbidden in production");
  if (legacyRuntimeEnabled && persistence.provider !== "legacy-supabase") fail("legacy_runtime_provider_mismatch", "Legacy runtime requires PERSISTENCE_PROVIDER=legacy-supabase");
  let supabaseUrl = null;
  let supabaseServiceRoleKey = null;
  if (persistence.provider === "legacy-supabase") {
    supabaseUrl = httpUrlValue(required(env, "SUPABASE_URL"), "SUPABASE_URL", { httpsInProduction: true, nodeEnv });
    supabaseServiceRoleKey = required(env, "SUPABASE_SERVICE_ROLE_KEY");
  }
  const servicePrincipal = Object.freeze({
    id: legacyActorId,
    type: "service",
    authentication: "backend-token",
    employeeId: null,
    roles: csvList(env.MCP_SERVICE_ROLES),
    permissions: csvList(env.MCP_SERVICE_PERMISSIONS),
    scopes: csvList(env.MCP_SERVICE_SCOPES)
  });
  return Object.freeze({
    nodeEnv, service: text(env.SERVICE_NAME) || "mcp-plan-backend", publicHost, publicPort, internalHost, internalPort,
    installationId, nppCode, legacyActorId, backendApiToken, authMode, servicePrincipal,
    persistence,
    legacyRuntime: Object.freeze({ enabled: legacyRuntimeEnabled }),
    supabaseUrl, supabaseServiceRoleKey,
    corsOrigins: parseCorsOrigins(env.CORS_ORIGINS, { nodeEnv }),
    upstreamTimeoutMs: positiveInteger(env.UPSTREAM_TIMEOUT_MS, 65000, "UPSTREAM_TIMEOUT_MS"),
    r2: loadR2Config(env, nodeEnv)
  });
}

export function publicFoundationConfig(config) {
  return Object.freeze({ service: config.service, nodeEnv: config.nodeEnv, installationId: config.installationId, nppCode: config.nppCode, authMode: config.authMode, publicHost: config.publicHost, publicPort: config.publicPort, persistenceProvider: config.persistence.provider, persistenceConfigured: config.persistence.configured, persistenceSchema: config.persistence.schema, legacyRuntimeEnabled: config.legacyRuntime.enabled, serviceRoleCount: config.servicePrincipal?.roles?.length || 0, servicePermissionCount: config.servicePrincipal?.permissions?.length || 0, serviceScopeCount: config.servicePrincipal?.scopes?.length || 0, r2Configured: config.r2?.configured === true, corsOrigins: [...config.corsOrigins] });
}

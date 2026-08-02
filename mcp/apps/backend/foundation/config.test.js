import test from "node:test";
import assert from "node:assert/strict";
import { loadFoundationConfig, parseCorsOrigins } from "./config.js";

function validEnv(overrides = {}) {
  return {
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: "3001",
    LEGACY_INTERNAL_PORT: "3002",
    INSTALLATION_ID: "npp-demo-prod",
    NPP_CODE: "NPP-DEMO",
    MCP_LEGACY_ACTOR_ID: "service:npp-demo:mcp-v1",
    BACKEND_API_TOKEN: "0123456789abcdef0123456789abcdef",
    CORS_ORIGINS: "https://app.example.com",
    AUTH_MODE: "proxy-service",
    PERSISTENCE_PROVIDER: "postgresql",
    DATABASE_URL: "postgresql://runtime.invalid/mcp",
    ...overrides
  };
}

test("production config starts without Supabase values", () => {
  const config = loadFoundationConfig(validEnv({ SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "" }));
  assert.equal(config.persistence.provider, "postgresql");
  assert.equal(config.persistence.configured, true);
  assert.equal(config.supabaseUrl, null);
  assert.equal(config.supabaseServiceRoleKey, null);
});

test("missing DATABASE_URL is represented fail-closed without crashing startup", () => {
  const config = loadFoundationConfig(validEnv({ DATABASE_URL: "" }));
  assert.equal(config.persistence.configured, false);
  assert.equal(config.persistence.databaseUrl, null);
});

test("production runtime rejects a persisted migration credential", () => {
  assert.throws(
    () => loadFoundationConfig(validEnv({ MCP_MIGRATION_DATABASE_URL: "postgresql://migrator.invalid/mcp" })),
    (error) => error.code === "migration_credential_forbidden_in_runtime"
  );
  assert.doesNotThrow(() => loadFoundationConfig({
    ...validEnv({ NODE_ENV: "test", BACKEND_API_TOKEN: "0123456789abcdef" }),
    MCP_MIGRATION_DATABASE_URL: "postgresql://migrator.invalid/mcp"
  }));
});

test("production rejects legacy Supabase runtime", () => {
  assert.throws(
    () => loadFoundationConfig(validEnv({
      PERSISTENCE_PROVIDER: "legacy-supabase",
      MCP_LEGACY_RUNTIME_ENABLED: "true",
      SUPABASE_URL: "https://project.example.com",
      SUPABASE_SERVICE_ROLE_KEY: "legacy-only"
    })),
    /production_persistence_provider_forbidden/
  );
});

test("production config remains fail-fast for public security boundaries", () => {
  assert.throws(() => loadFoundationConfig(validEnv({ BACKEND_API_TOKEN: "" })), /missing_backend_api_token/);
  assert.throws(() => loadFoundationConfig(validEnv({ CORS_ORIGINS: "" })), /missing_cors_origins/);
  assert.throws(() => loadFoundationConfig(validEnv({ CORS_ORIGINS: "*" })), /cors_wildcard_forbidden/);
  assert.throws(() => loadFoundationConfig(validEnv({ DATABASE_URL: "https://not-postgres.example.com" })), /invalid_database_url/);
});

test("installation values and PostgreSQL boundary are fixed server config", () => {
  const config = loadFoundationConfig(validEnv());
  assert.equal(config.installationId, "npp-demo-prod");
  assert.equal(config.nppCode, "NPP-DEMO");
  assert.equal(config.persistence.schema, "mcp");
  assert.equal(config.persistence.poolMax, 5);
  assert.equal(config.legacyRuntime.enabled, false);
  assert.deepEqual(config.corsOrigins, ["https://app.example.com"]);
  assert.equal(config.publicPort, 3001);
  assert.equal(config.internalPort, 3002);
});

test("service roles, permissions and scopes are backend-owned and deny by default", () => {
  const denied = loadFoundationConfig(validEnv());
  assert.deepEqual(denied.servicePrincipal.roles, []);
  assert.deepEqual(denied.servicePrincipal.permissions, []);
  assert.deepEqual(denied.servicePrincipal.scopes, []);

  const configured = loadFoundationConfig(validEnv({
    MCP_SERVICE_ROLES: "mcp.gateway,mcp.gateway",
    MCP_SERVICE_PERMISSIONS: "mcp.visit.write,mcp.visit.read",
    MCP_SERVICE_SCOPES: "mcp:route:route-a,mcp:route:route-a"
  }));
  assert.equal(configured.servicePrincipal.id, "service:npp-demo:mcp-v1");
  assert.deepEqual(configured.servicePrincipal.roles, ["mcp.gateway"]);
  assert.deepEqual(configured.servicePrincipal.permissions, ["mcp.visit.read", "mcp.visit.write"]);
  assert.deepEqual(configured.servicePrincipal.scopes, ["mcp:route:route-a"]);
});

test("development CORS defaults are explicit localhost origins", () => {
  assert.deepEqual(parseCorsOrigins("", { nodeEnv: "development" }), [
    "http://localhost:3000",
    "http://127.0.0.1:3000"
  ]);
});


test("Core onboarding boundary is optional but fail-closed and uses a distinct server token", () => {
  const disabled = loadFoundationConfig(validEnv());
  assert.equal(disabled.coreOnboarding.configured, false);
  assert.equal(disabled.coreOnboarding.apiToken, null);

  const enabled = loadFoundationConfig(validEnv({
    CORE_ONBOARDING_API_BASE_URL: "https://core.example.com",
    CORE_ONBOARDING_API_TOKEN: "abcdef0123456789abcdef0123456789"
  }));
  assert.equal(enabled.coreOnboarding.configured, true);
  assert.equal(enabled.coreOnboarding.baseUrl, "https://core.example.com");
  assert.equal(enabled.coreOnboarding.timeoutMs, 15000);

  assert.throws(
    () => loadFoundationConfig(validEnv({ CORE_ONBOARDING_API_BASE_URL: "https://core.example.com" })),
    (error) => error.code === "incomplete_core_onboarding_config"
  );
  assert.throws(
    () => loadFoundationConfig(validEnv({
      CORE_ONBOARDING_API_BASE_URL: "https://core.example.com",
      CORE_ONBOARDING_API_TOKEN: "0123456789abcdef0123456789abcdef"
    })),
    (error) => error.code === "core_onboarding_token_reuse_forbidden"
  );
});

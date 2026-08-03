import test from "node:test";
import assert from "node:assert/strict";
import { loadFoundationConfig, publicFoundationConfig } from "./config.js";

const WAREHOUSE_ID = "11111111-1111-4111-8111-111111111111";

function env(overrides = {}) {
  return {
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: "3001",
    LEGACY_INTERNAL_PORT: "3002",
    INSTALLATION_ID: "installation-a",
    NPP_CODE: "NPP-A",
    MCP_LEGACY_ACTOR_ID: "service:npp-a:mcp",
    BACKEND_API_TOKEN: "backend-token-0123456789",
    CORS_ORIGINS: "http://127.0.0.1:3000",
    AUTH_MODE: "proxy-service",
    PERSISTENCE_PROVIDER: "postgresql",
    DATABASE_URL: "postgresql://runtime.invalid/mcp",
    ...overrides
  };
}

function enabled(overrides = {}) {
  return env({
    CORE_SALES_API_BASE_URL: "https://core.example.com",
    CORE_SALES_API_TOKEN: "sales-token-0123456789012345",
    CORE_SALES_DEFAULT_WAREHOUSE_ID: WAREHOUSE_ID,
    ...overrides
  });
}

test("Core Sales config is optional and only exposes a configured flag publicly", () => {
  const disabled = loadFoundationConfig(env());
  assert.equal(disabled.coreSales.configured, false);
  assert.equal(disabled.coreSales.apiToken, null);
  assert.equal(publicFoundationConfig(disabled).coreSalesConfigured, false);

  const configured = loadFoundationConfig(enabled());
  assert.equal(configured.coreSales.configured, true);
  assert.equal(configured.coreSales.baseUrl, "https://core.example.com");
  assert.equal(configured.coreSales.defaultWarehouseId, WAREHOUSE_ID);
  assert.equal(configured.coreSales.timeoutMs, 15000);
  assert.equal(publicFoundationConfig(configured).coreSalesConfigured, true);
  assert.equal("apiToken" in publicFoundationConfig(configured), false);
});

test("Core Sales config fails closed on incomplete, invalid or reused values", () => {
  assert.throws(
    () => loadFoundationConfig(env({ CORE_SALES_API_BASE_URL: "https://core.example.com" })),
    (error) => error.code === "incomplete_core_sales_config"
  );
  assert.throws(
    () => loadFoundationConfig(enabled({ CORE_SALES_DEFAULT_WAREHOUSE_ID: "warehouse-a" })),
    (error) => error.code === "invalid_core_sales_default_warehouse_id"
  );
  assert.throws(
    () => loadFoundationConfig(enabled({ CORE_SALES_API_TOKEN: "backend-token-0123456789" })),
    (error) => error.code === "core_sales_token_reuse_forbidden"
  );
  assert.throws(
    () => loadFoundationConfig(enabled({
      CORE_ONBOARDING_API_BASE_URL: "https://core.example.com",
      CORE_ONBOARDING_API_TOKEN: "sales-token-0123456789012345"
    })),
    (error) => error.code === "core_sales_token_reuse_forbidden"
  );
});

test("production Core Sales boundary requires HTTPS and a distinct non-placeholder secret", () => {
  const production = {
    NODE_ENV: "production",
    HOST: "0.0.0.0",
    PORT: "3001",
    LEGACY_INTERNAL_PORT: "3002",
    INSTALLATION_ID: "installation-a",
    NPP_CODE: "NPP-A",
    MCP_LEGACY_ACTOR_ID: "service:npp-a:mcp",
    BACKEND_API_TOKEN: "backend-token-0123456789-abcdefghi",
    CORS_ORIGINS: "https://mcp.example.com",
    AUTH_MODE: "proxy-service",
    PERSISTENCE_PROVIDER: "postgresql",
    DATABASE_URL: "postgresql://runtime.invalid/mcp",
    CORE_SALES_API_BASE_URL: "http://core.example.com",
    CORE_SALES_API_TOKEN: "sales-token-0123456789-abcdefghij",
    CORE_SALES_DEFAULT_WAREHOUSE_ID: WAREHOUSE_ID
  };
  assert.throws(
    () => loadFoundationConfig(production),
    (error) => error.code === "core_sales_api_base_url_https_required"
  );
});

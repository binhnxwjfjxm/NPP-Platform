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

test("Core Sales config is optional and only exposes a configured flag publicly", () => {
  const disabled = loadFoundationConfig(env());
  assert.equal(disabled.coreSales.configured, false);
  assert.equal(disabled.coreSales.apiToken, null);
  assert.equal(publicFoundationConfig(disabled).coreSalesConfigured, false);

  const enabled = loadFoundationConfig(env({
    CORE_SALES_API_BASE_URL: "https://core.example.com",
    CORE_SALES_API_TOKEN: "sales-token-0123456789012345",
    CORE_SALES_DEFAULT_WAREHOUSE_ID: WAREHOUSE_ID
  }));
  assert.equal(enabled.coreSales.configured, true);
  assert.equal(enabled.coreSales.baseUrl, "https://core.example.com");
  assert.equal(enabled.coreSales.defaultWarehouseId, WAREHOUSE_ID);
  assert.equal(enabled.coreSales.timeoutMs, 15000);
  assert.equal(publicFoundationConfig(enabled).coreSalesConfigured, true);
  assert.equal("apiToken" in publicFoundationConfig(enabled), false);
});

test("Core Sales config fails closed on incomplete, invalid or reused values", () => {
  assert.throws(
    () => loadFoundationConfig(env({ CORE_SALES_API_BASE_URL: "https://core.example.com" })),
    (error) => error.code === "incomplete_core_sales_config"
  );
  assert.throws(
    () => loadFoundationConfig(env({
      CORE_SALES_API_BASE_URL: "https://core.example.com",
      CORE_SALES_API_TOKEN: "sales-token-0123456789012345",
      CORE_SALES_DEFAULT_WAREHOUSE_ID: "warehouse-a"
    })),
    (error) => error.code === "invalid_core_sales_default_warehouse_id"
  );
  assert.throws(
    () => loadFoundationConfig(env({
      CORE_SALES_API_BASE_URL: "https://core.example.com",
      CORE_SALES_API_TOKEN: "backend-token-0123456789",
      CORE_SALES_DEFAULT_WAREHOUSE_ID: WAREHOUSE_ID
    })),
    (error) => error.code === "core_sales_token_reuse_forbidden"
  );
});

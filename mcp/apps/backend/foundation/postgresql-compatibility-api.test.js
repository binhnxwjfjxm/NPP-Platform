import test from "node:test";
import assert from "node:assert/strict";
import { bindProviderPersistence } from "./provider-runtime.js";
import { handlePostgresqlCompatibilityApi } from "./postgresql-compatibility-api.js";

function persistenceWithRows() {
  const client = {
    async query(sql) {
      if (sql.includes("FROM mcp.products product")) {
        return {
          rows: [{
            product_id: "product-1",
            variant_id: "variant-1",
            product_name: "Siro đào",
            brand_name: "NPP",
            category: "Siro",
            sku: "SIRO-DAO-750",
            variant_name: "Chai 750ml",
            size_label: "750 ml",
            sell_unit: "chai",
            pack_unit: "thùng",
            pack_quantity: "12"
          }]
        };
      }
      if (sql.includes("FROM mcp.mcp_route_sessions")) {
        return {
          rows: [{
            id: "session-1",
            route_id: "route-1",
            route_name: "Tuyến Quận 5",
            session_date: "2026-08-02",
            status: "active"
          }]
        };
      }
      throw new Error(`unexpected_query:${sql}`);
    }
  };
  return {
    async assertReady() {},
    async readiness() { return { ready: true, configured: true, provider: "postgresql" }; },
    async withTransaction(work) { return work(client); },
    async close() {}
  };
}

const context = Object.freeze({
  installation: Object.freeze({ id: "installation-test" })
});

function request(path) {
  return {
    req: { method: "GET" },
    url: new URL(path, "http://mcp.local")
  };
}

test("PostgreSQL product search preserves the variant-level picker contract", async () => {
  bindProviderPersistence(persistenceWithRows());
  const { req, url } = request("/api/products/search?q=siro&limit=10");
  const result = await handlePostgresqlCompatibilityApi(req, url, context);
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.payload.data, [{
    productId: "product-1",
    variantId: "variant-1",
    name: "Siro đào",
    brand: "NPP",
    category: "Siro",
    rawCategory: "Siro",
    sku: "SIRO-DAO-750",
    variantName: "Chai 750ml",
    sizeLabel: "750 ml",
    sellUnit: "chai",
    packUnit: "thùng",
    packQuantity: 12,
    price: 0
  }]);
});

test("PostgreSQL variant lookup uses the same picker contract", async () => {
  bindProviderPersistence(persistenceWithRows());
  const { req, url } = request("/api/products/product-1/variants");
  const result = await handlePostgresqlCompatibilityApi(req, url, context);
  assert.equal(result.payload.data[0].productId, "product-1");
  assert.equal(result.payload.data[0].variantId, "variant-1");
  assert.equal(result.payload.data[0].name, "Siro đào");
});

test("PostgreSQL exposes active session status for route-customer creation", async () => {
  bindProviderPersistence(persistenceWithRows());
  const { req, url } = request("/api/mcp-settings/session-status?routeId=route-1");
  const result = await handlePostgresqlCompatibilityApi(req, url, context);
  assert.deepEqual(result.payload.data, {
    sessions: [{
      id: "session-1",
      routeId: "route-1",
      routeName: "Tuyến Quận 5",
      sessionDate: "2026-08-02",
      status: "active"
    }]
  });
});

import test from "node:test";
import assert from "node:assert/strict";
import { bindProviderPersistence } from "./provider-runtime.js";
import { handlePostgresqlCompatibilityApi } from "./postgresql-compatibility-api.js";

function persistenceWithRows({ daySession = true } = {}) {
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
      if (sql.includes("FROM mcp.mcp_route_sessions") && sql.includes("status = 'active'")) {
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
      if (sql.includes("FROM mcp.mcp_route_sessions") && sql.includes("session_date = $3")) {
        return {
          rows: daySession ? [{
            id: "session-1",
            route_id: "route-1",
            route_name: "Tuyến Quận 5",
            session_date: "2026-08-02",
            sales: "Nhân viên A",
            area: "Quận 5",
            status: "active",
            created_at: "2026-08-02T01:30:00.000Z"
          }] : []
        };
      }
      if (sql.includes("FROM mcp.mcp_session_customers")) {
        return {
          rows: [{
            id: "session-customer-1",
            session_id: "session-1",
            route_id: "route-1",
            route_customer_id: "route-customer-1",
            customer_id: "customer-1",
            customer_name: "Cửa hàng A",
            phone: "0900000000",
            area: "Quận 5",
            address: "Địa chỉ A",
            sort_order: 1,
            source: "planned",
            planned_status: "planned",
            visit_status: "visited",
            status_reason: null,
            visit_id: "visit-1",
            order_id: "order-1",
            test_id: null,
            report_id: null,
            followup_count: 0,
            note: "Đã ghé",
            checkin_lat: null,
            checkin_lng: null,
            checkin_accuracy: null,
            checkin_at: "2026-08-02T02:00:00.000Z",
            checkin_source: "gps",
            created_at: "2026-08-02T01:30:00.000Z",
            updated_at: "2026-08-02T02:00:00.000Z"
          }]
        };
      }
      if (sql.includes("FROM mcp.mcp_visits")) {
        return {
          rows: [{
            id: "visit-1",
            session_id: "session-1",
            route_id: "route-1",
            route_customer_id: "route-customer-1",
            visit_date: "2026-08-02",
            status: "visited",
            has_order: true,
            has_test: false,
            has_report: false,
            order_id: "order-1",
            test_id: null,
            report_id: null,
            checkin_at: "2026-08-02T02:00:00.000Z",
            note: "Có đơn",
            created_at: "2026-08-02T02:00:00.000Z"
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

test("PostgreSQL typed runtime exposes MCP day data for an opened session", async () => {
  bindProviderPersistence(persistenceWithRows());
  const { req, url } = request("/api/mcp-day/data?routeId=route-1&date=2026-08-02");
  const result = await handlePostgresqlCompatibilityApi(req, url, context);

  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.data.sessionOpened, true);
  assert.equal(result.payload.data.run.id, "session-1");
  assert.equal(result.payload.data.run.routeId, "route-1");
  assert.equal(result.payload.data.lines.length, 1);
  assert.equal(result.payload.data.lines[0].sessionCustomerId, "session-customer-1");
  assert.equal(result.payload.data.lines[0].hasOrder, true);
  assert.equal(result.payload.data.results.length, 1);
});

test("PostgreSQL typed runtime keeps the canonical empty MCP day contract", async () => {
  bindProviderPersistence(persistenceWithRows({ daySession: false }));
  const { req, url } = request("/api/mcp-day/data?routeId=route-empty&date=2026-08-03");
  const result = await handlePostgresqlCompatibilityApi(req, url, context);

  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.data.sessionOpened, false);
  assert.equal(result.payload.data.run.id, "no-session");
  assert.deepEqual(result.payload.data.lines, []);
  assert.deepEqual(result.payload.data.results, []);
});

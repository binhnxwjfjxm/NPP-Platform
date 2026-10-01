import test from "node:test";
import assert from "node:assert/strict";
import { bindProviderPersistence } from "./provider-runtime.js";
import { handlePostgresqlCompatibilityApi } from "./postgresql-compatibility-api.js";

function persistenceWithRows({ daySession = true, dayStatus = "active" } = {}) {
  const client = {
    async query(sql, params = []) {
      if (sql.includes("FROM mcp.test_files") && !sql.includes("FROM mcp.test_file_products")) {
        assert.deepEqual(params, ["installation-test", null]);
        return {
          rows: [{
            id: "file-1",
            title: "Phiếu thử L7",
            test_date: "2026-09-29",
            status: "active",
            created_at: "2026-09-29T01:00:00.000Z"
          }]
        };
      }
      if (sql.includes("FROM mcp.test_file_products")) {
        assert.deepEqual(params, ["installation-test", null]);
        return {
          rows: [{
            id: "test-product-1",
            file_id: "file-1",
            product_name: "Sản phẩm thử L7",
            sort_order: 1,
            created_at: "2026-09-29T01:05:00.000Z"
          }]
        };
      }
      if (sql.includes("FROM mcp.test_customer_results result")) {
        assert.deepEqual(params, ["installation-test", null]);
        return {
          rows: [{
            id: "result-1",
            product_name: "Sản phẩm thử L7",
            status: "ok",
            note: "Có cơ hội",
            updated_at: "2026-09-29T02:00:00.000Z",
            created_at: "2026-09-29T01:30:00.000Z",
            customer_name: "Khách L7",
            area: "Cần Thơ",
            customer_note: ""
          }, {
            id: "result-2",
            product_name: "Sản phẩm thử B",
            status: "retry",
            note: "Cần kiểm lại",
            updated_at: "2026-09-29T01:50:00.000Z",
            created_at: "2026-09-29T01:20:00.000Z",
            customer_name: "Khách B",
            area: "Vĩnh Long",
            customer_note: ""
          }]
        };
      }
      if (sql.includes("FROM mcp.mcp_report_setting_groups")) {
        assert.deepEqual(params, ["installation-test", "market_report", false]);
        return {
          rows: [{
            id: "group-1",
            installation_id: "installation-test",
            group_key: "market_competitors",
            group_name: "Đối thủ",
            description: "Danh sách đối thủ",
            sort_order: 10,
            active: true,
            raw_payload: { group_type: "market_report", section: "competitor" }
          }]
        };
      }
      if (sql.includes("FROM mcp.mcp_report_settings")) {
        assert.equal(params[0], "installation-test");
        assert.deepEqual(params[1], ["group-1"]);
        assert.equal(params[2], false);
        return {
          rows: [{
            id: "item-1",
            installation_id: "installation-test",
            group_id: "group-1",
            setting_key: "competitor-a",
            setting_name: "Đối thủ A",
            value: "Đối thủ A",
            sort_order: 20,
            active: true,
            raw_payload: {
              category: "Siro",
              brand_name: "Brand A",
              product_id: "product-a"
            }
          }]
        };
      }
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
            status: dayStatus,
            created_at: "2026-08-02T01:30:00.000Z"
          }] : []
        };
      }
      if (sql.includes("FROM mcp.mcp_session_customers")) {
        assert.doesNotMatch(sql, /\bplanned_status\b|\bvisit_id\b/);
        assert.match(sql, /\baccount_name\b/);
        assert.match(sql, /\bchecked_in\b/);
        return {
          rows: [{
            id: "session-customer-1",
            session_id: "session-1",
            route_id: "route-1",
            route_customer_id: "route-customer-1",
            customer_id: "customer-1",
            customer_name: "Cửa hàng A",
            account_name: "Cửa hàng A",
            phone: "0900000000",
            area: "Quận 5",
            address: "Địa chỉ A",
            sort_order: 1,
            source: "planned",
            status: "done",
            visit_status: "visited",
            status_reason: null,
            order_id: "order-1",
            test_id: null,
            report_id: null,
            followup_count: 0,
            checked_in: true,
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
        assert.match(sql, /\bsession_customer_id\b/);
        assert.doesNotMatch(sql, /\bhas_order\b|\bhas_test\b|\bhas_report\b/);
        assert.doesNotMatch(sql, /\border_id\b|\btest_id\b|\breport_id\b/);
        return {
          rows: [{
            id: "visit-1",
            session_id: "session-1",
            session_customer_id: "session-customer-1",
            route_id: "route-1",
            route_customer_id: "route-customer-1",
            customer_id: "customer-1",
            customer_name: "Cửa hàng A",
            visit_date: "2026-08-02",
            status: "visited",
            checkin_at: "2026-08-02T02:00:00.000Z",
            checkout_at: "2026-08-02T02:10:00.000Z",
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

const reportSettingsContext = Object.freeze({
  auth: Object.freeze({ authenticated: true }),
  installation: Object.freeze({ id: "installation-test" }),
  principal: Object.freeze({
    id: "user:employee-test",
    permissions: Object.freeze(["mcp.report-setting.write"]),
    scopes: Object.freeze([])
  })
});

function request(path) {
  return {
    req: { method: "GET" },
    url: new URL(path, "http://mcp.local")
  };
}

test("PostgreSQL typed runtime exposes product-trial options for the mobile picker", async () => {
  bindProviderPersistence(persistenceWithRows());
  const { req, url } = request("/api/mcp-day/test-options");
  const result = await handlePostgresqlCompatibilityApi(req, url, context);

  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.payload.data, {
    files: [{
      id: "file-1",
      title: "Phiếu thử L7",
      testDate: "2026-09-29",
      products: [{
        id: "test-product-1",
        productName: "Sản phẩm thử L7"
      }]
    }]
  });
});

test("PostgreSQL typed runtime exposes field-check history with canonical mobile statuses", async () => {
  bindProviderPersistence(persistenceWithRows());
  const { req, url } = request("/api/market-checks/data?status=opportunity&search=kh%C3%A1ch");
  const result = await handlePostgresqlCompatibilityApi(req, url, context);

  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.data.checks.length, 1);
  assert.deepEqual(result.payload.data.checks[0], {
    id: "result-1",
    date: "2026-09-29",
    routeName: "Cần Thơ",
    accountName: "Khách L7",
    productName: "Sản phẩm thử L7",
    competitorName: "ok",
    shelfPrice: 0,
    stockStatus: "ok",
    note: "Có cơ hội",
    status: "opportunity"
  });
  assert.equal(result.payload.data.kpis[0].value, 1);
  assert.equal(result.payload.data.kpis[1].value, 1);
  assert.equal(result.payload.data.kpis[2].value, 0);
});

test("PostgreSQL typed runtime exposes report settings through the mobile compatibility contract", async () => {
  bindProviderPersistence(persistenceWithRows());
  const { req, url } = request("/api/mcp-report-settings?groupType=market_report");
  const result = await handlePostgresqlCompatibilityApi(req, url, reportSettingsContext);

  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.payload.data, {
    groups: [{
      id: "group-1",
      key: "market_competitors",
      title: "Đối thủ",
      type: "market_report",
      description: "Danh sách đối thủ",
      status: "active",
      sortOrder: 10,
      meta: { group_type: "market_report", section: "competitor" },
      items: [{
        id: "item-1",
        key: "competitor-a",
        label: "Đối thủ A",
        value: "Đối thủ A",
        category: "Siro",
        brandName: "Brand A",
        productId: "product-a",
        status: "active",
        sortOrder: 20,
        meta: {
          category: "Siro",
          brand_name: "Brand A",
          product_id: "product-a"
        }
      }]
    }]
  });
});

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

test("PostgreSQL typed runtime exposes MCP day data using the actual PostgreSQL session schema", async () => {
  bindProviderPersistence(persistenceWithRows());
  const { req, url } = request("/api/mcp-day/data?routeId=route-1&date=2026-08-02");
  const result = await handlePostgresqlCompatibilityApi(req, url, context);

  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.data.sessionOpened, true);
  assert.equal(result.payload.data.run.id, "session-1");
  assert.equal(result.payload.data.run.routeId, "route-1");
  assert.equal(result.payload.data.run.status, "active");
  assert.equal(result.payload.data.lines.length, 1);
  assert.equal(result.payload.data.lines[0].sessionCustomerId, "session-customer-1");
  assert.equal(result.payload.data.lines[0].visitId, "visit-1");
  assert.equal(result.payload.data.lines[0].hasOrder, true);
  assert.equal(result.payload.data.results.length, 1);
  assert.equal(result.payload.data.results[0].sessionCustomerId, "session-customer-1");
  assert.equal(result.payload.data.results[0].hasOrder, true);
});

test("PostgreSQL MCP day data preserves a completed session as completed", async () => {
  bindProviderPersistence(persistenceWithRows({ dayStatus: "done" }));
  const { req, url } = request("/api/mcp-day/data?routeId=route-1&date=2026-08-02");
  const result = await handlePostgresqlCompatibilityApi(req, url, context);

  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.data.sessionOpened, true);
  assert.equal(result.payload.data.run.id, "session-1");
  assert.equal(result.payload.data.run.status, "done");
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

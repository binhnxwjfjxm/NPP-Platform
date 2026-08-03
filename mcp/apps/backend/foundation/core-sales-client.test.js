import test from "node:test";
import assert from "node:assert/strict";
import {
  coreSalesOrderProjection,
  createCoreSalesOrder,
  readCoreSalesOrder,
  searchCoreSalesSkus
} from "./core-sales-client.js";

const config = {
  coreSales: {
    configured: true,
    baseUrl: "https://core.example.test",
    apiToken: "core-sales-token-0123456789",
    defaultWarehouseId: "11111111-1111-4111-8111-111111111111",
    timeoutMs: 5000
  }
};
const context = { requestId: "req_sales_client" };

function jsonResponse(status, data) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return data; }
  };
}

function order(overrides = {}) {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    number: null,
    status: "draft",
    currentVersionNumber: "1",
    sourceType: "MCP",
    sourceId: "order_1",
    sourceOutletId: "route_customer_1",
    customerId: "33333333-3333-4333-8333-333333333333",
    customerAddressId: "44444444-4444-4444-8444-444444444444",
    currency: "VND",
    updatedAt: "2026-08-03T00:00:00.000Z",
    versions: [{ versionNumber: "1", total: "125000", currency: "VND" }],
    ...overrides
  };
}

test("Core Sales SKU search uses dedicated server token", async () => {
  let seen;
  const result = await searchCoreSalesSkus("tra xanh", context, config, {
    limit: 20,
    fetchImpl: async (url, init) => {
      seen = { url, init };
      return jsonResponse(200, { data: [{ id: "sku-1", productId: "product-1" }] });
    }
  });
  assert.equal(result.length, 1);
  assert.match(seen.url, /\/api\/sales-orders\/sku-search\?/);
  assert.match(seen.url, /search=tra\+xanh/);
  assert.equal(seen.init.headers.Authorization, `Bearer ${config.coreSales.apiToken}`);
  assert.equal(seen.init.headers["X-Request-Id"], context.requestId);
});

test("Core Sales create sends deterministic idempotency header and maps draft", async () => {
  let seen;
  const created = await createCoreSalesOrder({ sourceType: "MCP" }, context, config, {
    idempotencyKey: "mcp-sales-order-order_1",
    fetchImpl: async (url, init) => {
      seen = { url, init };
      return jsonResponse(201, { data: order() });
    }
  });
  assert.equal(created.status, "draft");
  assert.equal(seen.url, "https://core.example.test/api/sales-orders");
  assert.equal(seen.init.headers["Idempotency-Key"], "mcp-sales-order-order_1");
  assert.equal(JSON.parse(seen.init.body).sourceType, "MCP");

  const projection = coreSalesOrderProjection(created);
  assert.equal(projection.total, "125000");
  assert.equal(projection.currentVersionNumber, 1);
});

test("Core Sales read uses canonical detail endpoint and sanitizes Core errors", async () => {
  const fetched = await readCoreSalesOrder("22222222-2222-4222-8222-222222222222", context, config, {
    fetchImpl: async (url) => {
      assert.equal(url, "https://core.example.test/api/sales-orders/22222222-2222-4222-8222-222222222222");
      return jsonResponse(200, { data: order({ status: "confirmed", number: "SO-202608-0001" }) });
    }
  });
  assert.equal(fetched.status, "confirmed");

  await assert.rejects(
    () => createCoreSalesOrder({}, context, config, {
      idempotencyKey: "mcp-sales-order-order_1",
      fetchImpl: async () => jsonResponse(409, { error: { code: "IDEMPOTENCY_PAYLOAD_MISMATCH", message: "Payload mismatch" } })
    }),
    (error) => error.code === "IDEMPOTENCY_PAYLOAD_MISMATCH" && error.statusCode === 409 && error.publicMessage === "Payload mismatch"
  );
});

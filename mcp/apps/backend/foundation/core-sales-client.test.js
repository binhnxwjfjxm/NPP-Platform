import test from "node:test";
import assert from "node:assert/strict";
import {
  coreSalesOrderProjection,
  createCoreSalesOrder,
  listCoreProductVariants,
  readCoreSalesOrder,
  resolveCoreBasePrice,
  searchCoreSalesSkus
} from "./core-sales-client.js";

const warehouseId = "11111111-1111-4111-8111-111111111111";
const orderId = "22222222-2222-4222-8222-222222222222";
const customerId = "33333333-3333-4333-8333-333333333333";
const addressId = "44444444-4444-4444-8444-444444444444";
const productId = "55555555-5555-4555-8555-555555555555";
const variantId = "66666666-6666-4666-8666-666666666666";
const employeeId = "77777777-7777-4777-8777-777777777777";
const config = {
  coreSales: {
    configured: true,
    baseUrl: "https://core.example.test",
    apiToken: "core-sales-token-0123456789",
    defaultWarehouseId: warehouseId,
    timeoutMs: 5000
  }
};
const context = { requestId: "req_sales_client", principal: { employeeId } };

function jsonResponse(status, data) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return data; }
  };
}

function order(overrides = {}) {
  return {
    id: orderId,
    number: null,
    status: "draft",
    currentVersionNumber: "1",
    sourceType: "MCP",
    sourceId: "order_1",
    sourceOutletId: "route_customer_1",
    sourceEmployeeId: employeeId,
    customerId,
    customerAddressId: addressId,
    currency: "VND",
    updatedAt: "2026-08-03T00:00:00.000Z",
    versions: [{ versionNumber: "1", total: "125000", currency: "VND", sourceEmployeeId: employeeId }],
    ...overrides
  };
}

test("Core Sales SKU search uses dedicated server token and trusted employee header", async () => {
  let seen;
  const result = await searchCoreSalesSkus("tra xanh", context, config, {
    limit: 20,
    fetchImpl: async (url, init) => {
      seen = { url, init };
      return jsonResponse(200, { data: [{ id: variantId, productId }] });
    }
  });
  assert.equal(result.length, 1);
  assert.match(seen.url, /\/api\/sales-orders\/sku-search\?/);
  assert.match(seen.url, /search=tra\+xanh/);
  assert.equal(seen.init.headers.Authorization, `Bearer ${config.coreSales.apiToken}`);
  assert.equal(seen.init.headers["X-Request-Id"], context.requestId);
  assert.equal(seen.init.headers["X-NPP-MCP-Employee-Id"], employeeId);
});

test("Core Sales boundary fails closed without trusted employee context", async () => {
  await assert.rejects(
    () => searchCoreSalesSkus("tea", { requestId: "req_missing_employee" }, config),
    (error) => error.code === "core_sales_employee_context_required" && error.statusCode === 400
  );
  await assert.rejects(
    () => searchCoreSalesSkus("tea", { requestId: "req_bad_employee", principal: { employeeId: "route-1" } }, config),
    (error) => error.code === "core_sales_employee_context_invalid" && error.statusCode === 400
  );
});

test("Core product variants use exact canonical route and reject path-shaped IDs", async () => {
  let seen;
  const variants = await listCoreProductVariants(productId, context, config, {
    fetchImpl: async (url, init) => {
      seen = { url, init };
      return jsonResponse(200, { data: [{ id: variantId, product_id: productId, sku: "TEA-01" }] });
    }
  });
  assert.equal(variants.length, 1);
  assert.equal(seen.url, `https://core.example.test/api/products/${productId}/variants`);
  assert.equal(seen.init.method, "GET");
  assert.equal(seen.init.headers.Authorization, `Bearer ${config.coreSales.apiToken}`);

  await assert.rejects(
    () => listCoreProductVariants("", context, config),
    (error) => error.code === "core_sales_product_id_required" && error.statusCode === 400
  );
  await assert.rejects(
    () => listCoreProductVariants("..", context, config),
    (error) => error.code === "core_sales_product_id_invalid" && error.statusCode === 400
  );
  await assert.rejects(
    () => readCoreSalesOrder("../orders", context, config),
    (error) => error.code === "core_sales_order_id_invalid" && error.statusCode === 400
  );
});

test("Core base price uses canonical pricing resolver and does not substitute final price", async () => {
  const priceAt = "2026-08-12T09:00:00.000Z";
  let seen;
  const resolved = await resolveCoreBasePrice(variantId, context, config, {
    priceAt,
    fetchImpl: async (url, init) => {
      seen = { url, init };
      return jsonResponse(200, {
        data: {
          variantId,
          currencyCode: "VND",
          priceAt,
          baseUnitPriceMinor: "125000",
          finalUnitPriceMinor: "99000"
        }
      });
    }
  });

  assert.equal(seen.url, "https://core.example.test/api/pricing/resolve");
  assert.equal(seen.init.method, "POST");
  assert.equal(seen.init.headers.Authorization, `Bearer ${config.coreSales.apiToken}`);
  assert.deepEqual(JSON.parse(seen.init.body), {
    variantId,
    quantity: "1",
    currencyCode: "VND",
    priceAt
  });
  assert.equal(resolved.amount, 125000);
  assert.equal(resolved.currency, "VND");
  assert.equal(resolved.priceAt, priceAt);
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
  assert.equal(seen.init.headers["X-NPP-MCP-Employee-Id"], employeeId);
  assert.equal(JSON.parse(seen.init.body).sourceType, "MCP");
  assert.equal("employeeId" in JSON.parse(seen.init.body), false);
  assert.equal("sourceEmployeeId" in JSON.parse(seen.init.body), false);

  const projection = coreSalesOrderProjection(created);
  assert.equal(projection.total, "125000");
  assert.equal(projection.currentVersionNumber, 1);
  assert.equal(projection.sourceEmployeeId, employeeId);
});

test("Core Sales read uses canonical detail endpoint and passes through business conflicts", async () => {
  const fetched = await readCoreSalesOrder(orderId, context, config, {
    fetchImpl: async (url) => {
      assert.equal(url, `https://core.example.test/api/sales-orders/${orderId}`);
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

test("Core authentication failures are treated as an upstream boundary error", async () => {
  await assert.rejects(
    () => searchCoreSalesSkus("tea", context, config, {
      fetchImpl: async () => jsonResponse(401, { error: { code: "UNAUTHORIZED", message: "bad service token" } })
    }),
    (error) => error.code === "UNAUTHORIZED" && error.statusCode === 502
  );
  await assert.rejects(
    () => searchCoreSalesSkus("tea", context, config, {
      fetchImpl: async () => jsonResponse(403, { error: { code: "FORBIDDEN", message: "scope denied" } })
    }),
    (error) => error.code === "FORBIDDEN" && error.statusCode === 502
  );
});

test("Core timeout, body-read failure and network failure are mapped consistently", async () => {
  await assert.rejects(
    () => searchCoreSalesSkus("tea", context, config, {
      fetchImpl: async () => { const error = new Error("aborted"); error.name = "AbortError"; throw error; }
    }),
    (error) => error.code === "core_sales_timeout" && error.statusCode === 504 && error.publicRetryable === true
  );

  await assert.rejects(
    () => searchCoreSalesSkus("tea", context, config, {
      fetchImpl: async () => { throw new Error("socket closed"); }
    }),
    (error) => error.code === "core_sales_unavailable" && error.statusCode === 502 && error.publicRetryable === true
  );

  await assert.rejects(
    () => searchCoreSalesSkus("tea", context, config, {
      fetchImpl: async () => ({ ok: true, status: 200, async json() { throw new Error("body closed"); } })
    }),
    (error) => error.code === "core_sales_response_invalid" && error.statusCode === 502
  );
});
import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { handleCoreSalesApi } from "./core-sales-api.js";

const productId = "11111111-1111-4111-8111-111111111111";
const warehouseId = "22222222-2222-4222-8222-222222222222";
const variantA = "33333333-3333-4333-8333-333333333333";
const variantB = "44444444-4444-4444-8444-444444444444";
const variantC = "55555555-5555-4555-8555-555555555555";
const variantD = "66666666-6666-4666-8666-666666666666";
const variantE = "77777777-7777-4777-8777-777777777777";
const config = {
  coreSales: {
    configured: true,
    baseUrl: "https://core.example.test",
    apiToken: "core-sales-token-0123456789",
    defaultWarehouseId: warehouseId,
    timeoutMs: 5000
  }
};

function requestContext({ permissions = ["mcp.sales-order.read", "mcp.sales-order.create"], scopes = [`mcp:warehouse:${warehouseId}`] } = {}) {
  return {
    requestId: "req_core_sales_api",
    auth: { authenticated: true },
    principal: { id: "service:npp-a:mcp", permissions, scopes }
  };
}

function request(method, body = "") {
  const stream = Readable.from(body ? [body] : []);
  stream.method = method;
  return stream;
}

function jsonResponse(status, data) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return data; }
  };
}

test("Core Sales product search uses the dedicated route and clamps limit", async () => {
  let seen;
  const result = await handleCoreSalesApi(
    { method: "GET" },
    new URL("http://mcp.local/api/core-sales/products/search?q=tra&limit=999"),
    requestContext(),
    config,
    {
      fetchImpl: async (url) => {
        seen = new URL(url);
        return jsonResponse(200, { data: [{
          id: variantA,
          productId,
          productName: "Trà NPP",
          sku: "SKU-A",
          variantName: "A",
          unitId: "88888888-8888-4888-8888-888888888888",
          unitCode: "GOI",
          conversionToBase: "1",
          allowsFractional: false,
          defaultTaxMode: "EXCLUSIVE",
          defaultTaxRate: "0"
        }] });
      }
    }
  );

  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.data[0].catalogSource, "NPP_CORE");
  assert.equal(seen.pathname, "/api/sales-orders/sku-search");
  assert.equal(seen.searchParams.get("search"), "tra");
  assert.equal(seen.searchParams.get("limit"), "50");
});

test("product variant route reads exact NPP product and rechecks only eligible Sales SKUs", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url === `https://core.example.test/api/products/${productId}/variants`) {
      return jsonResponse(200, { data: [
        { id: variantA, product_id: productId, sku: "SKU-A", name: "A", is_active: true, is_sellable: true, unit_id: "unit-a", conversion_to_base: "1" },
        { id: variantB, product_id: productId, sku: "SKU-B", name: "B", is_active: false, is_sellable: true, unit_id: "unit-b", conversion_to_base: "1" },
        { id: variantC, product_id: productId, sku: "SKU-C", name: "C", is_active: true, is_sellable: false, unit_id: "unit-c", conversion_to_base: "1" },
        { id: variantD, product_id: productId, sku: "SKU-D", name: "D", is_active: true, is_sellable: true, unit_id: null, conversion_to_base: "1" },
        { id: variantE, product_id: productId, sku: "SKU-E", name: "E", is_active: true, is_sellable: true, unit_id: "unit-e", conversion_to_base: "0" }
      ] });
    }
    const parsed = new URL(url);
    if (parsed.pathname === "/api/sales-orders/sku-search" && parsed.searchParams.get("search") === "SKU-A") {
      return jsonResponse(200, { data: [{
        id: variantA, productId, productName: "Sản phẩm A", sku: "SKU-A", variantName: "A",
        unitId: "unit-a", unitCode: "CAI", conversionToBase: "1", allowsFractional: false,
        defaultTaxMode: "EXCLUSIVE", defaultTaxRate: "0"
      }] });
    }
    throw new Error(`unexpected_url:${url}`);
  };

  const result = await handleCoreSalesApi(
    { method: "GET" },
    new URL(`http://mcp.local/api/core-sales/products/${productId}/variants`),
    requestContext(),
    config,
    { fetchImpl }
  );

  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.payload.data.map((item) => item.variantId), [variantA]);
  assert.equal(calls.includes(`https://core.example.test/api/products/${productId}/variants`), true);
  assert.equal(calls.filter((url) => url.includes("/api/sales-orders/sku-search")).length, 1);
});

test("Core Sales routes deny missing permission or warehouse scope", async () => {
  for (const path of [
    "/api/mcp-day/session-customer/sales-order/submit",
    "/api/mcp-day/session-customer/sales-order/sync"
  ]) {
    await assert.rejects(
      () => handleCoreSalesApi(
        request("POST", "{}"),
        new URL(`http://mcp.local${path}`),
        requestContext({ permissions: [], scopes: [] }),
        config
      ),
      (error) => error.statusCode === 403 && error.code === "permission_denied"
    );
  }

  await assert.rejects(
    () => handleCoreSalesApi(
      { method: "GET" },
      new URL("http://mcp.local/api/core-sales/products/search"),
      requestContext({ permissions: ["mcp.sales-order.read"], scopes: [] }),
      config
    ),
    (error) => error.statusCode === 403 && error.code === "scope_denied"
  );
});

test("unmatched routes pass through and malformed mutation bodies fail before service calls", async () => {
  assert.equal(
    await handleCoreSalesApi({ method: "GET" }, new URL("http://mcp.local/api/products/search"), requestContext(), config),
    null
  );

  await assert.rejects(
    () => handleCoreSalesApi(
      request("POST", "{"),
      new URL("http://mcp.local/api/mcp-day/session-customer/sales-order/submit"),
      requestContext(),
      config
    ),
    (error) => error.statusCode === 400 && error.message === "invalid_json_body"
  );

  await assert.rejects(
    () => handleCoreSalesApi(
      request("POST", "x".repeat(256 * 1024 + 1)),
      new URL("http://mcp.local/api/mcp-day/session-customer/sales-order/submit"),
      requestContext(),
      config
    ),
    (error) => error.statusCode === 413 && error.message === "request_body_too_large"
  );
});

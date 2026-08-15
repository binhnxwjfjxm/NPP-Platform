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
    principal: { id: "service:npp-a:mcp", employeeId: "employee-a", permissions, scopes }
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

function skuOption(overrides = {}) {
  return {
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
    defaultTaxRate: "0",
    ...overrides
  };
}

test("Core Sales product search enriches canonical SKU/unit data with Core BASE price", async () => {
  const calls = [];
  const result = await handleCoreSalesApi(
    { method: "GET" },
    new URL("http://mcp.local/api/core-sales/products/search?q=tra&limit=999"),
    requestContext(),
    config,
    {
      fetchImpl: async (url, init) => {
        const parsed = new URL(url);
        calls.push({ url: parsed, init });
        if (parsed.pathname === "/api/sales-orders/sku-search") return jsonResponse(200, { data: [skuOption()] });
        if (parsed.pathname === "/api/pricing/resolve") {
          const body = JSON.parse(init.body);
          assert.equal(body.variantId, variantA);
          assert.equal(body.quantity, "1");
          assert.equal(body.currencyCode, "VND");
          assert.ok(body.priceAt);
          return jsonResponse(200, { data: { variantId: variantA, currencyCode: "VND", priceAt: body.priceAt, baseUnitPriceMinor: "125000", finalUnitPriceMinor: "99000" } });
        }
        throw new Error(`unexpected_url:${url}`);
      }
    }
  );
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.data[0].catalogSource, "NPP_CORE");
  assert.equal(result.payload.data[0].sellUnit, "GOI");
  assert.equal(result.payload.data[0].price, 125000);
  const searchCall = calls.find((call) => call.url.pathname === "/api/sales-orders/sku-search");
  assert.equal(searchCall.url.searchParams.get("search"), "tra");
  assert.equal(searchCall.url.searchParams.get("limit"), "50");
  assert.equal(calls.filter((call) => call.url.pathname === "/api/pricing/resolve").length, 1);
});

test("missing Core BASE price stays null without falling back to a legacy MCP price", async () => {
  const result = await handleCoreSalesApi(
    { method: "GET" },
    new URL("http://mcp.local/api/core-sales/products/search?q=tea"),
    requestContext(),
    config,
    { fetchImpl: async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/api/sales-orders/sku-search") return jsonResponse(200, { data: [skuOption({ legacyPrice: 1 })] });
      if (parsed.pathname === "/api/pricing/resolve") return jsonResponse(409, { error: { code: "BASE_PRICE_NOT_FOUND", message: "No BASE price is configured" } });
      throw new Error(`unexpected_url:${url}`);
    } }
  );
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.data[0].price, null);
});

test("Core pricing infrastructure failure is surfaced instead of masquerading as missing price", async () => {
  await assert.rejects(
    () => handleCoreSalesApi(
      { method: "GET" },
      new URL("http://mcp.local/api/core-sales/products/search?q=tea"),
      requestContext(),
      config,
      { fetchImpl: async (url) => {
        const parsed = new URL(url);
        if (parsed.pathname === "/api/sales-orders/sku-search") return jsonResponse(200, { data: [skuOption()] });
        if (parsed.pathname === "/api/pricing/resolve") return jsonResponse(503, { error: { code: "PRICING_STORAGE_UNAVAILABLE", message: "Pricing unavailable" } });
        throw new Error(`unexpected_url:${url}`);
      } }
    ),
    (error) => error.code === "PRICING_STORAGE_UNAVAILABLE" && error.statusCode === 502 && error.publicRetryable === true
  );
});

test("product variant route reads exact NPP product and rechecks only eligible Sales SKUs before pricing", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
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
    if (parsed.pathname === "/api/sales-orders/sku-search" && parsed.searchParams.get("search") === "SKU-A") return jsonResponse(200, { data: [skuOption({ productName: "Sản phẩm A", unitId: "unit-a", unitCode: "CAI" })] });
    if (parsed.pathname === "/api/pricing/resolve") {
      const body = JSON.parse(init.body);
      assert.equal(body.variantId, variantA);
      return jsonResponse(200, { data: { variantId: variantA, currencyCode: "VND", priceAt: body.priceAt, baseUnitPriceMinor: "88000", finalUnitPriceMinor: "88000" } });
    }
    throw new Error(`unexpected_url:${url}`);
  };
  const result = await handleCoreSalesApi({ method: "GET" }, new URL(`http://mcp.local/api/core-sales/products/${productId}/variants`), requestContext(), config, { fetchImpl });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.payload.data.map((item) => item.variantId), [variantA]);
  assert.equal(result.payload.data[0].price, 88000);
  assert.equal(calls.includes(`https://core.example.test/api/products/${productId}/variants`), true);
  assert.equal(calls.filter((url) => url.includes("/api/sales-orders/sku-search")).length, 1);
  assert.equal(calls.filter((url) => url.includes("/api/pricing/resolve")).length, 1);
});

test("direct Core Sales routes deny missing permission or warehouse scope", async () => {
  await assert.rejects(
    () => handleCoreSalesApi(request("POST", "{}"), new URL("http://mcp.local/api/core-sales/orders"), requestContext({ permissions: [], scopes: [] }), config),
    (error) => error.statusCode === 403 && error.code === "permission_denied"
  );
  await assert.rejects(
    () => handleCoreSalesApi({ method: "GET" }, new URL("http://mcp.local/api/core-sales/orders"), requestContext({ permissions: ["mcp.sales-order.read"], scopes: [] }), config),
    (error) => error.statusCode === 403 && error.code === "scope_denied"
  );
  await assert.rejects(
    () => handleCoreSalesApi({ method: "GET" }, new URL("http://mcp.local/api/core-sales/products/search"), requestContext({ permissions: ["mcp.sales-order.read"], scopes: [] }), config),
    (error) => error.statusCode === 403 && error.code === "scope_denied"
  );
});

test("legacy session-customer Sales Order routes are retired and malformed direct mutations fail before service calls", async () => {
  for (const path of [
    "/api/mcp-day/session-customer/sales-order",
    "/api/mcp-day/session-customer/sales-order/submit",
    "/api/mcp-day/session-customer/sales-order/sync"
  ]) {
    assert.equal(await handleCoreSalesApi({ method: path.endsWith("sales-order") ? "GET" : "POST" }, new URL(`http://mcp.local${path}`), requestContext(), config), null);
  }
  assert.equal(await handleCoreSalesApi({ method: "GET" }, new URL("http://mcp.local/api/products/search"), requestContext(), config), null);
  await assert.rejects(
    () => handleCoreSalesApi(request("POST", "{"), new URL("http://mcp.local/api/core-sales/orders"), requestContext(), config),
    (error) => error.statusCode === 400 && error.message === "invalid_json_body"
  );
  await assert.rejects(
    () => handleCoreSalesApi(request("POST", "x".repeat(256 * 1024 + 1)), new URL("http://mcp.local/api/core-sales/orders"), requestContext(), config),
    (error) => error.statusCode === 413 && error.message === "request_body_too_large"
  );
});

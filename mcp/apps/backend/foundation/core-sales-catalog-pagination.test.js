import test from "node:test";
import assert from "node:assert/strict";
import { handleCoreSalesApi } from "./core-sales-api.js";

const productId = "11111111-1111-4111-8111-111111111111";
const warehouseId = "22222222-2222-4222-8222-222222222222";
const employeeId = "99999999-9999-4999-8999-999999999999";
const unitId = "88888888-8888-4888-8888-888888888888";

const config = {
  coreSales: {
    configured: true,
    baseUrl: "https://core.example.test",
    apiToken: "core-sales-token-0123456789",
    defaultWarehouseId: warehouseId,
    timeoutMs: 5000
  }
};

function requestContext() {
  return {
    requestId: "req_full_catalog",
    auth: { authenticated: true },
    principal: {
      id: "service:npp-a:mcp",
      employeeId,
      permissions: ["mcp.sales-order.read"],
      scopes: [`mcp:warehouse:${warehouseId}`]
    }
  };
}

function jsonResponse(status, data) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return data; }
  };
}

function variantId(index) {
  return `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
}

function skuOption(index) {
  return {
    id: variantId(index),
    productId,
    productName: `Sản phẩm ${index + 1}`,
    sku: `SKU-${String(index + 1).padStart(3, "0")}`,
    variantName: `Quy cách ${index + 1}`,
    unitId,
    unitCode: "CAI",
    conversionToBase: "1",
    allowsFractional: false,
    defaultTaxMode: "EXCLUSIVE",
    defaultTaxRate: "0"
  };
}

test("complete MCP catalog follows Core pagination until the final SKU page", async () => {
  const searchCalls = [];
  let pricingCalls = 0;
  const result = await handleCoreSalesApi(
    { method: "GET" },
    new URL("http://mcp.local/api/core-sales/products/search?catalog=all&q=tra"),
    requestContext(),
    config,
    {
      fetchImpl: async (url, init) => {
        const parsed = new URL(url);
        if (parsed.pathname === "/api/sales-orders/sku-search") {
          const offset = Number(parsed.searchParams.get("offset") || 0);
          searchCalls.push({
            search: parsed.searchParams.get("search"),
            limit: parsed.searchParams.get("limit"),
            offset: parsed.searchParams.get("offset")
          });
          const data = offset === 0
            ? Array.from({ length: 50 }, (_, index) => skuOption(index))
            : Array.from({ length: 3 }, (_, index) => skuOption(50 + index));
          return jsonResponse(200, { data });
        }
        if (parsed.pathname === "/api/pricing/resolve") {
          pricingCalls += 1;
          const body = JSON.parse(init.body);
          return jsonResponse(200, {
            data: {
              variantId: body.variantId,
              currencyCode: "VND",
              priceAt: body.priceAt,
              baseUnitPriceMinor: "1000",
              finalUnitPriceMinor: "1000"
            }
          });
        }
        throw new Error(`unexpected_url:${url}`);
      }
    }
  );

  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.data.length, 53);
  assert.deepEqual(searchCalls, [
    { search: "tra", limit: "50", offset: "0" },
    { search: "tra", limit: "50", offset: "50" }
  ]);
  assert.equal(pricingCalls, 53);
  assert.equal(new Set(result.payload.data.map((item) => item.variantId)).size, 53);
});

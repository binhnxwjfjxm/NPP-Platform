import test from "node:test";
import assert from "node:assert/strict";
import { handleCoreSalesApi } from "./core-sales-api.js";

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
    requestId: "req_business_catalog",
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

function productId(index) {
  return `11111111-1111-4111-8111-${String(index + 1).padStart(12, "0")}`;
}

function skuOption(index, categoryName, parentCategoryName = null) {
  return {
    id: variantId(index),
    productId: productId(index),
    productCode: `SP-${index + 1}`,
    productName: `Sản phẩm ${index + 1}`,
    categoryCode: `CAT-${index + 1}`,
    categoryName,
    parentCategoryCode: parentCategoryName ? `ROOT-${index + 1}` : null,
    parentCategoryName,
    brandCode: "HP",
    brandName: "Hưng Phát",
    sku: `SKU-${index + 1}`,
    variantName: "Lẻ",
    unitId,
    unitCode: "CAI",
    conversionToBase: "1",
    allowsFractional: false,
    defaultTaxMode: "EXCLUSIVE",
    defaultTaxRate: "0"
  };
}

function fetchImplFactory(pricingCalls) {
  const items = [
    skuOption(0, "Sữa đặc", "Nguyên liệu trà sữa"),
    skuOption(1, "Nguyên liệu mì cay"),
    skuOption(2, "Thực phẩm đông lạnh"),
    skuOption(3, "Bánh tráng"),
    skuOption(4, "Bao bì")
  ];
  return async (url, init) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/api/sales-orders/sku-search") return jsonResponse(200, { data: items });
    if (parsed.pathname === "/api/pricing/resolve") {
      pricingCalls.push(JSON.parse(init.body).variantId);
      return jsonResponse(200, {
        data: {
          variantId: JSON.parse(init.body).variantId,
          currencyCode: "VND",
          priceAt: new Date().toISOString(),
          baseUnitPriceMinor: "1000",
          finalUnitPriceMinor: "1000"
        }
      });
    }
    throw new Error(`unexpected_url:${url}`);
  };
}

test("MCP catalog maps canonical Công Ty categories to the five business groups", async () => {
  const pricingCalls = [];
  const result = await handleCoreSalesApi(
    { method: "GET" },
    new URL("http://mcp.local/api/core-sales/products/search?catalog=all"),
    requestContext(),
    config,
    { fetchImpl: fetchImplFactory(pricingCalls) }
  );

  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.payload.data.map((item) => item.category), [
    "Trà sữa",
    "Mì Cay",
    "Đông Lạnh",
    "Ăn Vặt",
    "Bao Bì"
  ]);
  assert.ok(result.payload.data.every((item) => item.brand === "Hưng Phát"));
  assert.equal(pricingCalls.length, 5);
});

test("MCP catalog category filter runs before price resolution and keeps only the selected group", async () => {
  const pricingCalls = [];
  const result = await handleCoreSalesApi(
    { method: "GET" },
    new URL("http://mcp.local/api/core-sales/products/search?catalog=all&category=%C4%90%C3%B4ng%20L%E1%BA%A1nh"),
    requestContext(),
    config,
    { fetchImpl: fetchImplFactory(pricingCalls) }
  );

  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.data.length, 1);
  assert.equal(result.payload.data[0].category, "Đông Lạnh");
  assert.equal(pricingCalls.length, 1);
});

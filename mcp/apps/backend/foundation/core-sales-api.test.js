import test from "node:test";
import assert from "node:assert/strict";
import { handleCoreSalesApi } from "./core-sales-api.js";

const productId = "11111111-1111-4111-8111-111111111111";
const config = {
  coreSales: {
    configured: true,
    baseUrl: "https://core.example.test",
    apiToken: "core-sales-token-0123456789",
    defaultWarehouseId: "22222222-2222-4222-8222-222222222222",
    timeoutMs: 5000
  }
};
const context = { requestId: "req_core_sales_api" };

function jsonResponse(status, data) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return data; }
  };
}

test("product variant route reads the exact NPP product and rechecks Sales eligibility", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url === `https://core.example.test/api/products/${productId}/variants`) {
      return jsonResponse(200, { data: [
        { id: "variant-a", product_id: productId, sku: "SKU-A", name: "A", is_active: true, is_sellable: true, unit_id: "unit-a", conversion_to_base: "1" },
        { id: "variant-b", product_id: productId, sku: "SKU-B", name: "B", is_active: false, is_sellable: true, unit_id: "unit-b", conversion_to_base: "1" },
        { id: "variant-c", product_id: productId, sku: "SKU-C", name: "C", is_active: true, is_sellable: true, unit_id: "unit-c", conversion_to_base: "1" }
      ] });
    }
    const parsed = new URL(url);
    if (parsed.pathname === "/api/sales-orders/sku-search" && parsed.searchParams.get("search") === "SKU-A") {
      return jsonResponse(200, { data: [{
        id: "variant-a", productId, productName: "Sản phẩm A", sku: "SKU-A", variantName: "A",
        unitId: "unit-a", unitCode: "CAI", conversionToBase: "1", allowsFractional: false,
        defaultTaxMode: "EXCLUSIVE", defaultTaxRate: "0"
      }] });
    }
    if (parsed.pathname === "/api/sales-orders/sku-search" && parsed.searchParams.get("search") === "SKU-C") {
      return jsonResponse(200, { data: [{
        id: "variant-c", productId: "33333333-3333-4333-8333-333333333333", productName: "Sản phẩm khác",
        sku: "SKU-C", variantName: "C", unitId: "unit-c", unitCode: "CAI", conversionToBase: "1",
        allowsFractional: false, defaultTaxMode: "EXCLUSIVE", defaultTaxRate: "0"
      }] });
    }
    throw new Error(`unexpected_url:${url}`);
  };

  const result = await handleCoreSalesApi(
    { method: "GET" },
    new URL(`http://mcp.local/api/products/${productId}/variants`),
    context,
    config,
    { fetchImpl }
  );

  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.data.length, 1);
  assert.equal(result.payload.data[0].variantId, "variant-a");
  assert.equal(result.payload.data[0].catalogSource, "NPP_CORE");
  assert.equal(calls.includes(`https://core.example.test/api/products/${productId}/variants`), true);
  assert.equal(calls.some((url) => url.includes("search=SKU-B")), false, "inactive variants must not be rechecked");
  assert.equal(calls.some((url) => url.includes("search=SKU-A")), true);
  assert.equal(calls.some((url) => url.includes("search=SKU-C")), true);
});

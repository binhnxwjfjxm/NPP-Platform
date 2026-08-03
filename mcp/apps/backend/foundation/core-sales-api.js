import { listCoreProductVariants, searchCoreSalesSkus } from "./core-sales-client.js";
import {
  getSalesOrderProjection,
  submitSalesOrder,
  syncSalesOrder
} from "./sales-order-sync.js";

const MAX_JSON_BODY_BYTES = 256 * 1024;

function response(data, statusCode = 200) {
  return { statusCode, payload: { data, receivedAt: new Date().toISOString() } };
}

function boundedLimit(value) {
  const parsed = Number(value || 50);
  if (!Number.isFinite(parsed)) return 50;
  return Math.max(1, Math.min(Math.trunc(parsed), 50));
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_JSON_BODY_BYTES) {
      const error = new Error("request_body_too_large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    const error = new Error("invalid_json_body");
    error.statusCode = 400;
    throw error;
  }
}

function mapSkuOption(item) {
  return Object.freeze({
    productId: item.productId,
    variantId: item.id,
    name: item.productName,
    brand: null,
    category: null,
    rawCategory: null,
    sku: item.sku,
    variantName: item.variantName,
    sizeLabel: null,
    sellUnit: item.unitCode,
    packUnit: null,
    packQuantity: null,
    price: null,
    coreUnitId: item.unitId,
    conversionToBase: item.conversionToBase,
    allowsFractional: item.allowsFractional,
    taxMode: item.defaultTaxMode,
    taxRate: item.defaultTaxRate,
    catalogSource: "NPP_CORE"
  });
}

function variantCanBeChecked(variant) {
  return variant?.is_active === true
    && variant?.is_sellable === true
    && Boolean(variant?.unit_id)
    && Number.isFinite(Number(variant?.conversion_to_base))
    && Number(variant.conversion_to_base) > 0
    && Boolean(String(variant?.sku || "").trim());
}

function variantMatchesSearch(variant, search) {
  const term = String(search || "").trim().toLocaleLowerCase("vi");
  if (!term) return true;
  return [variant?.sku, variant?.name, variant?.unit_code, variant?.unit_name]
    .some((value) => String(value || "").toLocaleLowerCase("vi").includes(term));
}

async function searchProducts(url, context, config, fetchImpl) {
  const options = await searchCoreSalesSkus(
    url.searchParams.get("q") || url.searchParams.get("search") || "",
    context,
    config,
    {
      fetchImpl,
      limit: boundedLimit(url.searchParams.get("limit")),
      offset: Math.max(0, Number(url.searchParams.get("offset")) || 0)
    }
  );
  return response(options.map(mapSkuOption));
}

async function loadProductVariants(productId, url, context, config, fetchImpl) {
  const search = url.searchParams.get("q") || "";
  const candidates = (await listCoreProductVariants(productId, context, config, { fetchImpl }))
    .filter(variantCanBeChecked)
    .filter((variant) => variantMatchesSearch(variant, search));
  const verified = await Promise.all(candidates.map(async (variant) => {
    const options = await searchCoreSalesSkus(variant.sku, context, config, {
      fetchImpl,
      limit: 10,
      offset: 0
    });
    return options.find((item) => item.id === variant.id && item.productId === productId) || null;
  }));
  return response(verified.filter(Boolean).map(mapSkuOption));
}

async function loadSalesOrder(url, context, config, fetchImpl) {
  return response(await getSalesOrderProjection({
    sessionCustomerId: url.searchParams.get("sessionCustomerId") || url.searchParams.get("session_customer_id"),
    orderId: url.searchParams.get("orderId") || url.searchParams.get("order_id")
  }, context, config, { fetchImpl }));
}

async function saveSalesOrderSubmission(req, context, config, fetchImpl) {
  const body = await readJsonBody(req);
  return response(await submitSalesOrder(body, context, config, { fetchImpl }));
}

async function saveSalesOrderSync(req, context, config, fetchImpl) {
  const body = await readJsonBody(req);
  return response(await syncSalesOrder(body, context, config, { fetchImpl }));
}

export async function handleCoreSalesApi(req, url, context, config, { fetchImpl = fetch } = {}) {
  const method = String(req.method || "GET").toUpperCase();
  const pathname = url.pathname;

  if (method === "GET" && pathname === "/api/products/search") {
    return searchProducts(url, context, config, fetchImpl);
  }

  const variantsMatch = pathname.match(/^\/api\/products\/([^/]+)\/variants$/);
  if (method === "GET" && variantsMatch) {
    return loadProductVariants(decodeURIComponent(variantsMatch[1]), url, context, config, fetchImpl);
  }

  if (method === "GET" && pathname === "/api/mcp-day/session-customer/sales-order") {
    return loadSalesOrder(url, context, config, fetchImpl);
  }
  if (method === "POST" && pathname === "/api/mcp-day/session-customer/sales-order/submit") {
    return saveSalesOrderSubmission(req, context, config, fetchImpl);
  }
  if (method === "POST" && pathname === "/api/mcp-day/session-customer/sales-order/sync") {
    return saveSalesOrderSync(req, context, config, fetchImpl);
  }

  return null;
}

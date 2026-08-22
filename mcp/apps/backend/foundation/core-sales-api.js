import { authorizeCommand } from "./authorization.js";
import { listCoreProductVariants, resolveCoreBasePrice, searchCoreSalesSkus } from "./core-sales-client.js";
import {
  createDirectMcpSalesOrder,
  listDirectMcpSalesOrders
} from "./direct-sales-orders.js";

const MAX_JSON_BODY_BYTES = 256 * 1024;
const MAX_VERIFIED_VARIANTS = 50;
const VARIANT_CHECK_CONCURRENCY = 5;
const CATALOG_PRICE_CONCURRENCY = 4;
const CATALOG_PAGE_SIZE = 50;
const MAX_CATALOG_PAGES = 200;
const CORE_SALES_READ_PERMISSION = "mcp.sales-order.read";
const CORE_SALES_CREATE_PERMISSION = "mcp.sales-order.create";

const BUSINESS_CATALOG_GROUPS = Object.freeze([
  Object.freeze({
    label: "Trà sữa",
    terms: Object.freeze([
      "tra sua", "nguyen lieu tra sua", "pha che", "tra", "sua", "siro", "syrup", "bot",
      "topping", "duong", "sinh to", "trai cay", "mut", "milk foam", "milkfoam", "kem", "phu gia"
    ])
  }),
  Object.freeze({ label: "Mì Cay", terms: Object.freeze(["mi cay", "my cay", "nguyen lieu mi cay", "nguyen lieu my cay"]) }),
  Object.freeze({ label: "Đông Lạnh", terms: Object.freeze(["dong lanh", "thuc pham dong lanh"]) }),
  Object.freeze({ label: "Ăn Vặt", terms: Object.freeze(["an vat", "banh trang", "snack", "do an vat", "do an", "do le"]) }),
  Object.freeze({
    label: "Bao Bì",
    terms: Object.freeze(["bao bi", "bao ly", "ong hut", "muong", "nap", "ly nhua", "ly giay", "dung cu"])
  })
]);
const BUSINESS_CATALOG_MATCH_ORDER = Object.freeze(["Mì Cay", "Đông Lạnh", "Ăn Vặt", "Bao Bì", "Trà sữa"]);

function response(data, statusCode = 200) {
  return { statusCode, payload: { data, receivedAt: new Date().toISOString() } };
}

function boundedLimit(value) {
  const parsed = Number(value || 50);
  if (!Number.isFinite(parsed)) return 50;
  return Math.max(1, Math.min(Math.trunc(parsed), 50));
}

function warehouseScope(config) {
  return `mcp:warehouse:${config.coreSales.defaultWarehouseId}`;
}

function authorizeCoreSales(context, config, permission) {
  return authorizeCommand(context, { permission, scope: warehouseScope(config) });
}

function normalizeCatalogText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function categoryIdentity(item) {
  return [
    item?.parentCategoryName,
    item?.categoryName,
    item?.parentCategoryCode,
    item?.categoryCode
  ].map(normalizeCatalogText).filter(Boolean);
}

function matchesCatalogTerm(value, term) {
  return value === term || value.startsWith(`${term} `) || value.endsWith(` ${term}`) || value.includes(` ${term} `);
}

function catalogBusinessGroup(item) {
  const identities = categoryIdentity(item);
  const exactGroup = BUSINESS_CATALOG_GROUPS.find((group) => identities.includes(normalizeCatalogText(group.label)));
  if (exactGroup) return exactGroup.label;

  for (const label of BUSINESS_CATALOG_MATCH_ORDER) {
    const group = BUSINESS_CATALOG_GROUPS.find((candidate) => candidate.label === label);
    if (group && identities.some((identity) => group.terms.some((term) => matchesCatalogTerm(identity, term)))) return group.label;
  }
  return null;
}

function catalogBrand(item) {
  return String(item?.brandName || item?.brandCode || "").trim() || null;
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

function mapSkuOption(item, price) {
  const category = catalogBusinessGroup(item);
  return Object.freeze({
    productId: item.productId,
    variantId: item.id,
    name: item.productName,
    brand: catalogBrand(item),
    category,
    rawCategory: item.categoryName || item.parentCategoryName || null,
    categoryCode: item.categoryCode || null,
    parentCategoryCode: item.parentCategoryCode || null,
    parentCategoryName: item.parentCategoryName || null,
    sku: item.sku,
    variantName: item.variantName,
    sizeLabel: null,
    sellUnit: item.unitCode,
    packUnit: null,
    packQuantity: null,
    price,
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

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

async function mapCatalogOptions(options, context, config, fetchImpl) {
  const priceAt = new Date().toISOString();
  return mapWithConcurrency(options, CATALOG_PRICE_CONCURRENCY, async (item) => {
    try {
      const resolved = await resolveCoreBasePrice(item.id, context, config, { fetchImpl, priceAt });
      return mapSkuOption(item, resolved.amount);
    } catch (error) {
      if (error?.code === "BASE_PRICE_NOT_FOUND") return mapSkuOption(item, null);
      throw error;
    }
  });
}

async function loadCompleteCatalog(search, context, config, fetchImpl) {
  const unique = new Map();
  let offset = 0;
  for (let page = 0; page < MAX_CATALOG_PAGES; page += 1) {
    const batch = await searchCoreSalesSkus(search, context, config, {
      fetchImpl,
      limit: CATALOG_PAGE_SIZE,
      offset
    });
    for (const item of batch) {
      const key = String(item?.id || "").trim() || `${item?.productId || ""}:${item?.sku || ""}`;
      if (!unique.has(key)) unique.set(key, item);
    }
    if (batch.length < CATALOG_PAGE_SIZE) return [...unique.values()];
    offset += batch.length;
  }
  const error = new Error("core_sales_catalog_pagination_exceeded");
  error.code = "core_sales_catalog_pagination_exceeded";
  error.statusCode = 502;
  error.publicMessage = "Danh mục sản phẩm Công Ty quá lớn để tải đầy đủ.";
  error.publicRetryable = false;
  throw error;
}

function filterCatalogOptions(options, url) {
  const requestedCategory = normalizeCatalogText(url.searchParams.get("category"));
  const requestedBrand = normalizeCatalogText(url.searchParams.get("brand"));
  return options.filter((item) => {
    if (requestedCategory && normalizeCatalogText(catalogBusinessGroup(item)) !== requestedCategory) return false;
    if (requestedBrand && normalizeCatalogText(catalogBrand(item)) !== requestedBrand) return false;
    return true;
  });
}

async function searchProducts(url, context, config, fetchImpl) {
  authorizeCoreSales(context, config, CORE_SALES_READ_PERMISSION);
  const search = url.searchParams.get("q") || url.searchParams.get("search") || "";
  const options = url.searchParams.get("catalog") === "all"
    ? await loadCompleteCatalog(search, context, config, fetchImpl)
    : await searchCoreSalesSkus(
      search,
      context,
      config,
      {
        fetchImpl,
        limit: boundedLimit(url.searchParams.get("limit")),
        offset: Math.max(0, Number(url.searchParams.get("offset")) || 0)
      }
    );
  return response(await mapCatalogOptions(filterCatalogOptions(options, url), context, config, fetchImpl));
}

async function loadProductVariants(productId, url, context, config, fetchImpl) {
  authorizeCoreSales(context, config, CORE_SALES_READ_PERMISSION);
  const search = url.searchParams.get("q") || "";
  const candidates = (await listCoreProductVariants(productId, context, config, { fetchImpl }))
    .filter(variantCanBeChecked)
    .filter((variant) => variantMatchesSearch(variant, search))
    .slice(0, MAX_VERIFIED_VARIANTS);
  const verified = await mapWithConcurrency(candidates, VARIANT_CHECK_CONCURRENCY, async (variant) => {
    const options = await searchCoreSalesSkus(variant.sku, context, config, { fetchImpl, limit: 10, offset: 0 });
    return options.find((item) => item.id === variant.id && item.productId === productId) || null;
  });
  return response(await mapCatalogOptions(verified.filter(Boolean), context, config, fetchImpl));
}

async function loadDirectOrders(context, config, fetchImpl) {
  authorizeCoreSales(context, config, CORE_SALES_READ_PERMISSION);
  return response(await listDirectMcpSalesOrders(context, config, { fetchImpl }));
}

async function saveDirectOrder(req, context, config, fetchImpl) {
  authorizeCoreSales(context, config, CORE_SALES_CREATE_PERMISSION);
  const body = await readJsonBody(req);
  return response(await createDirectMcpSalesOrder(body, context, config, {
    fetchImpl,
    idempotencyKey: context.idempotencyKey
  }), 201);
}

export async function handleCoreSalesApi(req, url, context, config, { fetchImpl = fetch } = {}) {
  const method = String(req.method || "GET").toUpperCase();
  const pathname = url.pathname;

  if (method === "GET" && pathname === "/api/core-sales/products/search") {
    return searchProducts(url, context, config, fetchImpl);
  }

  const variantsMatch = pathname.match(/^\/api\/core-sales\/products\/([^/]+)\/variants$/);
  if (method === "GET" && variantsMatch) {
    return loadProductVariants(decodeURIComponent(variantsMatch[1]), url, context, config, fetchImpl);
  }

  if (pathname === "/api/core-sales/orders" && method === "GET") {
    return loadDirectOrders(context, config, fetchImpl);
  }
  if (pathname === "/api/core-sales/orders" && method === "POST") {
    return saveDirectOrder(req, context, config, fetchImpl);
  }

  return null;
}

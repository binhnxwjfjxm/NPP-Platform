import { providerPersistence } from "./provider-runtime.js";

function text(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function boundedLimit(value) {
  const parsed = Number(value || 50);
  if (!Number.isFinite(parsed)) return 50;
  return Math.max(1, Math.min(Math.trunc(parsed), 100));
}

function response(data, statusCode = 200) {
  return { statusCode, payload: { data, receivedAt: new Date().toISOString() } };
}

function productItem(row) {
  return {
    productId: row.product_id,
    variantId: row.variant_id,
    name: row.product_name,
    brand: row.brand_name || null,
    category: row.category || null,
    rawCategory: row.category || null,
    sku: row.sku || null,
    variantName: row.variant_name || null,
    sizeLabel: row.size_label || null,
    sellUnit: row.sell_unit || null,
    packUnit: row.pack_unit || null,
    packQuantity: row.pack_quantity == null ? null : Number(row.pack_quantity),
    price: 0
  };
}

async function withClient(work) {
  const persistence = providerPersistence();
  await persistence.assertReady();
  return persistence.withTransaction(work);
}

async function searchProducts(url) {
  const query = text(url.searchParams.get("q")) || "";
  const category = text(url.searchParams.get("category")) || "";
  const brand = text(url.searchParams.get("brand")) || "";
  const limit = boundedLimit(url.searchParams.get("limit"));
  const rows = await withClient(async (client) => {
    const result = await client.query(
      `SELECT
         product.id AS product_id,
         variant.id AS variant_id,
         product.name AS product_name,
         product.brand_name,
         product.category,
         variant.sku,
         variant.variant_name,
         variant.size_label,
         variant.sell_unit,
         variant.pack_unit,
         variant.pack_quantity
       FROM mcp.products product
       JOIN mcp.product_variants variant
         ON variant.product_id = product.id
        AND variant.active IS TRUE
       WHERE product.active IS TRUE
         AND ($1 = '' OR product.name ILIKE '%' || $1 || '%'
              OR product.product_code ILIKE '%' || $1 || '%'
              OR variant.sku ILIKE '%' || $1 || '%'
              OR variant.variant_name ILIKE '%' || $1 || '%')
         AND ($2 = '' OR product.category = $2)
         AND ($3 = '' OR product.brand_name = $3 OR product.brand_code = $3)
       ORDER BY product.name, variant.variant_name, variant.sku, variant.id
       LIMIT $4`,
      [query, category, brand, limit]
    );
    return result.rows || [];
  });
  return response(rows.map(productItem));
}

async function loadVariants(productId) {
  const rows = await withClient(async (client) => {
    const result = await client.query(
      `SELECT
         product.id AS product_id,
         variant.id AS variant_id,
         product.name AS product_name,
         product.brand_name,
         product.category,
         variant.sku,
         variant.variant_name,
         variant.size_label,
         variant.sell_unit,
         variant.pack_unit,
         variant.pack_quantity
       FROM mcp.products product
       JOIN mcp.product_variants variant
         ON variant.product_id = product.id
       WHERE product.id = $1
         AND product.active IS TRUE
         AND variant.active IS TRUE
       ORDER BY variant.variant_name, variant.sku, variant.id`,
      [productId]
    );
    return result.rows || [];
  });
  return response(rows.map(productItem));
}

async function sessionStatus(url, context) {
  const routeId = text(url.searchParams.get("routeId") || url.searchParams.get("route_id"));
  if (!routeId) {
    const error = new Error("route_id_required");
    error.code = "route_id_required";
    error.statusCode = 400;
    throw error;
  }
  const rows = await withClient(async (client) => {
    const result = await client.query(
      `SELECT id, route_id, route_name, session_date, status
       FROM mcp.mcp_route_sessions
       WHERE installation_id = $1 AND route_id = $2 AND status = 'active'
       ORDER BY session_date DESC, created_at DESC`,
      [context.installation.id, routeId]
    );
    return result.rows || [];
  });
  return response({
    sessions: rows.map((row) => ({
      id: row.id,
      routeId: row.route_id,
      routeName: row.route_name,
      sessionDate: row.session_date,
      status: row.status
    }))
  });
}

export async function handlePostgresqlCompatibilityApi(req, url, context) {
  const method = String(req.method || "GET").toUpperCase();
  const pathname = url.pathname;
  if (method !== "GET") return null;
  if (pathname === "/api/products/search") return searchProducts(url);
  if (pathname === "/api/mcp-settings/session-status") return sessionStatus(url, context);
  const variantMatch = pathname.match(/^\/api\/products\/([^/]+)\/variants$/);
  if (variantMatch) {
    let productId = null;
    try {
      productId = decodeURIComponent(variantMatch[1]).trim();
    } catch {
      const error = new Error("invalid_product_id");
      error.code = "invalid_product_id";
      error.statusCode = 400;
      throw error;
    }
    if (!productId) {
      const error = new Error("product_id_required");
      error.code = "product_id_required";
      error.statusCode = 400;
      throw error;
    }
    return loadVariants(productId);
  }
  return null;
}

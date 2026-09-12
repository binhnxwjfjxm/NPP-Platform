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

function numberValue(value, fallback = 0) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function dateOnly(value) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

function timeOnly(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toISOString().slice(11, 16);
}

function response(data, statusCode = 200) {
  return { statusCode, payload: { data, receivedAt: new Date().toISOString() } };
}

function badRequest(code) {
  const error = new Error(code);
  error.code = code;
  error.statusCode = 400;
  return error;
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
  if (!routeId) throw badRequest("route_id_required");
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

function emptyMcpDayData(routeId, sessionDate) {
  return {
    sessionOpened: false,
    run: {
      id: "no-session",
      routeId: routeId || undefined,
      routeName: "Chưa mở phiên",
      date: sessionDate || "-",
      owner: "-",
      status: "cancelled",
      openedAt: "-"
    },
    kpis: [
      { label: "Trong phiên", value: 0, hint: "Chưa mở phiên" },
      { label: "Đã ghé", value: 0, hint: "Có kết quả" },
      { label: "Chờ xử lý", value: 0, hint: "Chưa ghé" },
      { label: "Phát sinh", value: 0, hint: "Thêm trong ngày" }
    ],
    lines: [],
    results: []
  };
}

async function mcpDayData(url, context) {
  const routeId = text(url.searchParams.get("routeId") || url.searchParams.get("route_id"));
  const sessionDate = dateOnly(
    url.searchParams.get("date") ||
      url.searchParams.get("sessionDate") ||
      url.searchParams.get("session_date")
  );
  if (!routeId || !sessionDate) throw badRequest("route_id_and_date_required");

  const data = await withClient(async (client) => {
    const sessionResult = await client.query(
      `SELECT id, route_id, route_name, session_date, sales, area, status, created_at
       FROM mcp.mcp_route_sessions
       WHERE installation_id = $1 AND route_id = $2 AND session_date = $3
       ORDER BY created_at DESC
       LIMIT 1`,
      [context.installation.id, routeId, sessionDate]
    );
    const session = sessionResult.rows?.[0] || null;
    if (!session) return emptyMcpDayData(routeId, sessionDate);

    const [snapshotResult, visitResult] = await Promise.all([
      client.query(
        `SELECT id, session_id, route_id, route_customer_id, customer_id, customer_name, phone, area, address,
                sort_order, source, planned_status, visit_status, status_reason, visit_id, order_id, test_id,
                report_id, followup_count, note, checkin_lat, checkin_lng, checkin_accuracy, checkin_at,
                checkin_source, created_at, updated_at
         FROM mcp.mcp_session_customers
         WHERE installation_id = $1 AND session_id = $2
         ORDER BY sort_order ASC, created_at ASC`,
        [context.installation.id, session.id]
      ),
      client.query(
        `SELECT id, session_id, route_id, route_customer_id, visit_date, status, has_order, has_test,
                has_report, order_id, test_id, report_id, checkin_at, note, created_at
         FROM mcp.mcp_visits
         WHERE installation_id = $1 AND session_id = $2
         ORDER BY checkin_at ASC NULLS LAST, created_at ASC`,
        [context.installation.id, session.id]
      )
    ]);

    const snapshots = snapshotResult.rows || [];
    const visits = visitResult.rows || [];
    const visitById = new Map();
    const visitByRouteCustomer = new Map();
    for (const visit of visits) {
      if (visit.id) visitById.set(visit.id, visit);
      if (visit.route_customer_id && !visitByRouteCustomer.has(visit.route_customer_id)) {
        visitByRouteCustomer.set(visit.route_customer_id, visit);
      }
    }

    const snapshotByVisitId = new Map();
    const snapshotByRouteCustomerId = new Map();
    const lines = snapshots.map((snapshot) => {
      const visit = visitById.get(snapshot.visit_id) || visitByRouteCustomer.get(snapshot.route_customer_id);
      const status = snapshot.visit_status || (visit ? "visited" : "pending");
      const orderId = snapshot.order_id || visit?.order_id || null;
      const testId = snapshot.test_id || visit?.test_id || null;
      const reportId = snapshot.report_id || visit?.report_id || null;
      const followupCount = numberValue(snapshot.followup_count);
      if (visit?.id) snapshotByVisitId.set(visit.id, snapshot);
      if (snapshot.route_customer_id) snapshotByRouteCustomerId.set(snapshot.route_customer_id, snapshot);
      return {
        id: snapshot.id,
        sessionCustomerId: snapshot.id,
        routeCustomerId: snapshot.route_customer_id,
        sortOrder: numberValue(snapshot.sort_order),
        accountName: snapshot.customer_name || "Khách chưa tên",
        phone: snapshot.phone || undefined,
        address: snapshot.address || undefined,
        area: snapshot.area || "-",
        source: snapshot.source === "added" ? "added" : "planned",
        status,
        statusReason: snapshot.status_reason || undefined,
        note: snapshot.note || snapshot.address || "Từ snapshot ngày",
        result: visit?.note || snapshot.status_reason || undefined,
        orderId: orderId || undefined,
        testId: testId || undefined,
        reportId: reportId || undefined,
        hasOrder: Boolean(visit?.has_order || orderId),
        hasTest: Boolean(visit?.has_test || testId),
        hasReport: Boolean(visit?.has_report || reportId),
        followupCount,
        visitId: visit?.id || snapshot.visit_id || undefined,
        checkedIn: Boolean(snapshot.checkin_at),
        checkinAt: snapshot.checkin_at || undefined,
        checkinLat: snapshot.checkin_lat == null ? undefined : numberValue(snapshot.checkin_lat),
        checkinLng: snapshot.checkin_lng == null ? undefined : numberValue(snapshot.checkin_lng),
        checkinAccuracy: snapshot.checkin_accuracy == null ? undefined : numberValue(snapshot.checkin_accuracy),
        checkinSource: snapshot.checkin_source || undefined
      };
    });

    const results = visits.map((visit) => {
      const snapshot = snapshotByVisitId.get(visit.id) || snapshotByRouteCustomerId.get(visit.route_customer_id);
      const orderId = snapshot?.order_id || visit.order_id || null;
      const testId = snapshot?.test_id || visit.test_id || null;
      const reportId = snapshot?.report_id || visit.report_id || null;
      const hasOrder = Boolean(visit.has_order || orderId);
      const hasTest = Boolean(visit.has_test || testId);
      const hasReport = Boolean(visit.has_report || reportId);
      const followupCount = numberValue(snapshot?.followup_count);
      return {
        id: visit.id,
        lineId: snapshot?.id || visit.route_customer_id || visit.id,
        sessionCustomerId: snapshot?.id,
        routeCustomerId: visit.route_customer_id,
        accountName: snapshot?.customer_name || "Điểm bán",
        startTime: timeOnly(visit.checkin_at || visit.created_at),
        endTime: timeOnly(visit.checkin_at || visit.created_at),
        result: visit.note || visit.status || "Đã ghé",
        orderId: orderId || undefined,
        testId: testId || undefined,
        reportId: reportId || undefined,
        hasOrder,
        hasTest,
        hasReport,
        followupCount,
        nextAction: hasOrder && hasTest && hasReport && followupCount > 0 ? "Đã đủ nghiệp vụ" : "Tiếp tục xử lý"
      };
    });

    const visited = lines.filter((line) => line.status === "visited").length;
    const pending = lines.filter((line) => line.status === "pending").length;
    const added = lines.filter((line) => line.source === "added").length;
    return {
      sessionOpened: true,
      run: {
        id: session.id,
        routeId: session.route_id,
        routeName: session.route_name || "Tuyến MCP",
        date: dateOnly(session.session_date),
        owner: session.sales || "Sale",
        status: session.status === "cancelled" ? "cancelled" : "opened",
        openedAt: timeOnly(session.created_at)
      },
      kpis: [
        { label: "Trong phiên", value: lines.length, hint: "Snapshot ngày" },
        { label: "Đã ghé", value: visited, hint: "Có kết quả" },
        { label: "Chờ xử lý", value: pending, hint: "Chưa ghé" },
        { label: "Phát sinh", value: added, hint: "Thêm trong ngày" }
      ],
      lines,
      results
    };
  });

  return response(data);
}

export async function handlePostgresqlCompatibilityApi(req, url, context) {
  const method = String(req.method || "GET").toUpperCase();
  const pathname = url.pathname;
  if (method !== "GET") return null;
  if (pathname === "/api/products/search") return searchProducts(url);
  if (pathname === "/api/mcp-settings/session-status") return sessionStatus(url, context);
  if (pathname === "/api/mcp-day/data") return mcpDayData(url, context);
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
    if (!productId) throw badRequest("product_id_required");
    return loadVariants(productId);
  }
  return null;
}

import { requirePermission } from "./authorization.js";
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

function employeeScope(context) {
  if (context?.principal?.type !== "user") return null;
  const employeeId = text(context?.principal?.employeeId);
  if (!employeeId) {
    const error = new Error("employee_identity_required");
    error.code = "employee_identity_required";
    error.statusCode = 403;
    throw error;
  }
  return employeeId;
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
  const ownerEmployeeId = employeeScope(context);
  const rows = await withClient(async (client) => {
    const result = await client.query(
      `SELECT id, route_id, route_name, session_date, status
       FROM mcp.mcp_route_sessions
       WHERE installation_id = $1 AND route_id = $2 AND status = 'active'
         AND ($3::uuid IS NULL OR owner_employee_id = $3::uuid)
       ORDER BY session_date DESC, created_at DESC`,
      [context.installation.id, routeId, ownerEmployeeId]
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

function normalizedSessionStatus(value) {
  const status = String(value ?? "").trim().toLowerCase();
  if (status === "completed" || status === "closed") return "done";
  if (status === "done" || status === "cancelled") return status;
  return status || "active";
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

  const ownerEmployeeId = employeeScope(context);
  const data = await withClient(async (client) => {
    const sessionResult = await client.query(
      `SELECT id, route_id, route_name, session_date, sales, area, status, created_at
       FROM mcp.mcp_route_sessions
       WHERE installation_id = $1 AND route_id = $2 AND session_date = $3
         AND ($4::uuid IS NULL OR owner_employee_id = $4::uuid)
       ORDER BY created_at DESC
       LIMIT 1`,
      [context.installation.id, routeId, sessionDate, ownerEmployeeId]
    );
    const session = sessionResult.rows?.[0] || null;
    if (!session) return emptyMcpDayData(routeId, sessionDate);

    const [snapshotResult, visitResult] = await Promise.all([
      client.query(
        `SELECT id, session_id, route_id, route_customer_id, customer_id, customer_name, account_name,
                phone, area, address, sort_order, source, status, visit_status, status_reason,
                order_id, test_id, report_id, followup_count, checked_in, note,
                checkin_lat, checkin_lng, checkin_accuracy, checkin_at, checkin_source,
                created_at, updated_at
         FROM mcp.mcp_session_customers
         WHERE installation_id = $1 AND session_id = $2
         ORDER BY sort_order ASC, created_at ASC`,
        [context.installation.id, session.id]
      ),
      client.query(
        `SELECT id, session_id, session_customer_id, route_id, route_customer_id, customer_id,
                customer_name, visit_date, status, checkin_at, checkout_at, note, created_at
         FROM mcp.mcp_visits
         WHERE installation_id = $1 AND session_id = $2
         ORDER BY checkin_at ASC NULLS LAST, created_at ASC`,
        [context.installation.id, session.id]
      )
    ]);

    const snapshots = snapshotResult.rows || [];
    const visits = visitResult.rows || [];
    const visitBySessionCustomer = new Map();
    const visitByRouteCustomer = new Map();
    for (const visit of visits) {
      if (visit.session_customer_id) visitBySessionCustomer.set(visit.session_customer_id, visit);
      if (visit.route_customer_id) visitByRouteCustomer.set(visit.route_customer_id, visit);
    }

    const snapshotById = new Map();
    const snapshotByRouteCustomerId = new Map();
    const lines = snapshots.map((snapshot) => {
      const visit = visitBySessionCustomer.get(snapshot.id) || visitByRouteCustomer.get(snapshot.route_customer_id);
      const status = snapshot.visit_status || snapshot.status || (visit ? "visited" : "pending");
      const orderId = snapshot.order_id || null;
      const testId = snapshot.test_id || null;
      const reportId = snapshot.report_id || null;
      const followupCount = numberValue(snapshot.followup_count);
      snapshotById.set(snapshot.id, snapshot);
      if (snapshot.route_customer_id) snapshotByRouteCustomerId.set(snapshot.route_customer_id, snapshot);
      return {
        id: snapshot.id,
        sessionCustomerId: snapshot.id,
        routeCustomerId: snapshot.route_customer_id,
        sortOrder: numberValue(snapshot.sort_order),
        accountName: snapshot.account_name || snapshot.customer_name || "Khách chưa tên",
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
        hasOrder: Boolean(orderId),
        hasTest: Boolean(testId),
        hasReport: Boolean(reportId),
        followupCount,
        visitId: visit?.id || undefined,
        checkedIn: Boolean(snapshot.checked_in || snapshot.checkin_at || visit?.checkin_at),
        checkinAt: snapshot.checkin_at || visit?.checkin_at || undefined,
        checkinLat: snapshot.checkin_lat == null ? undefined : numberValue(snapshot.checkin_lat),
        checkinLng: snapshot.checkin_lng == null ? undefined : numberValue(snapshot.checkin_lng),
        checkinAccuracy: snapshot.checkin_accuracy == null ? undefined : numberValue(snapshot.checkin_accuracy),
        checkinSource: snapshot.checkin_source || undefined
      };
    });

    const results = visits.map((visit) => {
      const snapshot = snapshotById.get(visit.session_customer_id) || snapshotByRouteCustomerId.get(visit.route_customer_id);
      const orderId = snapshot?.order_id || null;
      const testId = snapshot?.test_id || null;
      const reportId = snapshot?.report_id || null;
      const hasOrder = Boolean(orderId);
      const hasTest = Boolean(testId);
      const hasReport = Boolean(reportId);
      const followupCount = numberValue(snapshot?.followup_count);
      return {
        id: visit.id,
        lineId: snapshot?.id || visit.session_customer_id || visit.route_customer_id || visit.id,
        sessionCustomerId: snapshot?.id || visit.session_customer_id || undefined,
        routeCustomerId: visit.route_customer_id,
        accountName: snapshot?.account_name || snapshot?.customer_name || visit.customer_name || "Điểm bán",
        startTime: timeOnly(visit.checkin_at || visit.created_at),
        endTime: timeOnly(visit.checkout_at || visit.checkin_at || visit.created_at),
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
        status: normalizedSessionStatus(session.status),
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


function normalizeFieldCheckStatus(value) {
  const status = String(value ?? "").trim().toLowerCase();
  if (status === "ok") return "opportunity";
  if (status === "retry") return "risk";
  if (status === "opportunity" || status === "risk" || status === "normal") return status;
  return "normal";
}

async function testOptions(context) {
  const installationId = text(context?.installation?.id);
  if (!installationId) throw badRequest("installation_context_required");
  const ownerEmployeeId = employeeScope(context);

  const data = await withClient(async (client) => {
    const [filesResult, productsResult] = await Promise.all([
      client.query(
        `SELECT id, title, test_date, status, created_at
         FROM mcp.test_files
         WHERE installation_id = $1
           AND COALESCE(status, '') <> 'deleted'
           AND ($2::text IS NULL OR COALESCE(raw_payload->'foundation_context'->>'employeeId', '') = $2::text)
         ORDER BY test_date DESC, created_at DESC
         LIMIT 50`,
        [installationId, ownerEmployeeId]
      ),
      client.query(
        `SELECT id, file_id, product_name, sort_order, created_at
         FROM mcp.test_file_products product
         WHERE product.installation_id = $1
           AND ($2::text IS NULL OR EXISTS (
             SELECT 1
               FROM mcp.test_files file
              WHERE file.installation_id = product.installation_id
                AND file.id = product.file_id
                AND COALESCE(file.raw_payload->'foundation_context'->>'employeeId', '') = $2::text
           ))
         ORDER BY sort_order ASC, created_at ASC, id ASC
         LIMIT 1000`,
        [installationId, ownerEmployeeId]
      )
    ]);
    return {
      files: filesResult.rows || [],
      products: productsResult.rows || []
    };
  });

  const productsByFile = new Map();
  for (const product of data.products) {
    if (!productsByFile.has(product.file_id)) productsByFile.set(product.file_id, []);
    productsByFile.get(product.file_id).push({
      id: product.id,
      productName: product.product_name || "Sản phẩm thử"
    });
  }

  return response({
    files: data.files.map((file) => ({
      id: file.id,
      title: file.title || file.id,
      testDate: dateOnly(file.test_date || file.created_at),
      products: productsByFile.get(file.id) || []
    }))
  });
}

async function marketChecks(url, context) {
  const installationId = text(context?.installation?.id);
  if (!installationId) throw badRequest("installation_context_required");
  const status = text(url.searchParams.get("status"));
  const search = (text(url.searchParams.get("search")) || "").toLowerCase();
  const ownerEmployeeId = employeeScope(context);

  const rows = await withClient(async (client) => {
    const result = await client.query(
      `SELECT
         result.id,
         result.product_name,
         result.status,
         result.note,
         result.updated_at,
         result.created_at,
         customer.customer_name,
         customer.area,
         customer.note AS customer_note
       FROM mcp.test_customer_results result
       LEFT JOIN mcp.test_customers customer
         ON customer.installation_id = result.installation_id
        AND customer.id = result.customer_id
       JOIN mcp.test_files file
         ON file.installation_id = result.installation_id
        AND file.id = result.file_id
       WHERE result.installation_id = $1
         AND ($2::text IS NULL OR COALESCE(file.raw_payload->'foundation_context'->>'employeeId', '') = $2::text)
       ORDER BY result.updated_at DESC, result.created_at DESC
       LIMIT 300`,
      [installationId, ownerEmployeeId]
    );
    return result.rows || [];
  });

  const checks = rows.map((row) => ({
    id: row.id,
    date: dateOnly(row.updated_at || row.created_at),
    routeName: row.area || "Thử sản phẩm",
    accountName: row.customer_name || "Khách thử",
    productName: row.product_name || "Sản phẩm thử",
    competitorName: row.status || "-",
    shelfPrice: 0,
    stockStatus: row.status || "pending",
    note: row.note || row.customer_note || "",
    status: normalizeFieldCheckStatus(row.status)
  })).filter((check) => {
    if (status && check.status !== status) return false;
    if (!search) return true;
    return `${check.accountName} ${check.routeName} ${check.productName} ${check.competitorName} ${check.note}`
      .toLowerCase()
      .includes(search);
  });

  const opportunities = checks.filter((check) => check.status === "opportunity").length;
  const risks = checks.filter((check) => check.status === "risk").length;
  const skuCount = new Set(checks.map((check) => check.productName)).size;
  return response({
    kpis: [
      { label: "Điểm đã kiểm", value: checks.length, hint: "Dữ liệu hiện tại" },
      { label: "Cơ hội", value: opportunities, hint: "Kết quả tích cực" },
      { label: "Rủi ro", value: risks, hint: "Cần theo dõi" },
      { label: "SKU", value: skuCount, hint: "Sản phẩm ghi nhận" }
    ],
    checks
  });
}

function reportSettingStatus(active) {
  return active === false ? "inactive" : "active";
}

function reportSettingValue(row) {
  const value = row?.value;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return text(row?.setting_name) || "";
}

function reportSettingItem(row) {
  const meta = row?.raw_payload && typeof row.raw_payload === "object" && !Array.isArray(row.raw_payload)
    ? row.raw_payload
    : {};
  return {
    id: row.id,
    key: row.setting_key,
    label: row.setting_name,
    value: reportSettingValue(row),
    category: text(meta.category) || "",
    brandName: text(meta.brand_name) || "",
    productId: text(meta.product_id) || "",
    status: reportSettingStatus(row.active),
    sortOrder: numberValue(row.sort_order),
    meta
  };
}

function reportSettingGroup(row, items) {
  const meta = row?.raw_payload && typeof row.raw_payload === "object" && !Array.isArray(row.raw_payload)
    ? row.raw_payload
    : {};
  return {
    id: row.id,
    key: row.group_key,
    title: row.group_name,
    type: text(meta.group_type) || "market_report",
    description: text(row.description) || "",
    status: reportSettingStatus(row.active),
    sortOrder: numberValue(row.sort_order),
    meta,
    items: items.filter((item) => item.group_id === row.id).map(reportSettingItem)
  };
}

async function reportSettings(url, context) {
  requirePermission(context, "mcp.report-setting.write");
  const installationId = text(context?.installation?.id);
  if (!installationId) {
    const error = new Error("installation_context_required");
    error.code = "installation_context_required";
    error.statusCode = 500;
    throw error;
  }
  const groupType = text(url.searchParams.get("groupType")) || "market_report";
  const includeInactive = url.searchParams.get("includeInactive") === "1";

  const data = await withClient(async (client) => {
    const groupsResult = await client.query(
      `SELECT *
       FROM mcp.mcp_report_setting_groups
       WHERE installation_id = $1
         AND COALESCE(NULLIF(raw_payload->>'group_type', ''), 'market_report') = $2
         AND ($3::boolean OR active IS TRUE)
       ORDER BY sort_order, group_name, id`,
      [installationId, groupType, includeInactive]
    );
    const groups = groupsResult.rows || [];
    const groupIds = groups.map((group) => group.id);
    if (!groupIds.length) return { groups, items: [] };

    const itemsResult = await client.query(
      `SELECT *
       FROM mcp.mcp_report_settings
       WHERE installation_id = $1
         AND group_id = ANY($2::text[])
         AND ($3::boolean OR active IS TRUE)
       ORDER BY sort_order, setting_name, id`,
      [installationId, groupIds, includeInactive]
    );
    return { groups, items: itemsResult.rows || [] };
  });

  return response({
    groups: data.groups.map((group) => reportSettingGroup(group, data.items))
  });
}

export async function handlePostgresqlCompatibilityApi(req, url, context) {
  const method = String(req.method || "GET").toUpperCase();
  const pathname = url.pathname;
  if (method !== "GET") return null;
  if (pathname === "/api/products/search") return searchProducts(url);
  if (pathname === "/api/mcp-settings/session-status") return sessionStatus(url, context);
  if (pathname === "/api/mcp-day/data") return mcpDayData(url, context);
  if (pathname === "/api/mcp-day/test-options") return testOptions(context);
  if (pathname === "/api/market-checks/data") return marketChecks(url, context);
  if (pathname === "/api/mcp-report-settings") return reportSettings(url, context);
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

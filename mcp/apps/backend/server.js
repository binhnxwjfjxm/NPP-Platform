import http from "node:http";
import { randomUUID } from "node:crypto";
import { loadEnvFile } from "node:process";

try {
  loadEnvFile(".env");
} catch {}

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 3001);
const SERVICE = "mcp-plan-backend";
const SUPABASE_URL = process.env.SUPABASE_URL?.trim();
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const MCP_SESSION_CUSTOMER_STATUSES = new Set(["pending", "visited", "skipped", "cancelled"]);

function json(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": process.env.CORS_ORIGINS || "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept"
  });
  res.end(body);
}

function wrap(data) {
  return { data, receivedAt: new Date().toISOString() };
}

function hasSupabaseConfig() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

function assertSupabaseConfig() {
  if (!hasSupabaseConfig()) {
    const error = new Error("missing_supabase_config");
    error.statusCode = 503;
    throw error;
  }
}

function supabaseHeaders(extra = {}) {
  assertSupabaseConfig();
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    Accept: "application/json",
    ...extra
  };
}

function buildSupabaseUrl(table, params = {}) {
  assertSupabaseConfig();
  const url = new URL(`/rest/v1/${table}`, SUPABASE_URL);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  });
  return url;
}

async function supabaseGet(table, params = {}, options = {}) {
  const response = await fetch(buildSupabaseUrl(table, params), { headers: supabaseHeaders(options.headers) });
  if (!response.ok) {
    const error = new Error("supabase_read_failed");
    error.statusCode = 502;
    error.detail = await response.text();
    error.table = table;
    throw error;
  }
  return response.json();
}

async function supabaseInsert(table, rows, params = {}) {
  const payload = Array.isArray(rows) ? rows : [rows];
  if (payload.length === 0) return [];
  const response = await fetch(buildSupabaseUrl(table, params), {
    method: "POST",
    headers: supabaseHeaders({ "Content-Type": "application/json", Prefer: "return=representation" }),
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const error = new Error("supabase_insert_failed");
    error.statusCode = 502;
    error.detail = await response.text();
    error.table = table;
    throw error;
  }
  return response.json();
}

async function supabasePatch(table, values, params = {}) {
  const response = await fetch(buildSupabaseUrl(table, params), {
    method: "PATCH",
    headers: supabaseHeaders({ "Content-Type": "application/json", Prefer: "return=representation" }),
    body: JSON.stringify(values)
  });
  if (!response.ok) {
    const error = new Error("supabase_update_failed");
    error.statusCode = 502;
    error.detail = await response.text();
    error.table = table;
    throw error;
  }
  return response.json();
}

async function supabaseRpc(functionName, args = {}) {
  assertSupabaseConfig();
  const response = await fetch(new URL(`/rest/v1/rpc/${functionName}`, SUPABASE_URL), {
    method: "POST",
    headers: supabaseHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(args)
  });

  const text = await response.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
  }

  if (!response.ok) {
    const error = new Error(payload?.message || payload?.error || "supabase_rpc_failed");
    error.statusCode = response.status || 502;
    error.detail = payload?.details || payload?.hint || payload?.raw || text;
    throw error;
  }

  return payload;
}

function mcpSessionIdFromPath(url) {
  const prefix = "/api/mcp-sessions/";
  if (!url.pathname.startsWith(prefix)) return null;
  const encoded = url.pathname.slice(prefix.length);
  if (!encoded || encoded.includes("/")) return null;
  try {
    return decodeURIComponent(encoded).trim() || null;
  } catch {
    throw badRequest("invalid_session_id");
  }
}

function normalizeSessionMutationError(error) {
  const message = String(error?.message || "");
  if (message.includes("session_not_found")) error.statusCode = 404;
  if (message.includes("session_has_activity") || message.includes("session_closed")) error.statusCode = 409;
  return error;
}

async function updateMcpRouteSession(sessionId, body) {
  const rawDate = String(body.sessionDate || body.session_date || "").trim();
  const sessionDate = rawDate ? rawDate.slice(0, 10) : null;
  if (sessionDate && !/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) throw badRequest("invalid_session_date");

  try {
    return await supabaseRpc("mcp_update_route_session", {
      p_session_id: sessionId,
      p_session_date: sessionDate,
      p_status: String(body.status || "").trim() || null,
      p_note: body.note === undefined ? null : String(body.note || "").trim() || null
    });
  } catch (error) {
    throw normalizeSessionMutationError(error);
  }
}

async function deleteMcpRouteSession(sessionId) {
  try {
    const data = await supabaseRpc("mcp_delete_empty_route_session", {
      p_session_id: sessionId
    });
    if (!data || data.deleted !== true) {
      const error = new Error("session_delete_not_applied");
      error.statusCode = 500;
      throw error;
    }
    return data;
  } catch (error) {
    throw normalizeSessionMutationError(error);
  }
}

function v1Object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function v1Text(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function v1NumberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function v1PathId(pathname, prefix, suffix = "") {
  if (!pathname.startsWith(prefix) || (suffix && !pathname.endsWith(suffix))) return null;
  const end = suffix ? pathname.length - suffix.length : pathname.length;
  const encoded = pathname.slice(prefix.length, end);
  if (!encoded || encoded.includes("/")) return null;
  try {
    return decodeURIComponent(encoded).trim() || null;
  } catch {
    throw badRequest("invalid_path_id");
  }
}

function mcpV1ErrorStatus(error) {
  const message = String(error?.message || "");
  if (message.includes("not_found") || message.includes("no_data_found")) return 404;
  if (
    message.includes("closed") ||
    message.includes("has_activity") ||
    message.includes("read_only") ||
    message.includes("duplicate key") ||
    message.includes("already exists")
  ) return 409;
  if (
    message.includes("required") ||
    message.includes("invalid_") ||
    message.includes("inactive") ||
    message.includes("not_resolved")
  ) return 400;
  return Number(error?.statusCode || 500);
}

async function openMcpDaySessionV1(body) {
  const routeId = v1Text(body.routeId || body.route_id);
  const sessionDate = String(body.sessionDate || body.session_date || body.date || todayDateOnly()).slice(0, 10);
  const owner = v1Text(body.owner || body.sales || body.salesOwner || body.sales_owner);
  if (!routeId) throw badRequest("route_id_required");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) throw badRequest("invalid_session_date");
  return supabaseRpc("mcp_open_route_session", {
    p_route_id: routeId,
    p_session_date: sessionDate,
    p_owner: owner
  });
}

async function updateMcpSessionCustomerStatusV1(body) {
  const sessionCustomerId = v1Text(body.sessionCustomerId || body.session_customer_id || body.id);
  const visitStatus = String(body.visitStatus || body.visit_status || body.status || "visited").trim().toLowerCase();
  if (!sessionCustomerId) throw badRequest("session_customer_id_required");
  if (!["pending", "visited", "skipped", "cancelled"].includes(visitStatus)) throw badRequest("invalid_visit_status");
  return supabaseRpc("mcp_set_session_customer_status", {
    p_session_customer_id: sessionCustomerId,
    p_visit_status: visitStatus,
    p_status_reason: v1Text(body.statusReason || body.status_reason || body.reason),
    p_note: v1Text(body.note)
  });
}

function normalizeMcpOrderItemsV1(items) {
  if (!Array.isArray(items) || items.length === 0) throw badRequest("order_items_required");
  return items.map((item) => {
    const row = v1Object(item);
    const productName = String(row.productName || row.product_name || "").trim();
    const quantity = Number(row.quantity || 0);
    const unitPrice = Number(row.unitPrice ?? row.unit_price ?? 0);
    const discount = Number(row.discount || 0);
    if (!productName) throw badRequest("product_name_required");
    if (!Number.isFinite(quantity) || quantity <= 0) throw badRequest("quantity_required");
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw badRequest("invalid_unit_price");
    if (!Number.isFinite(discount) || discount < 0) throw badRequest("invalid_discount");
    return {
      productId: v1Text(row.productId || row.product_id),
      variantId: v1Text(row.variantId || row.variant_id),
      productName,
      sku: v1Text(row.sku),
      unit: v1Text(row.unit),
      quantity,
      unitPrice,
      discount,
      note: v1Text(row.note)
    };
  });
}

async function createMcpSessionCustomerOrderV1(body) {
  const sessionCustomerId = v1Text(body.sessionCustomerId || body.session_customer_id || body.id);
  if (!sessionCustomerId) throw badRequest("session_customer_id_required");
  return supabaseRpc("mcp_create_order_from_session_customer", {
    p_session_customer_id: sessionCustomerId,
    p_items: normalizeMcpOrderItemsV1(body.items),
    p_note: v1Text(body.note),
    p_status: v1Text(body.status) || "confirmed"
  });
}

const MCP_TEST_RESULT_STATUSES_V1 = new Set(["pending", "tested", "ok", "interested", "sample", "follow", "bad", "retry"]);

function normalizeMcpTestResultsV1(body) {
  const input = Array.isArray(body.results) ? body.results : Array.isArray(body.items) ? body.items : [];
  if (input.length === 0) throw badRequest("test_results_required");
  return input.map((item) => {
    const row = v1Object(item);
    const productId = v1Text(row.productId || row.product_id);
    const productName = v1Text(row.productName || row.product_name);
    const status = String(row.status || body.testStatus || body.test_status || "tested").trim().toLowerCase();
    if (!productId && !productName) throw badRequest("product_name_required");
    if (!MCP_TEST_RESULT_STATUSES_V1.has(status)) throw badRequest("invalid_test_status");
    return { productId, productName, status, note: v1Text(row.note) };
  });
}

async function createMcpSessionCustomerTestV1(body) {
  const sessionCustomerId = v1Text(body.sessionCustomerId || body.session_customer_id || body.id);
  if (!sessionCustomerId) throw badRequest("session_customer_id_required");
  return supabaseRpc("mcp_create_test_from_session_customer", {
    p_session_customer_id: sessionCustomerId,
    p_file_id: v1Text(body.fileId || body.file_id || body.testFileId || body.test_file_id),
    p_file_title: v1Text(body.fileTitle || body.file_title) || "Test nhanh từ checklist",
    p_results: normalizeMcpTestResultsV1(body),
    p_note: v1Text(body.note),
    p_status: v1Text(body.customerStatus || body.customer_status) || "tested"
  });
}

function normalizeMcpReportSelectionV1(value) {
  return Array.isArray(value)
    ? value.map((item) => {
        const row = v1Object(item);
        return {
          id: String(row.id || row.key || row.value || row.label || "").trim(),
          label: v1Text(row.label),
          value: v1Text(row.value),
          groupTitle: v1Text(row.groupTitle),
          category: v1Text(row.category),
          brandName: v1Text(row.brandName),
          productId: v1Text(row.productId)
        };
      }).filter((item) => item.id)
    : [];
}

function mcpReportSelectionIdsV1(items) {
  return Array.from(new Set(items.map((item) => item.id).filter(Boolean)));
}

function mcpReportFallbackContentV1(fields, competitors, products, context) {
  const parts = [];
  if (competitors.length) parts.push("Đối thủ: " + competitors.map((item) => item.label || item.value || item.id).join(", "));
  if (products.length) parts.push("Sản phẩm đang dùng: " + products.map((item) => item.label || item.value || item.id).join(", "));
  ["priceSummary", "competitorSummary", "displaySummary", "stockSummary", "demandSummary", "opportunitySummary", "riskSummary", "nextAction", "note"].forEach((key) => {
    const value = v1Text(fields[key]);
    if (value) parts.push(value);
  });
  return parts.join("\n") || "Báo cáo thị trường: " + (v1Text(context.customerName || context.customer_name) || "khách trong phiên");
}

async function createMcpSessionCustomerReportV1(body) {
  const sessionCustomerId = v1Text(body.sessionCustomerId || body.session_customer_id || body.id);
  if (!sessionCustomerId) throw badRequest("session_customer_id_required");
  const fields = v1Object(body.fields);
  const selected = v1Object(body.selected);
  const context = v1Object(body.context);
  const competitors = normalizeMcpReportSelectionV1(selected.competitors);
  const usedProducts = normalizeMcpReportSelectionV1(selected.usedProducts);
  const settingItems = normalizeMcpReportSelectionV1(selected.settingItems);
  const allItems = settingItems.length ? settingItems : [...competitors, ...usedProducts];
  const reportType = String(body.reportType || body.report_type || "market_report").trim().toLowerCase();
  const allowed = new Set(["market_report", "price", "competitor", "display", "stock", "demand", "general"]);
  if (!allowed.has(reportType)) throw badRequest("invalid_report_type");
  const content = v1Text(body.content) || mcpReportFallbackContentV1(fields, competitors, usedProducts.length ? usedProducts : allItems, context);
  return supabaseRpc("mcp_create_report_from_session_customer", {
    p_session_customer_id: sessionCustomerId,
    p_report_type: reportType,
    p_content: content,
    p_price_summary: v1Text(fields.priceSummary),
    p_competitor_summary: v1Text(fields.competitorSummary),
    p_display_summary: v1Text(fields.displaySummary),
    p_stock_summary: v1Text(fields.stockSummary),
    p_demand_summary: v1Text(fields.demandSummary),
    p_opportunity_summary: v1Text(fields.opportunitySummary),
    p_risk_summary: v1Text(fields.riskSummary),
    p_next_action: v1Text(fields.nextAction),
    p_note: v1Text(fields.note) || content,
    p_raw_payload: {
      context,
      fields,
      selected: { competitors, usedProducts, settingItems: allItems },
      inputSessionCustomerId: v1Text(body.sessionCustomerId || body.session_customer_id),
      resolvedSessionCustomerId: sessionCustomerId
    },
    p_selected_competitor_ids: mcpReportSelectionIdsV1(competitors),
    p_selected_used_product_ids: mcpReportSelectionIdsV1(usedProducts),
    p_selected_setting_item_ids: mcpReportSelectionIdsV1(allItems)
  });
}

async function createMcpSessionCustomerFollowupV1(body) {
  const sessionCustomerId = v1Text(body.sessionCustomerId || body.session_customer_id || body.id);
  const title = v1Text(body.title || body.followupTitle || body.followup_title);
  const priority = String(body.priority || "medium").trim().toLowerCase();
  if (!sessionCustomerId) throw badRequest("session_customer_id_required");
  if (!title) throw badRequest("followup_title_required");
  if (!["low", "medium", "high", "urgent"].includes(priority)) throw badRequest("invalid_priority");
  return supabaseRpc("mcp_create_followup_from_session_customer", {
    p_session_customer_id: sessionCustomerId,
    p_title: title,
    p_due_date: v1Text(body.dueDate || body.due_date),
    p_priority: priority,
    p_owner: v1Text(body.owner),
    p_note: v1Text(body.note),
    p_followup_type: v1Text(body.followupType || body.followup_type || body.type) || "general"
  });
}

async function createMcpSessionReportSnapshotV1(body) {
  const sessionId = v1Text(body.sessionId || body.session_id);
  if (!sessionId) throw badRequest("session_id_required");
  return supabaseRpc("mcp_create_session_report_snapshot", {
    p_session_id: sessionId,
    p_source: v1Text(body.source) || "manual_snapshot"
  });
}

async function loadMcpReportContextV1(url) {
  const sessionCustomerId = v1Text(
    url.searchParams.get("sessionCustomerId") ||
      url.searchParams.get("session_customer_id")
  );
  if (!sessionCustomerId) throw badRequest("session_customer_id_required");
  return supabaseRpc("mcp_get_report_context", {
    p_session_customer_id: sessionCustomerId
  });
}

function normalizeMcpSettingGroupV1(group, items) {
  return {
    id: group.id,
    key: group.group_key,
    title: group.title,
    type: group.group_type,
    description: group.description || "",
    status: group.status,
    sortOrder: group.sort_order,
    meta: group.raw_payload || {},
    items: items.filter((item) => item.group_id === group.id).map((item) => ({
      id: item.id,
      key: item.item_key,
      label: item.label,
      value: item.value || item.label,
      category: item.category || "",
      brandName: item.brand_name || "",
      productId: item.product_id || "",
      status: item.status,
      sortOrder: item.sort_order,
      meta: item.raw_payload || {}
    }))
  };
}

async function loadMcpReportSettingsV1(url) {
  const groupType = String(url.searchParams.get("groupType") || "market_report").trim();
  const includeInactive = url.searchParams.get("includeInactive") === "1";
  const groupParams = { select: "*", group_type: "eq." + groupType, order: "sort_order.asc,title.asc", limit: 1000 };
  const itemParams = { select: "*", order: "sort_order.asc,label.asc", limit: 5000 };
  if (!includeInactive) {
    groupParams.status = "eq.active";
    itemParams.status = "eq.active";
  }
  const [groups, items] = await Promise.all([
    supabaseGet("mcp_setting_groups", groupParams),
    supabaseGet("mcp_setting_items", itemParams)
  ]);
  const groupIds = new Set(groups.map((group) => group.id));
  const scopedItems = items.filter((item) => groupIds.has(item.group_id));
  return { groups: groups.map((group) => normalizeMcpSettingGroupV1(group, scopedItems)) };
}

async function createMcpRouteV1(body) {
  return supabaseRpc("mcp_create_route", {
    p_route_name: v1Text(body.routeName || body.route_name || body.name),
    p_area: v1Text(body.area),
    p_weekday: body.weekday === undefined || body.weekday === "" ? null : Number(body.weekday),
    p_note: v1Text(body.note),
    p_distributor_id: v1Text(body.distributorId || body.distributor_id)
  });
}

async function updateMcpRouteV1(routeId, body) {
  return supabaseRpc("mcp_update_route", {
    p_route_id: routeId,
    p_route_name: body.routeName === undefined && body.route_name === undefined && body.name === undefined ? null : v1Text(body.routeName || body.route_name || body.name),
    p_area: body.area === undefined ? null : v1Text(body.area),
    p_weekday: body.weekday === undefined || body.weekday === "" ? null : Number(body.weekday),
    p_note: body.note === undefined ? null : v1Text(body.note),
    p_active: body.active === undefined ? null : Boolean(body.active),
    p_distributor_id: body.distributorId === undefined && body.distributor_id === undefined ? null : v1Text(body.distributorId || body.distributor_id)
  });
}

async function createMcpRouteCustomerV1(body) {
  const routeId = v1Text(body.routeId || body.route_id);
  const customerName = v1Text(body.customerName || body.customer_name || body.accountName || body.name);
  if (!routeId) throw badRequest("route_id_required");
  if (!customerName) throw badRequest("customer_name_required");
  const geoLat = v1NumberOrNull(body.geoLat ?? body.geo_lat);
  const geoLng = v1NumberOrNull(body.geoLng ?? body.geo_lng);
  const mapsUrl = v1Text(body.googleMapsUrl || body.google_maps_url) || (geoLat !== null && geoLng !== null ? "https://www.google.com/maps/search/?api=1&query=" + geoLat + "," + geoLng : null);
  return supabaseRpc("mcp_create_route_customer", {
    p_route_id: routeId,
    p_customer_name: customerName,
    p_phone: v1Text(body.phone),
    p_area: v1Text(body.area),
    p_address: v1Text(body.address),
    p_sort_order: Number(body.sortOrder || body.sort_order || 0),
    p_note: v1Text(body.note),
    p_customer_id: v1Text(body.customerId || body.customer_id),
    p_geo_lat: geoLat,
    p_geo_lng: geoLng,
    p_geo_accuracy: v1NumberOrNull(body.geoAccuracy ?? body.geo_accuracy),
    p_geo_source: v1Text(body.geoSource || body.geo_source) || (geoLat !== null && geoLng !== null ? "browser" : null),
    p_google_maps_url: mapsUrl
  });
}

async function updateMcpRouteCustomerV1(routeCustomerId, body) {
  const geoLat = v1NumberOrNull(body.geoLat ?? body.geo_lat);
  const geoLng = v1NumberOrNull(body.geoLng ?? body.geo_lng);
  const mapsUrl = v1Text(body.googleMapsUrl || body.google_maps_url) || (geoLat !== null && geoLng !== null ? "https://www.google.com/maps/search/?api=1&query=" + geoLat + "," + geoLng : null);
  return supabaseRpc("mcp_update_route_customer", {
    p_route_customer_id: routeCustomerId,
    p_customer_name: body.customerName === undefined && body.customer_name === undefined && body.accountName === undefined && body.name === undefined ? null : v1Text(body.customerName || body.customer_name || body.accountName || body.name),
    p_phone: body.phone === undefined ? null : v1Text(body.phone),
    p_area: body.area === undefined ? null : v1Text(body.area),
    p_address: body.address === undefined ? null : v1Text(body.address),
    p_sort_order: body.sortOrder === undefined && body.sort_order === undefined ? null : Number(body.sortOrder || body.sort_order || 0),
    p_note: body.note === undefined ? null : v1Text(body.note),
    p_active: body.active === undefined ? null : Boolean(body.active),
    p_geo_lat: geoLat,
    p_geo_lng: geoLng,
    p_geo_accuracy: v1NumberOrNull(body.geoAccuracy ?? body.geo_accuracy),
    p_geo_source: v1Text(body.geoSource || body.geo_source),
    p_google_maps_url: mapsUrl
  });
}

function normalizeOrderItems(items) {
  if (!Array.isArray(items) || items.length === 0) throw badRequest("order_items_required");

  return items.map((item) => {
    const productName = String(item.productName || item.product_name || "").trim();
    const quantity = Number(item.quantity || 0);
    const unitPrice = Number(item.unitPrice ?? item.unit_price ?? 0);
    const discount = Number(item.discount || 0);

    if (!productName) throw badRequest("product_name_required");
    if (!Number.isFinite(quantity) || quantity <= 0) throw badRequest("quantity_required");
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw badRequest("invalid_unit_price");
    if (!Number.isFinite(discount) || discount < 0) throw badRequest("invalid_discount");

    return {
      productId: String(item.productId || item.product_id || "").trim() || null,
      productName,
      sku: String(item.sku || "").trim() || null,
      unit: String(item.unit || "").trim() || null,
      quantity,
      unitPrice,
      discount,
      note: String(item.note || "").trim() || null
    };
  });
}

async function createMcpSessionCustomerOrder(body) {
  const sessionCustomerId = String(body.sessionCustomerId || body.session_customer_id || body.id || "").trim();
  if (!sessionCustomerId) throw badRequest("session_customer_id_required");

  const items = normalizeOrderItems(body.items);
  const note = String(body.note || "").trim();
  const status = String(body.status || "confirmed").trim() || "confirmed";

  return supabaseRpc("mcp_create_order_from_session_customer", {
    p_session_customer_id: sessionCustomerId,
    p_items: items,
    p_note: note || null,
    p_status: status
  });
}

function normalizeTestResults(results) {
  if (!Array.isArray(results) || results.length === 0) throw badRequest("test_results_required");

  return results.map((item) => {
    const productId = String(item.productId || item.product_id || "").trim();
    const productName = String(item.productName || item.product_name || "").trim();
    const status = String(item.status || "tested").trim() || "tested";
    const note = String(item.note || "").trim();

    if (!productId && !productName) throw badRequest("product_name_required");

    return {
      productId: productId || null,
      productName: productName || null,
      status,
      note: note || null
    };
  });
}

async function loadMcpTestOptions() {
  const [fileRows, productRows] = await Promise.all([
    supabaseGet("test_files", { select: "id,title,test_date,sales,status,note,created_at", order: "test_date.desc,created_at.desc", limit: 50 }),
    supabaseGet("test_file_products", { select: "id,file_id,product_name,sort_order,status", order: "sort_order.asc,created_at.asc", limit: 1000 })
  ]);

  const productsByFile = new Map();
  productRows.forEach((product) => {
    if (product.status === "deleted") return;
    if (!productsByFile.has(product.file_id)) productsByFile.set(product.file_id, []);
    productsByFile.get(product.file_id).push({
      id: product.id,
      productName: product.product_name || "Sáº£n pháº©m test"
    });
  });

  const files = fileRows
    .filter((file) => file.status !== "deleted")
    .map((file) => ({
      id: file.id,
      title: file.title || file.id,
      testDate: dateOnly(file.test_date || file.created_at),
      products: productsByFile.get(file.id) || []
    }));

  return { files };
}

async function createMcpSessionCustomerTest(body) {
  const sessionCustomerId = String(body.sessionCustomerId || body.session_customer_id || body.id || "").trim();
  if (!sessionCustomerId) throw badRequest("session_customer_id_required");

  const results = normalizeTestResults(body.results || body.items);
  const fileId = String(body.fileId || body.file_id || "").trim();
  const fileTitle = String(body.fileTitle || body.file_title || "").trim();
  const note = String(body.note || "").trim();
  const status = String(body.status || "tested").trim() || "tested";

  return supabaseRpc("mcp_create_test_from_session_customer", {
    p_session_customer_id: sessionCustomerId,
    p_file_id: fileId || null,
    p_file_title: fileTitle || null,
    p_results: results,
    p_note: note || null,
    p_status: status
  });
}

function normalizeReportType(value) {
  const reportType = String(value || "general").trim() || "general";
  const allowed = new Set(["price", "competitor", "display", "stock", "demand", "general"]);
  if (!allowed.has(reportType)) throw badRequest("invalid_report_type");
  return reportType;
}

async function createMcpSessionCustomerReport(body) {
  const sessionCustomerId = String(body.sessionCustomerId || body.session_customer_id || body.id || "").trim();
  if (!sessionCustomerId) throw badRequest("session_customer_id_required");

  const reportType = normalizeReportType(body.reportType || body.report_type);
  const content = String(body.content || body.note || "").trim();
  const priceSummary = String(body.priceSummary || body.price_summary || "").trim();
  const competitorSummary = String(body.competitorSummary || body.competitor_summary || "").trim();
  const displaySummary = String(body.displaySummary || body.display_summary || "").trim();
  const stockSummary = String(body.stockSummary || body.stock_summary || "").trim();
  const demandSummary = String(body.demandSummary || body.demand_summary || "").trim();
  const opportunitySummary = String(body.opportunitySummary || body.opportunity_summary || "").trim();
  const riskSummary = String(body.riskSummary || body.risk_summary || "").trim();
  const nextAction = String(body.nextAction || body.next_action || "").trim();

  if (!content && !priceSummary && !competitorSummary && !displaySummary && !stockSummary && !demandSummary && !opportunitySummary && !riskSummary && !nextAction) {
    throw badRequest("report_content_required");
  }

  return supabaseRpc("mcp_create_report_from_session_customer", {
    p_session_customer_id: sessionCustomerId,
    p_report_type: reportType,
    p_content: content || null,
    p_price_summary: priceSummary || null,
    p_competitor_summary: competitorSummary || null,
    p_display_summary: displaySummary || null,
    p_stock_summary: stockSummary || null,
    p_demand_summary: demandSummary || null,
    p_opportunity_summary: opportunitySummary || null,
    p_risk_summary: riskSummary || null,
    p_next_action: nextAction || null,
    p_note: content || null
  });
}

function normalizeFollowupPriority(value) {
  const priority = String(value || "medium").trim().toLowerCase() || "medium";
  const allowed = new Set(["low", "medium", "high", "urgent"]);
  if (!allowed.has(priority)) throw badRequest("invalid_priority");
  return priority;
}

async function createMcpSessionCustomerFollowup(body) {
  const sessionCustomerId = String(body.sessionCustomerId || body.session_customer_id || body.id || "").trim();
  if (!sessionCustomerId) throw badRequest("session_customer_id_required");

  const title = String(body.title || body.followupTitle || body.followup_title || "").trim();
  if (!title) throw badRequest("followup_title_required");

  const dueDate = String(body.dueDate || body.due_date || "").trim();
  const priority = normalizeFollowupPriority(body.priority);
  const owner = String(body.owner || "").trim();
  const note = String(body.note || "").trim();
  const followupType = String(body.followupType || body.followup_type || body.type || "general").trim() || "general";

  return supabaseRpc("mcp_create_followup_from_session_customer", {
    p_session_customer_id: sessionCustomerId,
    p_title: title,
    p_due_date: dueDate || null,
    p_priority: priority,
    p_owner: owner || null,
    p_note: note || null,
    p_followup_type: followupType
  });
}

async function loadMcpOrderTemplateSettings(url) {
  const routes = await loadRoutes();
  const routeId = String(url.searchParams.get("routeId") || routes[0]?.id || "").trim();

  let template = null;
  if (routeId) {
    const templates = await supabaseGet("mcp_route_order_templates", {
      select: "id,route_id,title,note,status,updated_at",
      route_id: `eq.${routeId}`,
      limit: 1
    });

    const row = templates[0] || null;
    if (row) {
      const items = await supabaseGet("mcp_route_order_template_items", {
        select: "id,product_id,product_name,sku,unit,quantity,unit_price,discount,sort_order,note",
        template_id: `eq.${row.id}`,
        order: "sort_order.asc,created_at.asc",
        limit: 200
      });

      template = {
        id: row.id,
        routeId: row.route_id,
        title: row.title || "Mau don hang",
        note: row.note || "",
        items: items.map((item) => ({
          id: item.id,
          productId: item.product_id || "",
          productName: item.product_name || "",
          sku: item.sku || "",
          unit: item.unit || "",
          quantity: String(item.quantity ?? 1),
          unitPrice: String(item.unit_price ?? 0),
          discount: String(item.discount ?? 0),
          sortOrder: item.sort_order || 0,
          note: item.note || ""
        }))
      };
    }
  }

  return {
    routes: routes.map((route) => ({
      id: route.id,
      name: route.name,
      area: route.area,
      salesOwner: route.salesOwner,
      status: route.status
    })),
    selectedRouteId: routeId,
    template
  };
}


function emptyOrderTemplate(routeId) {
  return { routeId, title: "Mẫu đơn hàng", note: "", items: [{ productName: "", quantity: "1", unitPrice: "0", unit: "", note: "" }] };
}

function emptyTestTemplate(routeId) {
  return { routeId, title: "Mẫu test sản phẩm", note: "", items: [{ productName: "", defaultStatus: "tested", note: "" }] };
}

function emptyReportTemplate(routeId) {
  return { routeId, title: "Mẫu báo cáo thị trường", reportType: "price", content: "", priceSummary: "", competitorSummary: "", displaySummary: "", stockSummary: "", demandSummary: "", opportunitySummary: "", riskSummary: "", nextAction: "", note: "" };
}

function emptyFollowupTemplate(routeId, owner = "") {
  return { routeId, title: "Mẫu follow-up", dueDays: "1", priority: "medium", owner, note: "", followupType: "general" };
}

async function loadMcpTemplatesSettings(url) {
  const routes = await loadRoutes();
  const routeId = String(url.searchParams.get("routeId") || routes[0]?.id || "").trim();
  const routeOwner = routes.find((route) => route.id === routeId)?.salesOwner || "";

  let orderTemplate = routeId ? emptyOrderTemplate(routeId) : null;
  let testTemplate = routeId ? emptyTestTemplate(routeId) : null;
  let reportTemplate = routeId ? emptyReportTemplate(routeId) : null;
  let followupTemplate = routeId ? emptyFollowupTemplate(routeId, routeOwner) : null;

  if (routeId) {
    const [orderRows, testRows, reportRows, followupRows] = await Promise.all([
      supabaseGet("mcp_route_order_templates", { select: "id,route_id,title,note,status", route_id: `eq.${routeId}`, limit: 1 }),
      supabaseGet("mcp_route_test_templates", { select: "id,route_id,title,note,status", route_id: `eq.${routeId}`, limit: 1 }),
      supabaseGet("mcp_route_report_templates", { select: "id,route_id,title,report_type,content,price_summary,competitor_summary,display_summary,stock_summary,demand_summary,opportunity_summary,risk_summary,next_action,note,status", route_id: `eq.${routeId}`, limit: 1 }),
      supabaseGet("mcp_route_followup_templates", { select: "id,route_id,title,due_days,priority,owner,note,followup_type,status", route_id: `eq.${routeId}`, limit: 1 })
    ]);

    const order = orderRows[0] || null;
    if (order) {
      const items = await supabaseGet("mcp_route_order_template_items", { select: "id,product_name,unit,quantity,unit_price,note,sort_order", template_id: `eq.${order.id}`, order: "sort_order.asc,created_at.asc", limit: 200 });
      orderTemplate = { routeId, title: order.title || "Mẫu đơn hàng", note: order.note || "", items: items.map((item) => ({ productName: item.product_name || "", quantity: String(item.quantity ?? 1), unitPrice: String(item.unit_price ?? 0), unit: item.unit || "", note: item.note || "" })) };
    }

    const test = testRows[0] || null;
    if (test) {
      const items = await supabaseGet("mcp_route_test_template_items", { select: "id,product_name,default_status,note,sort_order", template_id: `eq.${test.id}`, order: "sort_order.asc,created_at.asc", limit: 200 });
      testTemplate = { routeId, title: test.title || "Mẫu test sản phẩm", note: test.note || "", items: items.map((item) => ({ productName: item.product_name || "", defaultStatus: item.default_status || "tested", note: item.note || "" })) };
    }

    const report = reportRows[0] || null;
    if (report) {
      reportTemplate = { routeId, title: report.title || "Mẫu báo cáo thị trường", reportType: report.report_type || "price", content: report.content || "", priceSummary: report.price_summary || "", competitorSummary: report.competitor_summary || "", displaySummary: report.display_summary || "", stockSummary: report.stock_summary || "", demandSummary: report.demand_summary || "", opportunitySummary: report.opportunity_summary || "", riskSummary: report.risk_summary || "", nextAction: report.next_action || "", note: report.note || "" };
    }

    const followup = followupRows[0] || null;
    if (followup) {
      followupTemplate = { routeId, title: followup.title || "Mẫu follow-up", dueDays: followup.due_days === null || followup.due_days === undefined ? "" : String(followup.due_days), priority: followup.priority || "medium", owner: followup.owner || routeOwner, note: followup.note || "", followupType: followup.followup_type || "general" };
    }
  }

  return { routes: routes.map((route) => ({ id: route.id, name: route.name, area: route.area, salesOwner: route.salesOwner, status: route.status })), selectedRouteId: routeId, orderTemplate, testTemplate, reportTemplate, followupTemplate };
}

function emptySkipReasonTemplate(routeId) {
  return {
    routeId,
    title: "Mẫu lý do bỏ qua/không mua",
    note: "",
    items: [
      { reasonType: "skip", reasonText: "Khách đóng cửa", note: "" },
      { reasonType: "skip", reasonText: "Không gặp người quyết định", note: "" },
      { reasonType: "no_buy", reasonText: "Còn tồn hàng", note: "" },
      { reasonType: "no_buy", reasonText: "Giá chưa phù hợp", note: "" }
    ]
  };
}

async function loadMcpSkipReasonTemplateSettings(url) {
  const routes = await loadRoutes();
  const routeId = String(url.searchParams.get("routeId") || routes[0]?.id || "").trim();
  let template = routeId ? emptySkipReasonTemplate(routeId) : null;

  if (routeId) {
    const rows = await supabaseGet("mcp_route_skip_reason_templates", {
      select: "id,route_id,title,note,status",
      route_id: `eq.${routeId}`,
      limit: 1
    });

    const row = rows[0] || null;
    if (row) {
      const items = await supabaseGet("mcp_route_skip_reason_template_items", {
        select: "id,reason_type,reason_text,sort_order,note",
        template_id: `eq.${row.id}`,
        order: "sort_order.asc,created_at.asc",
        limit: 200
      });

      template = {
        routeId,
        title: row.title || "Mẫu lý do bỏ qua/không mua",
        note: row.note || "",
        items: items.map((item) => ({
          reasonType: item.reason_type || "skip",
          reasonText: item.reason_text || "",
          note: item.note || ""
        }))
      };
    }
  }

  return {
    routes: routes.map((route) => ({
      id: route.id,
      name: route.name,
      area: route.area,
      salesOwner: route.salesOwner,
      status: route.status
    })),
    selectedRouteId: routeId,
    skipReasonTemplate: template
  };
}

function emptyCustomerAddRule(routeId) {
  return {
    routeId,
    addMode: "session_only",
    note: ""
  };
}

async function loadMcpCustomerAddRuleSettings(url) {
  const routes = await loadRoutes();
  const routeId = String(url.searchParams.get("routeId") || routes[0]?.id || "").trim();
  let customerAddRule = routeId ? emptyCustomerAddRule(routeId) : null;

  if (routeId) {
    const rows = await supabaseGet("mcp_route_customer_add_rules", {
      select: "id,route_id,add_mode,note,status",
      route_id: `eq.${routeId}`,
      limit: 1
    });
    const row = rows[0] || null;
    if (row) {
      customerAddRule = {
        routeId,
        addMode: row.add_mode || "session_only",
        note: row.note || ""
      };
    }
  }

  return {
    routes: routes.map((route) => ({
      id: route.id,
      name: route.name,
      area: route.area,
      salesOwner: route.salesOwner,
      status: route.status
    })),
    selectedRouteId: routeId,
    customerAddRule
  };
}

async function loadMcpRouteSessionStatusSettings(url) {
  const routes = await loadRoutes();
  const routeId = String(url.searchParams.get("routeId") || routes[0]?.id || "").trim();
  let sessions = [];

  if (routeId) {
    sessions = await supabaseGet("mcp_route_sessions", {
      select: "id,route_id,route_name,session_date,status,note,planned_customers,visited_customers,created_at,updated_at",
      route_id: `eq.${routeId}`,
      order: "session_date.desc,created_at.desc",
      limit: 30
    });
  }

  return {
    routes: routes.map((route) => ({
      id: route.id,
      name: route.name,
      area: route.area,
      salesOwner: route.salesOwner,
      status: route.status
    })),
    selectedRouteId: routeId,
    sessions: sessions.map((session) => ({
      id: session.id,
      routeId: session.route_id,
      routeName: session.route_name,
      sessionDate: dateOnly(session.session_date),
      status: session.status || "active",
      note: session.note || "",
      plannedCustomers: Number(session.planned_customers || 0),
      visitedCustomers: Number(session.visited_customers || 0)
    }))
  };
}

function randomId(prefix) {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function todayDateOnly() {
  return new Date().toISOString().slice(0, 10);
}

function dateOnly(value) {
  return value ? String(value).slice(0, 10) : "-";
}

function timeOnly(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(11, 16) || "-";
  return date.toISOString().slice(11, 16);
}

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function moneyShort(value) {
  const amount = numberValue(value);
  if (amount >= 1000000) return `${Math.round(amount / 100000) / 10}M`;
  if (amount >= 1000) return `${Math.round(amount / 1000)}K`;
  return amount;
}

function normalizeRouteStatus(route, planned = 0, visited = 0) {
  if (route.active === false) return "paused";
  if (planned > 0 && visited < planned) return "watch";
  return "active";
}

function normalizeOrderStatus(status) {
  if (status === "pending_confirm") return "confirmed";
  if (status === "done") return "delivered";
  if (status === "cancelled") return "cancelled";
  if (status === "draft") return "draft";
  return status || "confirmed";
}

function normalizeTestStatus(status) {
  if (status === "ok") return "opportunity";
  if (status === "retry") return "risk";
  return "normal";
}

function normalizeSessionCustomerStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  if (!MCP_SESSION_CUSTOMER_STATUSES.has(status)) throw badRequest("invalid_visit_status");
  return status;
}

function sessionCustomerStatusNeedsReason(status) {
  return status === "skipped" || status === "cancelled";
}

function getMcpNextAction({ hasOrder, hasTest, hasReport, followupCount }) {
  if (hasOrder) return "Theo đơn";
  if (Number(followupCount || 0) > 0) return "Follow-up";
  if (hasReport) return "Theo báo cáo";
  if (hasTest) return "Theo test";
  return "Chăm sóc";
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw badRequest("invalid_json_body"); }
}

async function supabaseCount(table, params = {}) {
  const response = await fetch(buildSupabaseUrl(table, { select: "id", limit: 1, ...params }), {
    headers: supabaseHeaders({ Prefer: "count=exact" })
  });
  if (!response.ok) {
    const error = new Error("supabase_count_failed");
    error.statusCode = 502;
    error.detail = await response.text();
    error.table = table;
    throw error;
  }
  const total = response.headers.get("content-range")?.split("/")[1];
  return Number(total || 0);
}

function healthPayload() {
  return {
    ok: true,
    project: "MCP-Plan",
    service: SERVICE,
    server: "backend-DO-02",
    time: new Date().toISOString(),
    supabase: hasSupabaseConfig() ? "configured" : "missing_config",
    message: "MCP-Plan backend VPS is ready"
  };
}

async function loadRoutes() {
  const [routeRows, customerRows, sessionRows] = await Promise.all([
    supabaseGet("mcp_routes", { select: "id,route_name,area,active,weekday,note,created_at", order: "created_at.desc", limit: 100 }),
    supabaseGet("mcp_route_customers", { select: "id,route_id,active", limit: 1000 }),
    supabaseGet("mcp_route_sessions", { select: "route_id,session_date,visited_customers,order_count,status", order: "session_date.desc,created_at.desc", limit: 1000 })
  ]);
  const customersByRoute = new Map();
  customerRows.forEach((customer) => {
    if (!customersByRoute.has(customer.route_id)) customersByRoute.set(customer.route_id, []);
    customersByRoute.get(customer.route_id).push(customer);
  });
  const latestSessionByRoute = new Map();
  sessionRows.forEach((session) => {
    if (!latestSessionByRoute.has(session.route_id)) latestSessionByRoute.set(session.route_id, session);
  });
  return routeRows.map((route) => {
    const customers = customersByRoute.get(route.id) || [];
    const plannedCustomers = customers.filter((customer) => customer.active !== false).length;
    const latestSession = latestSessionByRoute.get(route.id);
    const visitedCustomers = numberValue(latestSession?.visited_customers);
    const orderCount = numberValue(latestSession?.order_count);
    return {
      id: route.id,
      name: route.route_name || "Tuyến chưa đặt tên",
      area: route.area || "-",
      salesOwner: route.note?.includes("Khương") ? "Khương Bình" : "Sale",
      plannedCustomers,
      visitedCustomers,
      orderCount,
      lastVisitDate: dateOnly(latestSession?.session_date),
      status: normalizeRouteStatus(route, plannedCustomers, visitedCustomers)
    };
  });
}

async function loadRouteCustomers(routeId) {
  const params = {
    select: "id,route_id,customer_id,customer_name,phone,area,address,sort_order,active,note,geo_lat,geo_lng,geo_accuracy,geo_captured_at,google_maps_url",
    order: "sort_order.asc,created_at.asc",
    limit: 1000
  };
  if (routeId) params.route_id = `eq.${routeId}`;
  const [customerRows, routeRows] = await Promise.all([
    supabaseGet("mcp_route_customers", params),
    supabaseGet("mcp_routes", { select: "id,route_name", limit: 100 })
  ]);
  const routeNames = new Map(routeRows.map((route) => [route.id, route.route_name || route.id]));
  return customerRows.map((customer) => ({
    id: customer.id,
    routeId: customer.route_id,
    routeName: routeNames.get(customer.route_id) || customer.route_id,
    accountId: customer.customer_id || customer.id,
    accountName: customer.customer_name || "Khách chưa tên",
    contactName: customer.phone || "Chưa có SĐT",
    area: customer.area || "-",
    sortOrder: numberValue(customer.sort_order),
    status: customer.active === false ? "hidden" : customer.geo_lat && customer.geo_lng ? "active" : "needs_gps",
    gps: customer.geo_lat && customer.geo_lng ? {
      lat: numberValue(customer.geo_lat),
      lng: numberValue(customer.geo_lng),
      accuracyMeters: numberValue(customer.geo_accuracy),
      updatedAt: dateOnly(customer.geo_captured_at)
    } : undefined,
    note: customer.note || customer.address || ""
  }));
}

async function loadLatestSession() {
  const sessions = await supabaseGet("mcp_route_sessions", {
    select: "id,route_id,route_name,session_date,sales,area,status,planned_customers,visited_customers,order_count,test_count,report_count,created_at",
    order: "session_date.desc,created_at.desc",
    limit: 1
  });
  return sessions[0] || null;
}

async function loadSessionByRouteDate(routeId, sessionDate) {
  if (!routeId && !sessionDate) return loadLatestSession();
  if (!routeId || !sessionDate) throw badRequest("route_id_and_date_required");
  const sessions = await supabaseGet("mcp_route_sessions", {
    select: "id,route_id,route_name,session_date,sales,area,status,planned_customers,visited_customers,order_count,test_count,report_count,created_at",
    route_id: `eq.${routeId}`,
    session_date: `eq.${sessionDate}`,
    limit: 1
  });
  return sessions[0] || null;
}

function emptyMcpDayData(routeId, sessionDate) {
  return {
    sessionOpened: false,
    run: { id: "no-session", routeId: routeId || undefined, routeName: "Chưa mở phiên", date: sessionDate || "-", owner: "-", status: "cancelled", openedAt: "-" },
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

async function loadMcpDayData(url = new URL("http://local/api/mcp-day/data")) {
  const routeId = url.searchParams.get("routeId") || url.searchParams.get("route_id") || "";
  const sessionDate = (url.searchParams.get("date") || url.searchParams.get("sessionDate") || url.searchParams.get("session_date") || "").slice(0, 10);
  const session = await loadSessionByRouteDate(routeId, sessionDate);
  if (!session) return emptyMcpDayData(routeId, sessionDate);

  const [snapshots, visits] = await Promise.all([
    supabaseGet("mcp_session_customers", {
      select: "id,session_id,route_id,route_customer_id,customer_id,customer_name,phone,area,address,sort_order,source,planned_status,visit_status,status_reason,visit_id,order_id,test_id,report_id,followup_count,note,checkin_lat,checkin_lng,checkin_accuracy,checkin_at,checkin_source,created_at,updated_at",
      session_id: `eq.${session.id}`,
      order: "sort_order.asc,created_at.asc",
      limit: 2000
    }),
    supabaseGet("mcp_visits", {
      select: "id,session_id,route_id,route_customer_id,visit_date,status,has_order,has_test,has_report,order_id,test_id,report_id,checkin_at,note,created_at",
      session_id: `eq.${session.id}`,
      order: "checkin_at.asc,created_at.asc",
      limit: 1000
    })
  ]);

  const visitById = new Map();
  const visitByRouteCustomer = new Map();
  visits.forEach((visit) => {
    if (visit.id) visitById.set(visit.id, visit);
    if (visit.route_customer_id && !visitByRouteCustomer.has(visit.route_customer_id)) visitByRouteCustomer.set(visit.route_customer_id, visit);
  });
  const snapshotByVisitId = new Map();
  const snapshotByRouteCustomerId = new Map();
  const lines = snapshots.map((snapshot) => {
    const visit = visitById.get(snapshot.visit_id) || visitByRouteCustomer.get(snapshot.route_customer_id);
    const status = snapshot.visit_status || (visit ? "visited" : "pending");
    const orderId = snapshot.order_id || visit?.order_id || null;
    const testId = snapshot.test_id || visit?.test_id || null;
    const reportId = snapshot.report_id || visit?.report_id || null;
    const hasOrder = Boolean(visit?.has_order || orderId);
    const hasTest = Boolean(visit?.has_test || testId);
    const hasReport = Boolean(visit?.has_report || reportId);
    const followupCount = numberValue(snapshot.followup_count);
    if (visit?.id) snapshotByVisitId.set(visit.id, snapshot);
    if (snapshot.route_customer_id) snapshotByRouteCustomerId.set(snapshot.route_customer_id, snapshot);
    return {
      id: snapshot.id,
      sessionCustomerId: snapshot.id,
      routeCustomerId: snapshot.route_customer_id,
      sortOrder: numberValue(snapshot.sort_order),
      accountName: snapshot.customer_name || "Khách chưa tên",
      area: snapshot.area || "-",
      source: snapshot.source === "added" ? "added" : "planned",
      status,
      statusReason: snapshot.status_reason || undefined,
      note: snapshot.note || snapshot.address || "Từ snapshot ngày",
      result: visit?.note || snapshot.status_reason || undefined,
      orderId: orderId || undefined,
      testId: testId || undefined,
      reportId: reportId || undefined,
      hasOrder,
      hasTest,
      hasReport,
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
    const checkin = visit.checkin_at || visit.created_at;
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
      startTime: timeOnly(checkin),
      endTime: timeOnly(checkin),
      result: visit.note || visit.status || "Đã ghé",
      orderId: orderId || undefined,
      testId: testId || undefined,
      reportId: reportId || undefined,
      hasOrder,
      hasTest,
      hasReport,
      followupCount,
      nextAction: getMcpNextAction({ hasOrder, hasTest, hasReport, followupCount })
    };
  });
  const visited = lines.filter((line) => line.status === "visited").length;
  const pending = lines.filter((line) => line.status === "pending").length;
  const added = lines.filter((line) => line.source === "added").length;
  return {
    sessionOpened: true,
    run: { id: session.id, routeId: session.route_id, routeName: session.route_name || "Tuyến MCP", date: dateOnly(session.session_date), owner: session.sales || "Sale", status: session.status === "cancelled" ? "cancelled" : "opened", openedAt: timeOnly(session.created_at) },
    kpis: [
      { label: "Trong phiên", value: lines.length, hint: "Snapshot ngày" },
      { label: "Đã ghé", value: visited, hint: "Có kết quả" },
      { label: "Chờ xử lý", value: pending, hint: "Chưa ghé" },
      { label: "Phát sinh", value: added, hint: "Thêm trong ngày" }
    ],
    lines,
    results
  };
}

async function loadOrders(url) {
  const status = url.searchParams.get("status");
  const search = url.searchParams.get("search")?.trim().toLowerCase();
  const [orderRows, itemRows] = await Promise.all([
    supabaseGet("orders", { select: "id,order_code,order_date,sales,customer_name,area,source_type,status,grand_total,created_at", order: "order_date.desc,created_at.desc", limit: 500 }),
    supabaseGet("order_items", { select: "order_id,product_name,quantity", limit: 1000 })
  ]);
  const itemsByOrder = new Map();
  itemRows.forEach((item) => {
    if (!itemsByOrder.has(item.order_id)) itemsByOrder.set(item.order_id, []);
    itemsByOrder.get(item.order_id).push(item);
  });
  return orderRows.map((order) => {
    const items = itemsByOrder.get(order.id) || [];
    return { id: order.id, code: order.order_code || order.id, date: dateOnly(order.order_date || order.created_at), accountName: order.customer_name || "Khách chưa tên", routeName: order.area || "-", owner: order.sales || "Sale", source: order.source_type || "order", skuCount: items.length, quantity: items.reduce((sum, item) => sum + numberValue(item.quantity), 0), totalAmount: numberValue(order.grand_total), status: normalizeOrderStatus(order.status) };
  }).filter((order) => {
    if (status && order.status !== status) return false;
    if (!search) return true;
    return `${order.code} ${order.accountName} ${order.routeName} ${order.owner} ${order.source}`.toLowerCase().includes(search);
  });
}

async function loadMarketChecks(url) {
  const status = url.searchParams.get("status");
  const search = url.searchParams.get("search")?.trim().toLowerCase();
  const [results, customers] = await Promise.all([
    supabaseGet("test_customer_results", { select: "id,file_id,customer_id,product_name,status,note,updated_at,created_at", order: "updated_at.desc,created_at.desc", limit: 300 }),
    supabaseGet("test_customers", { select: "id,customer_name,area,status,note", limit: 1000 })
  ]);
  const customersById = new Map(customers.map((customer) => [customer.id, customer]));
  return results.map((result) => {
    const customer = customersById.get(result.customer_id);
    return { id: result.id, date: dateOnly(result.updated_at || result.created_at), routeName: customer?.area || "Test sản phẩm", accountName: customer?.customer_name || "Khách test", productName: result.product_name || "Sản phẩm test", competitorName: result.status || "-", shelfPrice: 0, stockStatus: result.status || "pending", note: result.note || customer?.note || "", status: normalizeTestStatus(result.status) };
  }).filter((check) => {
    if (status && check.status !== status) return false;
    if (!search) return true;
    return `${check.accountName} ${check.routeName} ${check.productName} ${check.competitorName} ${check.note}`.toLowerCase().includes(search);
  });
}

async function loadActions(url) {
  const [orders, checks, mcpData] = await Promise.all([
    loadOrders(new URL("http://local/api/orders")),
    loadMarketChecks(new URL("http://local/api/market-checks")),
    loadMcpDayData(new URL("http://local/api/mcp-day/data"))
  ]);
  const orderActions = orders.filter((order) => order.status !== "delivered" && order.status !== "cancelled").slice(0, 5).map((order) => ({ id: `order-action-${order.id}`, title: `Theo đơn ${order.code}`, accountName: order.accountName, routeName: order.routeName, owner: order.owner, source: "order", priority: "medium", status: "todo", dueDate: order.date, note: `${order.skuCount} SKU · ${order.totalAmount}` }));
  const testActions = checks.filter((check) => check.status !== "normal").slice(0, 5).map((check) => ({ id: `test-action-${check.id}`, title: `Theo test ${check.productName}`, accountName: check.accountName, routeName: check.routeName, owner: "Sale", source: "field_check", priority: check.status === "risk" ? "high" : "medium", status: "todo", dueDate: check.date, note: check.note || check.stockStatus }));
  const mcpActions = mcpData.lines.filter((line) => line.status === "pending").slice(0, 5).map((line) => ({ id: `mcp-action-${line.id}`, title: `Ghé ${line.accountName}`, accountName: line.accountName, routeName: mcpData.run.routeName, owner: mcpData.run.owner, source: "session", priority: "high", status: "todo", dueDate: mcpData.run.date, note: line.note }));
  const status = url.searchParams.get("status");
  const priority = url.searchParams.get("priority");
  const search = url.searchParams.get("search")?.trim().toLowerCase();
  return [...mcpActions, ...orderActions, ...testActions].filter((action) => {
    if (status && action.status !== status) return false;
    if (priority && action.priority !== priority) return false;
    if (!search) return true;
    return `${action.title} ${action.accountName} ${action.routeName} ${action.owner} ${action.source} ${action.note}`.toLowerCase().includes(search);
  });
}

async function getDashboardSummary() {
  const [routeCount, accountCount, visitCount, orders, actions] = await Promise.all([supabaseCount("mcp_routes"), supabaseCount("mcp_route_customers"), supabaseCount("mcp_visits"), loadOrders(new URL("http://local/api/orders")), loadActions(new URL("http://local/api/actions"))]);
  return { routeCount, accountCount, visitCount, orderAmount: orders.reduce((sum, order) => sum + numberValue(order.totalAmount), 0), actionCount: actions.length };
}

async function getDashboardOverview() {
  const [summary, routes, orders, checks, actions] = await Promise.all([getDashboardSummary(), loadRoutes(), loadOrders(new URL("http://local/api/orders")), loadMarketChecks(new URL("http://local/api/market-checks")), loadActions(new URL("http://local/api/actions"))]);
  const routeHealth = routes.slice(0, 5).map((route) => ({ routeName: route.name, area: route.area, planned: route.plannedCustomers, visited: route.visitedCustomers, orders: route.orderCount, status: route.status === "active" ? "good" : route.status === "watch" ? "watch" : "risk" }));
  const visitedRate = summary.accountCount > 0 ? Math.round((summary.visitCount / summary.accountCount) * 100) : 0;
  const orderRate = summary.visitCount > 0 ? Math.round((orders.length / summary.visitCount) * 1000) / 10 : 0;
  return { kpis: [{ label: "Doanh số hôm nay", value: moneyShort(summary.orderAmount), hint: "Supabase live", trend: `${orders.length} đơn` }, { label: "Tuyến active", value: summary.routeCount, hint: "Route master", trend: "Live" }, { label: "Điểm bán", value: summary.accountCount, hint: "Trong tuyến", trend: `${routeHealth.filter((route) => route.status !== "good").length} cần xem` }, { label: "Lượt ghé", value: summary.visitCount, hint: "Đã ghi nhận", trend: `${visitedRate}% phủ tuyến` }], routeHealth, actions: actions.slice(0, 4).map((action) => ({ title: action.title, description: action.note || `${action.accountName} · ${action.routeName}`, priority: action.priority, owner: action.owner })), insights: [{ label: "Tỷ lệ ghé thăm", value: `${visitedRate}%` }, { label: "Tỷ lệ có đơn", value: `${orderRate}%` }, { label: "Kết quả test", value: String(checks.length) }, { label: "Nguồn", value: "Supabase live" }] };
}

async function getRoutesList() {
  const routes = await loadRoutes();
  return routes.map((route) => ({ id: route.id, name: route.name, area: route.area, owner: route.salesOwner, active: route.status !== "paused" }));
}

async function getRoutesData() {
  const routes = await loadRoutes();
  const totalCustomers = routes.reduce((sum, route) => sum + route.plannedCustomers, 0);
  const totalVisited = routes.reduce((sum, route) => sum + route.visitedCustomers, 0);
  const watchRoutes = routes.filter((route) => route.status === "watch").length;
  return { kpis: [{ label: "Tuyến active", value: routes.filter((route) => route.status === "active").length, hint: "Supabase live" }, { label: "Tổng điểm bán", value: totalCustomers, hint: "Route master" }, { label: "Đã ghé", value: `${totalVisited}/${totalCustomers}`, hint: "Theo session" }, { label: "Tuyến cần theo dõi", value: watchRoutes, hint: "Cần xem lại lịch ghé" }], routes };
}

async function getRouteCustomersData(url) {
  const routeId = url.searchParams.get("routeId");
  const customers = await loadRouteCustomers(routeId);
  const withGps = customers.filter((customer) => Boolean(customer.gps)).length;
  const needsGps = customers.filter((customer) => customer.status === "needs_gps").length;
  const hidden = customers.filter((customer) => customer.status === "hidden").length;
  return { kpis: [{ label: "Khách trong tuyến", value: customers.length, hint: routeId || "Tất cả tuyến" }, { label: "Đã có GPS", value: withGps, hint: "Mở được bản đồ" }, { label: "Cần GPS", value: needsGps, hint: "Cần sale cập nhật" }, { label: "Đang ẩn", value: hidden, hint: "Không hard delete" }], customers };
}

async function getCurrentMcpDayRun(url) {
  const data = await loadMcpDayData(url);
  return data.run;
}

async function getMarketChecksData(url) {
  const checks = await loadMarketChecks(url);
  const opportunities = checks.filter((check) => check.status === "opportunity").length;
  const risks = checks.filter((check) => check.status === "risk").length;
  const skuCount = new Set(checks.map((check) => check.productName)).size;
  return { kpis: [{ label: "Điểm đã kiểm", value: checks.length, hint: "Supabase live" }, { label: "Cơ hội", value: opportunities, hint: "Kết quả OK" }, { label: "Rủi ro", value: risks, hint: "Cần thử lại" }, { label: "SKU", value: skuCount, hint: "Sản phẩm ghi nhận" }], checks };
}

async function getActionsData(url) {
  const items = await loadActions(url);
  return { kpis: [{ label: "Việc mở", value: items.filter((item) => item.status !== "done").length, hint: "Cần xử lý" }, { label: "Ưu tiên cao", value: items.filter((item) => item.priority === "high").length, hint: "Làm trước" }, { label: "Đang làm", value: items.filter((item) => item.status === "doing").length, hint: "Có owner" }, { label: "Bị chặn", value: items.filter((item) => item.status === "blocked").length, hint: "Cần gỡ vướng" }], items };
}

async function handlePatch(req, url) {
  const sessionId = mcpSessionIdFromPath(url);
  if (sessionId) return wrap(await updateMcpRouteSession(sessionId, await readJsonBody(req)));

  const routeId = v1PathId(url.pathname, "/api/routes/");
  if (routeId) return wrap(await updateMcpRouteV1(routeId, await readJsonBody(req)));

  const routeCustomerId = v1PathId(url.pathname, "/api/route-customers/");
  if (routeCustomerId) return wrap(await updateMcpRouteCustomerV1(routeCustomerId, await readJsonBody(req)));

  const error = new Error("not_found");
  error.statusCode = 404;
  throw error;
}

async function handleDelete(url) {
  const sessionId = mcpSessionIdFromPath(url);
  if (!sessionId) {
    const error = new Error("not_found");
    error.statusCode = 404;
    throw error;
  }
  return wrap(await deleteMcpRouteSession(sessionId));
}

async function handlePost(req, url) {
  if (url.pathname === "/api/routes") return wrap(await createMcpRouteV1(await readJsonBody(req)));
  const routeArchiveId = v1PathId(url.pathname, "/api/routes/", "/archive");
  if (routeArchiveId) return wrap(await supabaseRpc("mcp_delete_route_hard", { p_route_id: routeArchiveId }));
  if (url.pathname === "/api/route-customers") return wrap(await createMcpRouteCustomerV1(await readJsonBody(req)));
  const routeCustomerArchiveId = v1PathId(url.pathname, "/api/route-customers/", "/archive");
  if (routeCustomerArchiveId) return wrap(await supabaseRpc("mcp_delete_route_customer_hard", { p_route_customer_id: routeCustomerArchiveId }));
  if (url.pathname === "/api/mcp-session-report") return wrap(await createMcpSessionReportSnapshotV1(await readJsonBody(req)));
  if (url.pathname === "/api/mcp-day/open-session") return wrap(await openMcpDaySessionV1(await readJsonBody(req)));
  if (url.pathname === "/api/mcp-day/session-customer/status") return wrap(await updateMcpSessionCustomerStatusV1(await readJsonBody(req)));
  if (url.pathname === "/api/mcp-day/session-customer/order") return wrap(await createMcpSessionCustomerOrderV1(await readJsonBody(req)));
  if (url.pathname === "/api/mcp-day/session-customer/test") return wrap(await createMcpSessionCustomerTestV1(await readJsonBody(req)));
  if (url.pathname === "/api/mcp-day/session-customer/report") return wrap(await createMcpSessionCustomerReportV1(await readJsonBody(req)));
  if (url.pathname === "/api/mcp-day/session-customer/followup") return wrap(await createMcpSessionCustomerFollowupV1(await readJsonBody(req)));
  const error = new Error("not_found");
  error.statusCode = 404;
  throw error;
}

async function handleGet(url) {
  if (url.pathname === "/" || url.pathname === "/health" || url.pathname === "/api/health") return healthPayload();
  if (url.pathname === "/api/mcp-report-settings") return wrap(await loadMcpReportSettingsV1(url));
  if (url.pathname === "/api/mcp-report-context") return wrap(await loadMcpReportContextV1(url));
  if (url.pathname === "/api/dashboard/summary") return wrap(await getDashboardSummary());
  if (url.pathname === "/api/dashboard/overview") return wrap(await getDashboardOverview());
  if (url.pathname === "/api/routes") return wrap(await getRoutesList());
  if (url.pathname === "/api/routes/data") return wrap(await getRoutesData());
  if (url.pathname === "/api/routes/customers/data") return wrap(await getRouteCustomersData(url));
  if (url.pathname === "/api/mcp-day/current") return wrap(await getCurrentMcpDayRun(url));
  if (url.pathname === "/api/mcp-day/data") return wrap(await loadMcpDayData(url));
  if (url.pathname === "/api/mcp-day/test-options") return wrap(await loadMcpTestOptions());
  if (url.pathname === "/api/mcp-settings/order-template") return wrap(await loadMcpOrderTemplateSettings(url));
  if (url.pathname === "/api/mcp-settings/templates") return wrap(await loadMcpTemplatesSettings(url));
  if (url.pathname === "/api/mcp-settings/skip-reason-template") return wrap(await loadMcpSkipReasonTemplateSettings(url));
  if (url.pathname === "/api/mcp-settings/customer-add-rule") return wrap(await loadMcpCustomerAddRuleSettings(url));
  if (url.pathname === "/api/mcp-settings/session-status") return wrap(await loadMcpRouteSessionStatusSettings(url));
  if (url.pathname === "/api/orders") return wrap(await loadOrders(url));
  if (url.pathname === "/api/tests") return wrap(await getMarketChecksData(url));
  if (url.pathname === "/api/market-checks") return wrap((await loadMarketChecks(url)).map((check) => ({ id: check.id, date: check.date, routeName: check.routeName, accountName: check.accountName, productName: check.productName, status: check.status })));
  if (url.pathname === "/api/market-checks/data") return wrap(await getMarketChecksData(url));
  if (url.pathname === "/api/actions") return wrap((await loadActions(url)).map((action) => ({ id: action.id, title: action.title, owner: action.owner, priority: action.priority, status: action.status, dueDate: action.dueDate })));
  if (url.pathname === "/api/actions/data") return wrap(await getActionsData(url));
  const error = new Error("not_found");
  error.statusCode = 404;
  throw error;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || `${HOST}:${PORT}`}`);
  if (req.method === "OPTIONS") {
    json(res, 204, {});
    return;
  }
  const handler = req.method === "GET" ? handleGet(url) : req.method === "POST" ? handlePost(req, url) : req.method === "PATCH" ? handlePatch(req, url) : req.method === "DELETE" ? handleDelete(url) : Promise.reject(Object.assign(new Error("method_not_allowed"), { statusCode: 405 }));
  handler.then((payload) => json(res, 200, payload)).catch((error) => json(res, mcpV1ErrorStatus(error), { ok: false, service: SERVICE, error: error.message || "internal_error", detail: error.detail, table: error.table, path: url.pathname }));
});

server.listen(PORT, HOST, () => {
  console.log(`${SERVICE} listening on http://${HOST}:${PORT}`);
});



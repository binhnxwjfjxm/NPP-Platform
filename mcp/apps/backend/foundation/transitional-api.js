import { supabaseRest, supabaseRpc } from "./supabase-adapter.js";
import { unwrapIdempotentMutationResult } from "./idempotency.js";
import {
  addSessionCustomer,
  recordSessionCustomerResult,
  setSessionCustomerCheckin
} from "./session-customer-mutations.js";
import { addRouteCustomer } from "./route-customer-mutations.js";
import { createSessionReportSnapshot, saveSessionReportAiResult } from "./session-report-mutations.js";
import {
  createReportSettingGroup,
  createReportSettingItem,
  updateReportSettingGroup,
  updateReportSettingItem
} from "./report-setting-mutations.js";
import { updateFieldCheckResult } from "./field-check-mutations.js";
import {
  createSessionCustomerFollowup,
  createSessionCustomerOrder,
  createSessionCustomerReport,
  createSessionCustomerTest
} from "./session-customer-action-mutations.js";
import {
  deleteEmptyRouteSession,
  openRouteSession,
  setSessionCustomerStatus,
  updateRouteSession
} from "./session-lifecycle-mutations.js";
import {
  cleanupOutletMedia,
  deleteOutletMedia,
  deleteRouteAndMedia,
  deleteRouteCustomerAndMedia,
  finalizeOutletMediaUpload,
  prepareOutletMediaUpload
} from "./outlet-media.js";
import { loadOutletCustomerProfile } from "./outlet-media-read.js";

const MAX_JSON_BODY_BYTES = 2 * 1024 * 1024;
const OUTLET_MEDIA_CLEANUP_ACTOR = "service:mcp-plan:outlet-media-cleanup";

function text(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function badRequest(code) {
  const error = new Error(code);
  error.statusCode = 400;
  throw error;
}

function forbidden(code) {
  const error = new Error(code);
  error.code = code;
  error.statusCode = 403;
  throw error;
}

function assertCleanupActor(context) {
  if (
    context.actor.id !== OUTLET_MEDIA_CLEANUP_ACTOR ||
    context.actor.type !== "service" ||
    context.actor.authentication !== "backend-token"
  ) {
    forbidden("outlet_media_cleanup_forbidden");
  }
}

function decodePathId(value, code) {
  try {
    const decoded = decodeURIComponent(value).trim();
    if (!decoded) badRequest(code);
    return decoded;
  } catch {
    badRequest(code);
  }
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
  if (chunks.length === 0) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    badRequest("invalid_json_body");
  }
}

function response(data, statusCode = 200) {
  return { statusCode, payload: { ...data, receivedAt: new Date().toISOString() } };
}

function mutationResponse(value) {
  const { data, meta } = unwrapIdempotentMutationResult(value);
  return response(meta ? { data, meta } : { data });
}

function boundedLimit(value) {
  const parsed = Number(value || 50);
  if (!Number.isFinite(parsed)) return 50;
  return Math.max(1, Math.min(Math.trunc(parsed), 100));
}

async function saveSessionCustomerResult(req, context, config, fetchImpl) {
  const body = await readJsonBody(req);
  return mutationResponse(await recordSessionCustomerResult(body, context, config, { fetchImpl }));
}

async function saveAddedSessionCustomer(req, context, config, fetchImpl) {
  const body = await readJsonBody(req);
  return mutationResponse(await addSessionCustomer(body, context, config, { fetchImpl }));
}

async function saveAddedRouteCustomer(req, context, config, fetchImpl) {
  const body = await readJsonBody(req);
  return mutationResponse(await addRouteCustomer(body, context, config, { fetchImpl }));
}

async function saveSessionCustomerCheckin(req, context, config, fetchImpl) {
  const body = await readJsonBody(req);
  return mutationResponse(await setSessionCustomerCheckin(body, context, config, { fetchImpl }));
}

async function saveSessionCustomerOrder(req, context, config, fetchImpl) {
  const body = await readJsonBody(req);
  return mutationResponse(await createSessionCustomerOrder(body, context, config, { fetchImpl }));
}

async function saveSessionCustomerTest(req, context, config, fetchImpl) {
  const body = await readJsonBody(req);
  return mutationResponse(await createSessionCustomerTest(body, context, config, { fetchImpl }));
}

async function saveSessionCustomerReport(req, context, config, fetchImpl) {
  const body = await readJsonBody(req);
  return mutationResponse(await createSessionCustomerReport(body, context, config, { fetchImpl }));
}

async function saveSessionCustomerFollowup(req, context, config, fetchImpl) {
  const body = await readJsonBody(req);
  return mutationResponse(await createSessionCustomerFollowup(body, context, config, { fetchImpl }));
}

async function saveOpenRouteSession(req, context, config, fetchImpl) {
  const body = await readJsonBody(req);
  return mutationResponse(await openRouteSession(body, context, config, { fetchImpl }));
}

async function saveSessionCustomerStatus(req, context, config, fetchImpl) {
  const body = await readJsonBody(req);
  return mutationResponse(await setSessionCustomerStatus(body, context, config, { fetchImpl }));
}

async function saveRouteSessionUpdate(req, sessionId, context, config, fetchImpl) {
  const body = await readJsonBody(req);
  return mutationResponse(await updateRouteSession(sessionId, body, context, config, { fetchImpl }));
}

async function removeEmptyRouteSession(sessionId, context, config, fetchImpl) {
  return mutationResponse(await deleteEmptyRouteSession(sessionId, context, config, { fetchImpl }));
}

async function saveSessionReportSnapshot(req, context, config, fetchImpl) {
  const body = await readJsonBody(req);
  return mutationResponse(await createSessionReportSnapshot(body, context, config, { fetchImpl }));
}

async function saveSessionReportAi(req, context, config, fetchImpl) {
  const body = await readJsonBody(req);
  return mutationResponse(await saveSessionReportAiResult(body, context, config, { fetchImpl }));
}

async function saveFieldCheckResult(req, context, config, fetchImpl) {
  const body = await readJsonBody(req);
  return mutationResponse(await updateFieldCheckResult(body, context, config, { fetchImpl }));
}

async function createSettingGroup(req, context, config, fetchImpl) {
  const body = await readJsonBody(req);
  return mutationResponse(await createReportSettingGroup(body, context, config, { fetchImpl }));
}

async function updateSettingGroup(req, context, config, fetchImpl) {
  const body = await readJsonBody(req);
  return mutationResponse(await updateReportSettingGroup(body, context, config, { fetchImpl }));
}

async function createSettingItem(req, context, config, fetchImpl) {
  const body = await readJsonBody(req);
  return mutationResponse(await createReportSettingItem(body, context, config, { fetchImpl }));
}

async function updateSettingItem(req, context, config, fetchImpl) {
  const body = await readJsonBody(req);
  return mutationResponse(await updateReportSettingItem(body, context, config, { fetchImpl }));
}

async function prepareOutletMedia(req, context, config, fetchImpl) {
  const body = await readJsonBody(req);
  return response({ data: await prepareOutletMediaUpload(body, context, config, { fetchImpl }) });
}

async function finalizeOutletMedia(req, context, config, fetchImpl) {
  const body = await readJsonBody(req);
  return response({ data: await finalizeOutletMediaUpload(body, context, config, { fetchImpl }) });
}

async function removeOutletMedia(req, context, config, fetchImpl) {
  const body = await readJsonBody(req);
  return response({ data: await deleteOutletMedia(body, context, config, { fetchImpl }) });
}

async function loadOutletCustomer(url, context, config, fetchImpl) {
  const routeCustomerId = text(url.searchParams.get("routeCustomerId") || url.searchParams.get("route_customer_id"));
  if (!routeCustomerId) badRequest("route_customer_id_required");
  return response({ data: await loadOutletCustomerProfile(routeCustomerId, context, config, { fetchImpl }) });
}

async function cleanupOutletMediaRequest(req, context, config, fetchImpl) {
  assertCleanupActor(context);
  const body = await readJsonBody(req);
  return response({ data: await cleanupOutletMedia(body, context, config, { fetchImpl }) });
}

async function removeRouteCustomer(routeCustomerId, context, config, fetchImpl) {
  return response({ data: await deleteRouteCustomerAndMedia(routeCustomerId, context, config, { fetchImpl }) });
}

async function removeRoute(routeId, context, config, fetchImpl) {
  return response({ data: await deleteRouteAndMedia(routeId, context, config, { fetchImpl }) });
}

async function loadReportTemplates(config, fetchImpl) {
  const result = await supabaseRest(config, "mcp_report_templates?select=*&status=eq.active&order=sort_order.asc,title.asc", { fetchImpl });
  const templates = (Array.isArray(result) ? result : []).map((row) => ({
    id: row.id,
    title: row.title,
    reportType: row.report_type,
    scopeType: row.scope_type || "global",
    content: row.content || "",
    priceSummary: row.price_summary || "",
    competitorSummary: row.competitor_summary || "",
    displaySummary: row.display_summary || "",
    stockSummary: row.stock_summary || "",
    demandSummary: row.demand_summary || "",
    opportunitySummary: row.opportunity_summary || "",
    riskSummary: row.risk_summary || "",
    nextAction: row.next_action || "",
    sortOrder: row.sort_order,
    note: row.note || "",
    meta: row.raw_payload || {}
  }));
  return response({ data: { templates } });
}

async function loadProductVariants(productId, config, fetchImpl) {
  if (!productId) badRequest("product_id_required");
  const data = await supabaseRpc(config, "mcp_get_product_variants", { p_product_id: productId }, { fetchImpl });
  return response({ data });
}

async function searchProducts(url, config, fetchImpl) {
  const data = await supabaseRpc(config, "mcp_search_products", {
    p_q: String(url.searchParams.get("q") || "").trim(),
    p_category: String(url.searchParams.get("category") || "").trim(),
    p_brand: String(url.searchParams.get("brand") || "").trim(),
    p_limit: boundedLimit(url.searchParams.get("limit"))
  }, { fetchImpl });
  return response({ data });
}

export async function handleTransitionalApi(req, url, context, config, { fetchImpl = fetch } = {}) {
  const method = String(req.method || "GET").toUpperCase();
  const pathname = url.pathname;

  if (method === "POST" && pathname === "/api/mcp-day/open-session") return saveOpenRouteSession(req, context, config, fetchImpl);
  if (method === "POST" && pathname === "/api/mcp-day/session-customer/status") return saveSessionCustomerStatus(req, context, config, fetchImpl);

  const sessionLifecycle = pathname.match(/^\/api\/mcp-sessions\/([^/]+)$/);
  if (sessionLifecycle && method === "PATCH") {
    return saveRouteSessionUpdate(req, decodePathId(sessionLifecycle[1], "invalid_session_id"), context, config, fetchImpl);
  }
  if (sessionLifecycle && method === "DELETE") {
    return removeEmptyRouteSession(decodePathId(sessionLifecycle[1], "invalid_session_id"), context, config, fetchImpl);
  }

  if (method === "POST" && pathname === "/api/mcp-day/session-customer/result") return saveSessionCustomerResult(req, context, config, fetchImpl);
  if (method === "POST" && pathname === "/api/mcp-day/session-customer/add") return saveAddedSessionCustomer(req, context, config, fetchImpl);
  if (method === "POST" && pathname === "/api/route-customers") return saveAddedRouteCustomer(req, context, config, fetchImpl);
  if (method === "POST" && pathname === "/api/mcp-day/session-customer/checkin") return saveSessionCustomerCheckin(req, context, config, fetchImpl);
  if (method === "POST" && pathname === "/api/mcp-day/session-customer/order") return saveSessionCustomerOrder(req, context, config, fetchImpl);
  if (method === "POST" && pathname === "/api/mcp-day/session-customer/test") return saveSessionCustomerTest(req, context, config, fetchImpl);
  if (method === "POST" && pathname === "/api/mcp-day/session-customer/report") return saveSessionCustomerReport(req, context, config, fetchImpl);
  if (method === "POST" && pathname === "/api/mcp-day/session-customer/followup") return saveSessionCustomerFollowup(req, context, config, fetchImpl);
  if (method === "POST" && pathname === "/api/mcp-session-report") return saveSessionReportSnapshot(req, context, config, fetchImpl);
  if (method === "POST" && pathname === "/api/mcp-session-report/ai-result") return saveSessionReportAi(req, context, config, fetchImpl);
  if (method === "POST" && pathname === "/api/field-checks/result") return saveFieldCheckResult(req, context, config, fetchImpl);
  if (method === "POST" && pathname === "/api/mcp-report-setting-groups") return createSettingGroup(req, context, config, fetchImpl);
  if (method === "PATCH" && pathname === "/api/mcp-report-setting-groups") return updateSettingGroup(req, context, config, fetchImpl);
  if (method === "POST" && pathname === "/api/mcp-report-settings") return createSettingItem(req, context, config, fetchImpl);
  if (method === "PATCH" && pathname === "/api/mcp-report-settings") return updateSettingItem(req, context, config, fetchImpl);
  if (method === "POST" && pathname === "/api/outlet-media/upload-init") return prepareOutletMedia(req, context, config, fetchImpl);
  if (method === "POST" && pathname === "/api/outlet-media/upload-finalize") return finalizeOutletMedia(req, context, config, fetchImpl);
  if (method === "POST" && pathname === "/api/outlet-media/delete") return removeOutletMedia(req, context, config, fetchImpl);
  if (method === "POST" && pathname === "/api/internal/outlet-media/cleanup") return cleanupOutletMediaRequest(req, context, config, fetchImpl);

  if (method === "POST") {
    const customerDelete = pathname.match(/^\/api\/route-customers\/([^/]+)\/archive$/);
    if (customerDelete) return removeRouteCustomer(decodePathId(customerDelete[1], "invalid_route_customer_id"), context, config, fetchImpl);
    const routeDelete = pathname.match(/^\/api\/routes\/([^/]+)\/archive$/);
    if (routeDelete) return removeRoute(decodePathId(routeDelete[1], "invalid_route_id"), context, config, fetchImpl);
  }

  if (method === "GET" && pathname === "/api/outlet-media/customer-profile") return loadOutletCustomer(url, context, config, fetchImpl);
  if (method === "GET" && pathname === "/api/mcp-report-templates") return loadReportTemplates(config, fetchImpl);
  if (method === "GET" && pathname === "/api/products/search") return searchProducts(url, config, fetchImpl);

  if (method === "GET") {
    const match = pathname.match(/^\/api\/products\/([^/]+)\/variants$/);
    if (match) return loadProductVariants(decodePathId(match[1], "invalid_product_id"), config, fetchImpl);
  }

  return null;
}

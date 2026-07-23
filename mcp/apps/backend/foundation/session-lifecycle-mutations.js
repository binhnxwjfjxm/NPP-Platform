import { normalizeIdempotencyProviderError } from "./idempotency.js";
import { supabaseRpc } from "./supabase-adapter.js";

const SESSION_STATUSES = new Set(["active", "done", "cancelled"]);
const VISIT_STATUSES = new Set(["pending", "visited", "skipped", "cancelled"]);

function text(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function badRequest(code) {
  const error = new Error(code);
  error.statusCode = 400;
  throw error;
}

function dateOnly(value, { required = false } = {}) {
  const normalized = text(value);
  if (!normalized) {
    if (required) badRequest("session_date_required");
    return null;
  }
  const date = normalized.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) badRequest("invalid_session_date");
  return date;
}

function normalizedSessionStatus(value, { required = false } = {}) {
  const normalized = text(value)?.toLowerCase() || null;
  if (!normalized) {
    if (required) badRequest("session_status_required");
    return null;
  }
  const status = normalized === "completed" ? "done" : normalized;
  if (!SESSION_STATUSES.has(status)) badRequest("invalid_session_status");
  return status;
}

function foundationContext(context) {
  return {
    requestId: context.requestId,
    idempotencyKey: context.idempotencyKey || null,
    receivedAt: context.receivedAt || null,
    installationId: context.installation.id,
    nppCode: context.installation.nppCode,
    actorId: context.actor.id,
    actorType: context.actor.type,
    actorAuthentication: context.actor.authentication || null
  };
}

function providerBusinessCode(error) {
  const normalized = String(error?.providerMessage || "").trim().toLowerCase();
  return /^[a-z][a-z0-9_]{2,127}$/.test(normalized) ? normalized : null;
}

function normalizeMutationError(error) {
  if (normalizeIdempotencyProviderError(error)) return error;
  const code = providerBusinessCode(error);
  if (!code) return error;

  error.code = code;
  if (code.endsWith("_not_found") || code === "session_not_found" || code === "route_not_found") {
    error.statusCode = 404;
  } else if (
    code.includes("closed") ||
    code.includes("read_only") ||
    code.includes("has_activity") ||
    code.includes("active_session") ||
    code.includes("cancel_instead")
  ) {
    error.statusCode = 409;
  } else if (
    code.includes("required") ||
    code.startsWith("invalid_") ||
    code.includes("inactive")
  ) {
    error.statusCode = 400;
  }
  return error;
}

export async function openRouteSession(body, context, config, options) {
  const routeId = text(body.routeId || body.route_id);
  const sessionDate = dateOnly(body.sessionDate || body.session_date || body.date, { required: true });
  if (!routeId) badRequest("route_id_required");

  try {
    return await supabaseRpc(config, "mcp_idempotent_open_route_session", {
      p_route_id: routeId,
      p_session_date: sessionDate,
      p_owner: text(body.owner || body.sales || body.salesOwner || body.sales_owner),
      p_context: foundationContext(context)
    }, { fetchImpl: options?.fetchImpl || fetch });
  } catch (error) {
    throw normalizeMutationError(error);
  }
}

export async function setSessionCustomerStatus(body, context, config, options) {
  const sessionCustomerId = text(body.sessionCustomerId || body.session_customer_id || body.id);
  const visitStatus = String(body.visitStatus || body.visit_status || body.status || "visited").trim().toLowerCase();
  const statusReason = text(body.statusReason || body.status_reason || body.reason);
  if (!sessionCustomerId) badRequest("session_customer_id_required");
  if (!VISIT_STATUSES.has(visitStatus)) badRequest("invalid_visit_status");
  if ((visitStatus === "skipped" || visitStatus === "cancelled") && !statusReason) {
    badRequest("status_reason_required");
  }

  try {
    return await supabaseRpc(config, "mcp_idempotent_set_session_customer_status", {
      p_session_customer_id: sessionCustomerId,
      p_visit_status: visitStatus,
      p_status_reason: statusReason,
      p_note: text(body.note),
      p_context: foundationContext(context)
    }, { fetchImpl: options?.fetchImpl || fetch });
  } catch (error) {
    throw normalizeMutationError(error);
  }
}

export async function updateRouteSession(sessionIdInput, body, context, config, options) {
  const sessionId = text(sessionIdInput || body.sessionId || body.session_id);
  if (!sessionId) badRequest("session_id_required");

  try {
    return await supabaseRpc(config, "mcp_idempotent_update_route_session", {
      p_session_id: sessionId,
      p_session_date: dateOnly(body.sessionDate || body.session_date),
      p_status: normalizedSessionStatus(body.status),
      p_note: body.note === undefined ? null : text(body.note),
      p_context: foundationContext(context)
    }, { fetchImpl: options?.fetchImpl || fetch });
  } catch (error) {
    throw normalizeMutationError(error);
  }
}

export async function deleteEmptyRouteSession(sessionIdInput, context, config, options) {
  const sessionId = text(sessionIdInput);
  if (!sessionId) badRequest("session_id_required");

  try {
    return await supabaseRpc(config, "mcp_idempotent_delete_empty_route_session", {
      p_session_id: sessionId,
      p_context: foundationContext(context)
    }, { fetchImpl: options?.fetchImpl || fetch });
  } catch (error) {
    throw normalizeMutationError(error);
  }
}

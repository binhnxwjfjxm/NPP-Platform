import { normalizeIdempotencyProviderError } from "./idempotency.js";
import { supabaseRpc } from "./supabase-adapter.js";

function text(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function badRequest(code) {
  const error = new Error(code);
  error.statusCode = 400;
  throw error;
}

function optionalWeekday(value) {
  if (value === undefined || value === null || value === "") return null;
  const weekday = Number(value);
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) badRequest("invalid_weekday");
  return weekday;
}

function optionalBoolean(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "boolean") return value;
  if (value === "true" || value === 1 || value === "1") return true;
  if (value === "false" || value === 0 || value === "0") return false;
  badRequest("invalid_active");
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
  if (code === "route_not_found") error.statusCode = 404;
  else if (code.includes("required") || code.startsWith("invalid_")) error.statusCode = 400;
  return error;
}

export async function createRoute(body, context, config, options) {
  const routeName = text(body.routeName || body.route_name || body.name);
  if (!routeName) badRequest("route_name_required");

  try {
    return await supabaseRpc(config, "mcp_idempotent_create_route", {
      p_route_name: routeName,
      p_area: text(body.area),
      p_weekday: optionalWeekday(body.weekday),
      p_note: text(body.note),
      p_distributor_id: text(body.distributorId || body.distributor_id),
      p_context: foundationContext(context)
    }, { fetchImpl: options?.fetchImpl || fetch });
  } catch (error) {
    throw normalizeMutationError(error);
  }
}

export async function updateRoute(routeIdInput, body, context, config, options) {
  const routeId = text(routeIdInput || body.routeId || body.route_id);
  if (!routeId) badRequest("route_id_required");

  try {
    return await supabaseRpc(config, "mcp_idempotent_update_route", {
      p_route_id: routeId,
      p_route_name:
        body.routeName === undefined && body.route_name === undefined && body.name === undefined
          ? null
          : text(body.routeName || body.route_name || body.name),
      p_area: body.area === undefined ? null : text(body.area),
      p_weekday: optionalWeekday(body.weekday),
      p_note: body.note === undefined ? null : text(body.note),
      p_active: optionalBoolean(body.active),
      p_distributor_id:
        body.distributorId === undefined && body.distributor_id === undefined
          ? null
          : text(body.distributorId || body.distributor_id),
      p_context: foundationContext(context)
    }, { fetchImpl: options?.fetchImpl || fetch });
  } catch (error) {
    throw normalizeMutationError(error);
  }
}

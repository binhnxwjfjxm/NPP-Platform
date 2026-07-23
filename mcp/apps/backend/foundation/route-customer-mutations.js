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

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function optionalBoolean(body, camelKey, snakeKey) {
  const hasCamel = hasOwn(body, camelKey);
  const hasSnake = hasOwn(body, snakeKey);
  if (!hasCamel && !hasSnake) return null;

  const value = hasCamel ? body[camelKey] : body[snakeKey];
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;

  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y", "co", "có"].includes(normalized)) return true;
  if (["false", "0", "no", "n", "khong", "không"].includes(normalized)) return false;
  badRequest(`invalid_${snakeKey}`);
}

function optionalNumber(body, camelKey, snakeKey) {
  const hasCamel = hasOwn(body, camelKey);
  const hasSnake = hasOwn(body, snakeKey);
  if (!hasCamel && !hasSnake) return null;

  const value = hasCamel ? body[camelKey] : body[snakeKey];
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) badRequest(`invalid_${snakeKey}`);
  return parsed;
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

  if (code.endsWith("_not_found")) {
    error.statusCode = 404;
    error.code = code;
  } else if (
    code.includes("closed") ||
    code.includes("cancelled") ||
    code.includes("read_only") ||
    code.includes("ambiguous") ||
    code.includes("already_exists")
  ) {
    error.statusCode = 409;
    error.code = code;
  } else if (
    code.includes("required") ||
    code.startsWith("invalid_") ||
    code.includes("mismatch") ||
    code.includes("inactive")
  ) {
    error.statusCode = 400;
    error.code = code;
  }

  return error;
}

export async function addRouteCustomer(body, context, config, options) {
  const fetchImpl = options?.fetchImpl || fetch;
  const routeId = text(body.routeId || body.route_id);
  const customerName = text(body.customerName || body.customer_name || body.accountName || body.account_name || body.name);
  const includeActiveSession = optionalBoolean(body, "includeActiveSession", "include_active_session") ?? false;
  const activeSessionId = text(body.activeSessionId || body.active_session_id);
  const sortOrder = optionalNumber(body, "sortOrder", "sort_order");
  const geoLat = optionalNumber(body, "geoLat", "geo_lat");
  const geoLng = optionalNumber(body, "geoLng", "geo_lng");
  const geoAccuracy = optionalNumber(body, "geoAccuracy", "geo_accuracy");

  if (!routeId) badRequest("route_id_required");
  if (!customerName) badRequest("customer_name_required");
  if (includeActiveSession && !activeSessionId) badRequest("active_session_id_required");
  if (sortOrder !== null && (!Number.isInteger(sortOrder) || sortOrder < 0)) badRequest("invalid_sort_order");
  if ((geoLat === null) !== (geoLng === null)) badRequest("geo_coordinates_incomplete");
  if (geoLat !== null && (geoLat < -90 || geoLat > 90)) badRequest("invalid_geo_lat");
  if (geoLng !== null && (geoLng < -180 || geoLng > 180)) badRequest("invalid_geo_lng");
  if (geoAccuracy !== null && geoAccuracy < 0) badRequest("invalid_geo_accuracy");

  const googleMapsUrl = text(body.googleMapsUrl || body.google_maps_url) || (
    geoLat !== null && geoLng !== null
      ? `https://www.google.com/maps/search/?api=1&query=${geoLat},${geoLng}`
      : null
  );

  try {
    return await supabaseRpc(
      config,
      "mcp_idempotent_add_route_customer",
      {
        p_route_id: routeId,
        p_customer_name: customerName,
        p_phone: text(body.phone),
        p_area: text(body.area),
        p_address: text(body.address),
        p_sort_order: sortOrder,
        p_note: text(body.note),
        p_customer_id: text(body.customerId || body.customer_id),
        p_geo_lat: geoLat,
        p_geo_lng: geoLng,
        p_geo_accuracy: geoAccuracy,
        p_geo_source: text(body.geoSource || body.geo_source) || (geoLat !== null ? "browser" : null),
        p_google_maps_url: googleMapsUrl,
        p_include_active_session: includeActiveSession,
        p_active_session_id: includeActiveSession ? activeSessionId : null,
        p_context: foundationContext(context)
      },
      { fetchImpl }
    );
  } catch (error) {
    throw normalizeMutationError(error);
  }
}

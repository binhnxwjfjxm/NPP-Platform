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

function hasAny(body, keys) {
  return keys.some((key) => Object.prototype.hasOwnProperty.call(body, key));
}

function valueOf(body, keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(body, key)) return body[key];
  }
  return undefined;
}

function optionalText(body, keys) {
  return hasAny(body, keys) ? text(valueOf(body, keys)) : null;
}

function optionalNumber(body, keys, code) {
  if (!hasAny(body, keys)) return null;
  const value = valueOf(body, keys);
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) badRequest(code);
  return parsed;
}

function optionalBoolean(body, keys) {
  if (!hasAny(body, keys)) return null;
  const value = valueOf(body, keys);
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || String(value).trim().toLowerCase() === "true") return true;
  if (value === 0 || value === "0" || String(value).trim().toLowerCase() === "false") return false;
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
  if (code === "route_customer_not_found") error.statusCode = 404;
  else if (code.includes("required") || code.startsWith("invalid_") || code.includes("incomplete")) {
    error.statusCode = 400;
  }
  return error;
}

export async function updateRouteCustomer(routeCustomerIdInput, body, context, config, options) {
  const routeCustomerId = text(routeCustomerIdInput || body.routeCustomerId || body.route_customer_id);
  if (!routeCustomerId) badRequest("route_customer_id_required");

  const sortOrder = optionalNumber(body, ["sortOrder", "sort_order"], "invalid_sort_order");
  const geoLat = optionalNumber(body, ["geoLat", "geo_lat"], "invalid_geo_lat");
  const geoLng = optionalNumber(body, ["geoLng", "geo_lng"], "invalid_geo_lng");
  const geoAccuracy = optionalNumber(body, ["geoAccuracy", "geo_accuracy"], "invalid_geo_accuracy");

  if (sortOrder !== null && (!Number.isInteger(sortOrder) || sortOrder < 0)) badRequest("invalid_sort_order");
  if ((geoLat === null) !== (geoLng === null)) badRequest("geo_coordinates_incomplete");
  if (geoLat !== null && (geoLat < -90 || geoLat > 90)) badRequest("invalid_geo_lat");
  if (geoLng !== null && (geoLng < -180 || geoLng > 180)) badRequest("invalid_geo_lng");
  if (geoAccuracy !== null && geoAccuracy < 0) badRequest("invalid_geo_accuracy");

  const suppliedMapsUrl = optionalText(body, ["googleMapsUrl", "google_maps_url"]);
  const googleMapsUrl = suppliedMapsUrl || (
    geoLat !== null && geoLng !== null
      ? `https://www.google.com/maps/search/?api=1&query=${geoLat},${geoLng}`
      : null
  );

  try {
    return await supabaseRpc(config, "mcp_idempotent_update_route_customer", {
      p_route_customer_id: routeCustomerId,
      p_customer_name: optionalText(body, ["customerName", "customer_name", "accountName", "account_name", "name"]),
      p_phone: optionalText(body, ["phone"]),
      p_area: optionalText(body, ["area"]),
      p_address: optionalText(body, ["address"]),
      p_sort_order: sortOrder,
      p_note: optionalText(body, ["note"]),
      p_active: optionalBoolean(body, ["active"]),
      p_geo_lat: geoLat,
      p_geo_lng: geoLng,
      p_geo_accuracy: geoAccuracy,
      p_geo_source: optionalText(body, ["geoSource", "geo_source"]) || (geoLat !== null ? "browser" : null),
      p_google_maps_url: googleMapsUrl,
      p_context: foundationContext(context)
    }, { fetchImpl: options?.fetchImpl || fetch });
  } catch (error) {
    throw normalizeMutationError(error);
  }
}

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
    code.includes("read_only") ||
    code.includes("cancelled") ||
    code.includes("has_activity") ||
    code.includes("already_exists")
  ) {
    error.statusCode = 409;
    error.code = code;
  } else if (
    code.includes("required") ||
    code.startsWith("invalid_") ||
    code.includes("route_mismatch") ||
    code === "result_required"
  ) {
    error.statusCode = 400;
    error.code = code;
  }
  return error;
}

function resultInputPresent(body, resultType, note, orderId, testId, reportId) {
  return Boolean(
    resultType ||
    note ||
    orderId ||
    testId ||
    reportId ||
    hasOwn(body, "hasOrder") ||
    hasOwn(body, "has_order") ||
    hasOwn(body, "hasTest") ||
    hasOwn(body, "has_test") ||
    hasOwn(body, "hasReport") ||
    hasOwn(body, "has_report")
  );
}

export async function recordSessionCustomerResult(body, context, config, options) {
  const fetchImpl = options?.fetchImpl || fetch;
  const sessionCustomerId = text(body.sessionCustomerId || body.session_customer_id || body.id);
  const resultType = text(body.resultType || body.result_type || body.type)?.toLowerCase() || null;
  const note = text(body.note || body.result || body.resultNote || body.result_note);
  const orderId = text(body.orderId || body.order_id);
  const testId = text(body.testId || body.test_id);
  const reportId = text(body.reportId || body.report_id);

  if (!sessionCustomerId) badRequest("session_customer_id_required");
  if (resultType && !["order", "test", "report"].includes(resultType)) {
    badRequest("invalid_result_type");
  }
  if (!resultInputPresent(body, resultType, note, orderId, testId, reportId)) {
    badRequest("result_required");
  }

  try {
    return await supabaseRpc(
      config,
      "mcp_idempotent_record_session_customer_result",
      {
        p_session_customer_id: sessionCustomerId,
        p_result_type: resultType,
        p_note: note,
        p_order_id: orderId,
        p_test_id: testId,
        p_report_id: reportId,
        p_has_order: optionalBoolean(body, "hasOrder", "has_order"),
        p_has_test: optionalBoolean(body, "hasTest", "has_test"),
        p_has_report: optionalBoolean(body, "hasReport", "has_report"),
        p_context: foundationContext(context)
      },
      { fetchImpl }
    );
  } catch (error) {
    throw normalizeMutationError(error);
  }
}

export async function addSessionCustomer(body, context, config, options) {
  const fetchImpl = options?.fetchImpl || fetch;
  const sessionId = text(body.sessionId || body.session_id);
  const customerName = text(body.customerName || body.customer_name || body.accountName || body.account_name);
  const geoLat = optionalNumber(body, "geoLat", "geo_lat");
  const geoLng = optionalNumber(body, "geoLng", "geo_lng");
  const geoAccuracy = optionalNumber(body, "geoAccuracy", "geo_accuracy");

  if (!sessionId) badRequest("session_id_required");
  if (!customerName) badRequest("customer_name_required");
  if ((geoLat === null) !== (geoLng === null)) badRequest("geo_coordinates_incomplete");
  if (geoLat !== null && (geoLat < -90 || geoLat > 90)) badRequest("invalid_geo_lat");
  if (geoLng !== null && (geoLng < -180 || geoLng > 180)) badRequest("invalid_geo_lng");
  if (geoAccuracy !== null && geoAccuracy < 0) badRequest("invalid_geo_accuracy");

  try {
    return await supabaseRpc(
      config,
      "mcp_idempotent_add_session_customer",
      {
        p_session_id: sessionId,
        p_customer_name: customerName,
        p_route_customer_id: text(body.routeCustomerId || body.route_customer_id),
        p_customer_id: text(body.customerId || body.customer_id),
        p_phone: text(body.phone),
        p_area: text(body.area),
        p_address: text(body.address),
        p_note: text(body.note),
        p_context: foundationContext(context),
        p_geo_lat: geoLat,
        p_geo_lng: geoLng,
        p_geo_accuracy: geoAccuracy,
        p_geo_source: text(body.geoSource || body.geo_source),
        p_google_maps_url: text(body.googleMapsUrl || body.google_maps_url)
      },
      { fetchImpl }
    );
  } catch (error) {
    throw normalizeMutationError(error);
  }
}

export async function setSessionCustomerCheckin(body, context, config, options) {
  const fetchImpl = options?.fetchImpl || fetch;
  const sessionCustomerId = text(body.sessionCustomerId || body.session_customer_id || body.id);
  const checkedIn = optionalBoolean(body, "checkedIn", "checked_in");
  const geoLat = optionalNumber(body, "geoLat", "geo_lat");
  const geoLng = optionalNumber(body, "geoLng", "geo_lng");
  const geoAccuracy = optionalNumber(body, "geoAccuracy", "geo_accuracy");
  const geoSource = text(body.geoSource || body.geo_source);

  if (!sessionCustomerId) badRequest("session_customer_id_required");
  if (checkedIn === null) badRequest("checked_in_required");

  if (checkedIn) {
    if (geoLat === null || geoLng === null) badRequest("checkin_coordinates_required");
    if (geoLat < -90 || geoLat > 90) badRequest("invalid_geo_lat");
    if (geoLng < -180 || geoLng > 180) badRequest("invalid_geo_lng");
    if (geoAccuracy !== null && geoAccuracy < 0) badRequest("invalid_geo_accuracy");
  } else if (geoLat !== null || geoLng !== null || geoAccuracy !== null || geoSource) {
    badRequest("checkin_coordinates_not_allowed");
  }

  try {
    return await supabaseRpc(
      config,
      "mcp_idempotent_set_session_customer_checkin",
      {
        p_session_customer_id: sessionCustomerId,
        p_checked_in: checkedIn,
        p_geo_lat: checkedIn ? geoLat : null,
        p_geo_lng: checkedIn ? geoLng : null,
        p_geo_accuracy: checkedIn ? geoAccuracy : null,
        p_geo_source: checkedIn ? (geoSource || "browser_manual") : null,
        p_context: foundationContext(context)
      },
      { fetchImpl }
    );
  } catch (error) {
    throw normalizeMutationError(error);
  }
}

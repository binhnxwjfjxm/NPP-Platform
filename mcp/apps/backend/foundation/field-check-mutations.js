import { normalizeIdempotencyProviderError } from "./idempotency.js";
import { supabaseRpc } from "./supabase-adapter.js";

const PRESENTATION_STATUSES = new Set(["normal", "opportunity", "risk"]);
const PERSISTED_STATUS_BY_PRESENTATION = Object.freeze({
  normal: "ok",
  opportunity: "interested",
  risk: "bad"
});

function badRequest(code) {
  const error = new Error(code);
  error.statusCode = 400;
  error.code = code;
  throw error;
}

function text(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function requiredText(value, code, maxLength) {
  const normalized = text(value);
  if (!normalized) badRequest(code);
  if (normalized.length > maxLength) badRequest(`invalid_${code.replace(/_required$/, "")}`);
  return normalized;
}

function nullableText(value, code, maxLength) {
  const normalized = text(value);
  if (normalized && normalized.length > maxLength) badRequest(code);
  return normalized;
}

function presentationStatus(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!PRESENTATION_STATUSES.has(normalized)) badRequest("invalid_field_check_status");
  return normalized;
}

function compactMetadata(body) {
  return Object.fromEntries(
    [
      ["fileId", text(body.fileId ?? body.file_id)],
      ["customerId", text(body.customerId ?? body.customer_id)],
      ["sessionId", text(body.sessionId ?? body.session_id)],
      ["sessionCustomerId", text(body.sessionCustomerId ?? body.session_customer_id)],
      ["routeId", text(body.routeId ?? body.route_id)],
      ["sessionDate", text(body.sessionDate ?? body.session_date)]
    ].filter(([, value]) => value !== null)
  );
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
  if (code.endsWith("_not_found")) {
    error.statusCode = 404;
  } else if (code.includes("_conflict") || code.includes("_mismatch")) {
    error.statusCode = 409;
  } else if (code.includes("required") || code.startsWith("invalid_")) {
    error.statusCode = 400;
  }
  return error;
}

export async function updateFieldCheckResult(body, context, config, options) {
  const fetchImpl = options?.fetchImpl || fetch;
  const status = presentationStatus(body.status);

  try {
    return await supabaseRpc(config, "mcp_idempotent_update_field_check_result", {
      p_result_id: requiredText(body.resultId ?? body.result_id, "result_id_required", 200),
      p_product_id: nullableText(body.productId ?? body.product_id, "invalid_product_id", 200),
      p_product_name: requiredText(body.productName ?? body.product_name, "product_name_required", 500),
      p_status: PERSISTED_STATUS_BY_PRESENTATION[status],
      p_note: nullableText(body.note, "invalid_note", 5000),
      p_session_customer_id: nullableText(
        body.sessionCustomerId ?? body.session_customer_id,
        "invalid_session_customer_id",
        200
      ),
      p_input_meta: compactMetadata(body),
      p_context: foundationContext(context)
    }, { fetchImpl });
  } catch (error) {
    throw normalizeMutationError(error);
  }
}

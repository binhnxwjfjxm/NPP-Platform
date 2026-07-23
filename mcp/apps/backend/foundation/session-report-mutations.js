import { normalizeIdempotencyProviderError } from "./idempotency.js";
import { supabaseRpc } from "./supabase-adapter.js";

function text(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function badRequest(code) {
  const error = new Error(code);
  error.statusCode = 400;
  error.code = code;
  throw error;
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
  } else if (
    code.includes("closed") ||
    code.includes("read_only") ||
    code.includes("already_exists")
  ) {
    error.statusCode = 409;
  } else if (code.includes("required") || code.startsWith("invalid_")) {
    error.statusCode = 400;
  }
  return error;
}

function analyzedAt(value) {
  const normalized = text(value);
  if (!normalized) return null;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) badRequest("invalid_ai_analyzed_at");
  return parsed.toISOString();
}

export async function createSessionReportSnapshot(body, context, config, options) {
  const fetchImpl = options?.fetchImpl || fetch;
  const sessionId = text(body.sessionId || body.session_id);
  if (!sessionId) badRequest("session_id_required");

  try {
    return await supabaseRpc(
      config,
      "mcp_idempotent_create_session_report_snapshot",
      {
        p_session_id: sessionId,
        p_source: text(body.source) || "manual_snapshot",
        p_context: foundationContext(context)
      },
      { fetchImpl }
    );
  } catch (error) {
    throw normalizeMutationError(error);
  }
}

export async function saveSessionReportAiResult(body, context, config, options) {
  const fetchImpl = options?.fetchImpl || fetch;
  const sessionId = text(body.sessionId || body.session_id);
  const aiResult = object(body.aiResult || body.ai_result);

  if (!sessionId) badRequest("session_id_required");
  if (!aiResult) {
    if (body.aiResult === undefined && body.ai_result === undefined) badRequest("ai_result_required");
    badRequest("invalid_ai_result");
  }

  try {
    return await supabaseRpc(
      config,
      "mcp_idempotent_save_session_report_ai_result",
      {
        p_session_id: sessionId,
        p_ai_result: aiResult,
        p_analyzed_at: analyzedAt(body.analyzedAt || body.ai_analyzed_at),
        p_context: foundationContext(context)
      },
      { fetchImpl }
    );
  } catch (error) {
    throw normalizeMutationError(error);
  }
}

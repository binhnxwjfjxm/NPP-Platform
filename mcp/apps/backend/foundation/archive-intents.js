import { deleteRouteAndMedia, deleteRouteCustomerAndMedia } from "./outlet-media.js";
import { supabaseRpc } from "./supabase-adapter.js";

function text(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function fail(code, statusCode = 400, details = null) {
  const error = new Error(code);
  error.code = code;
  error.statusCode = statusCode;
  if (details) error.publicDetails = details;
  throw error;
}

function contextPayload(context) {
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

function errorCode(error) {
  return text(error?.code) || providerBusinessCode(error) || text(error?.message) || "archive_failed";
}

function normalizeProviderError(error) {
  const code = providerBusinessCode(error);
  if (!code) return error;
  error.code = code;
  if (code.endsWith("_not_found")) error.statusCode = 404;
  else if (code.includes("conflict") || code.includes("in_progress") || code.includes("already_completed")) error.statusCode = 409;
  else if (code.includes("required") || code.startsWith("invalid_") || code.includes("mismatch")) error.statusCode = 400;
  return error;
}

async function claimIntent(operation, targetType, targetId, context, config, fetchImpl) {
  if (!context.idempotencyKey) fail("idempotency_key_required", 400);
  return object(await supabaseRpc(config, "mcp_claim_archive_intent", {
    p_installation_id: context.installation.id,
    p_operation: operation,
    p_idempotency_key: context.idempotencyKey,
    p_target_type: targetType,
    p_target_id: targetId,
    p_request_payload: { targetId },
    p_context: contextPayload(context)
  }, { fetchImpl }));
}

async function finishIntent(intentId, succeeded, payload, errorMessage, context, config, fetchImpl) {
  return object(await supabaseRpc(config, "mcp_finish_archive_intent", {
    p_installation_id: context.installation.id,
    p_intent_id: intentId,
    p_succeeded: succeeded,
    p_response_status: succeeded ? 200 : null,
    p_response_payload: succeeded ? payload : null,
    p_error: errorMessage,
    p_context: contextPayload(context)
  }, { fetchImpl }));
}

function terminalPayload(intent, targetType, targetId, fallback = {}) {
  const stored = object(intent.response_payload || intent.responsePayload);
  if (Object.keys(stored).length) return stored;
  const job = object(intent.deleteJob || intent.delete_job);
  const fallbackPayload = object(fallback);
  return {
    ...fallbackPayload,
    targetType,
    targetId,
    deleteJobId: text(intent.delete_job_id || intent.deleteJobId || job.id || fallbackPayload.deleteJobId),
    deleted: true,
    deletedMediaCount: Number(fallbackPayload.deletedMediaCount ?? job.archive_media_count ?? 0)
  };
}

function replayResult(intent, targetType, targetId) {
  const intentId = text(intent.id);
  return {
    data: terminalPayload(intent, targetType, targetId),
    meta: {
      idempotency: {
        replayed: true,
        intentId,
        originalRequestId: text(object(intent.raw_payload).request_context?.requestId)
      }
    }
  };
}

async function recoverCompletedArchive(operation, targetType, targetId, context, config, fetchImpl) {
  const refreshed = await claimIntent(operation, targetType, targetId, context, config, fetchImpl);
  const intent = object(refreshed.intent);
  const intentId = text(intent.id);
  if (!intentId) return null;

  if (refreshed.mode === "replay" && intent.status === "completed") {
    return replayResult(intent, targetType, targetId);
  }

  const job = object(refreshed.deleteJob || refreshed.delete_job);
  const jobId = text(intent.delete_job_id || intent.deleteJobId || job.id);
  if (!jobId || job.status !== "completed") return null;

  const payload = terminalPayload({ ...intent, delete_job_id: jobId, deleteJob: job }, targetType, targetId);
  const finished = await finishIntent(intentId, true, payload, null, context, config, fetchImpl);
  return {
    data: terminalPayload(finished, targetType, targetId, payload),
    meta: { idempotency: { replayed: true, intentId } }
  };
}

async function executeArchive(options, context, config, fetchImpl) {
  const { operation, targetType, targetId, deleteTarget } = options;
  const claimed = await claimIntent(operation, targetType, targetId, context, config, fetchImpl);
  const intent = object(claimed.intent);
  const intentId = text(intent.id);
  if (!intentId) fail("archive_intent_invalid", 502);

  if (claimed.mode === "replay" && intent.status === "completed") {
    return replayResult(intent, targetType, targetId);
  }

  try {
    const deleted = object(await deleteTarget(targetId, context, config, { fetchImpl }));
    const payload = terminalPayload(intent, targetType, targetId, deleted);
    const finished = await finishIntent(intentId, true, payload, null, context, config, fetchImpl);
    return {
      data: terminalPayload(finished, targetType, targetId, payload),
      meta: { idempotency: { replayed: false, intentId } }
    };
  } catch (error) {
    const code = errorCode(error);
    const parentAlreadyAbsent =
      (targetType === "route" && code === "route_not_found") ||
      (targetType === "route_customer" && code === "route_customer_not_found");

    if (parentAlreadyAbsent) {
      let recovered;
      try {
        recovered = await recoverCompletedArchive(
          operation,
          targetType,
          targetId,
          context,
          config,
          fetchImpl
        );
      } catch (recoveryError) {
        throw normalizeProviderError(recoveryError);
      }
      if (recovered) return recovered;
    }

    await finishIntent(intentId, false, null, code, context, config, fetchImpl).catch(() => null);
    throw normalizeProviderError(error);
  }
}

export async function archiveRoute(routeIdInput, context, config, { fetchImpl = fetch } = {}) {
  const routeId = text(routeIdInput);
  if (!routeId) fail("route_id_required");
  return executeArchive({
    operation: "route.archive",
    targetType: "route",
    targetId: routeId,
    deleteTarget: deleteRouteAndMedia
  }, context, config, fetchImpl);
}

export async function archiveRouteCustomer(routeCustomerIdInput, context, config, { fetchImpl = fetch } = {}) {
  const routeCustomerId = text(routeCustomerIdInput);
  if (!routeCustomerId) fail("route_customer_id_required");
  return executeArchive({
    operation: "route-customer.archive",
    targetType: "route_customer",
    targetId: routeCustomerId,
    deleteTarget: deleteRouteCustomerAndMedia
  }, context, config, fetchImpl);
}

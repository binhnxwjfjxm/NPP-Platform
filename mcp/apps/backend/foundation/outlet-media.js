import { supabaseRest, supabaseRpc } from "./supabase-adapter.js";
import { presignR2Put, signedR2DeleteRequest, signedR2HeadRequest } from "./r2-storage.js";

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/webp", "image/png"]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const DELETE_CONCURRENCY = 6;

function text(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function fail(code, statusCode = 400, details = null) {
  const error = new Error(code);
  error.code = code;
  error.statusCode = statusCode;
  if (details) error.publicDetails = details;
  throw error;
}

function number(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function rows(value) {
  return Array.isArray(value) ? value : [];
}

function contextPayload(context) {
  return {
    requestId: context.requestId,
    receivedAt: context.receivedAt || null,
    installationId: context.installation.id,
    nppCode: context.installation.nppCode,
    actorId: context.actor.id,
    actorType: context.actor.type,
    actorAuthentication: context.actor.authentication || null
  };
}

function requireR2(config) {
  if (!config.r2?.configured) fail("r2_not_configured", 503);
  return config.r2;
}

function providerBusinessCode(error) {
  const normalized = String(error?.providerMessage || "").trim().toLowerCase();
  return /^[a-z][a-z0-9_]{2,127}$/.test(normalized) ? normalized : null;
}

function errorCode(error) {
  return text(error?.code) || providerBusinessCode(error) || text(error?.message) || "provider_request_failed";
}

function normalizeProviderError(error) {
  const code = providerBusinessCode(error);
  if (!code) return error;
  error.code = code;
  if (code.endsWith("_not_found")) error.statusCode = 404;
  else if (code.includes("conflict") || code.includes("not_pending")) error.statusCode = 409;
  else if (code.includes("required") || code.startsWith("invalid_") || code.includes("mismatch")) error.statusCode = 400;
  return error;
}

async function mapWithConcurrency(items, concurrency, worker) {
  const result = new Array(items.length);
  let next = 0;
  async function run() {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      result[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
  return result;
}

async function finishMediaDelete(mediaId, succeeded, errorMessage, context, config, fetchImpl) {
  return supabaseRpc(config, "mcp_finish_outlet_media_delete", {
    p_installation_id: context.installation.id,
    p_media_id: mediaId,
    p_succeeded: succeeded,
    p_error: errorMessage,
    p_context: contextPayload(context)
  }, { fetchImpl });
}

async function finishDeleteJob(jobId, succeeded, errorMessage, context, config, fetchImpl) {
  if (!text(jobId)) return null;
  return supabaseRpc(config, "mcp_finish_storage_delete_job", {
    p_installation_id: context.installation.id,
    p_job_id: jobId,
    p_succeeded: succeeded,
    p_error: errorMessage,
    p_context: contextPayload(context)
  }, { fetchImpl });
}

async function deleteClaimedMedia(media, context, config, fetchImpl) {
  const mediaId = text(media.id);
  const objectKey = text(media.object_key || media.objectKey);
  if (!mediaId || !objectKey) return { mediaId, deleted: false, error: "invalid_media_delete_claim" };
  if (media.status === "deleted") return { mediaId, objectKey, deleted: true, alreadyDeleted: true };

  try {
    const request = signedR2DeleteRequest(requireR2(config), objectKey);
    const response = await fetchImpl(request.url, request.init);
    const deleted = response.ok || response.status === 404;
    const errorMessage = deleted ? null : `r2_delete_http_${response.status}`;
    await finishMediaDelete(mediaId, deleted, errorMessage, context, config, fetchImpl);
    return { mediaId, objectKey, deleted, status: response.status, error: errorMessage };
  } catch (error) {
    const errorMessage = `r2_delete_error:${String(error?.message || error).slice(0, 300)}`;
    try {
      await finishMediaDelete(mediaId, false, errorMessage, context, config, fetchImpl);
    } catch {
      // The cleanup owner can reclaim both deleting and delete_failed rows.
    }
    return { mediaId, objectKey, deleted: false, error: errorMessage };
  }
}

async function deleteClaimedRows(mediaRows, context, config, fetchImpl) {
  const results = await mapWithConcurrency(rows(mediaRows), DELETE_CONCURRENCY, (media) => (
    deleteClaimedMedia(media, context, config, fetchImpl)
  ));
  return {
    results,
    deletedCount: results.filter((result) => result.deleted).length,
    failed: results.filter((result) => !result.deleted)
  };
}

async function finalizeDeleteJob(job, context, config, fetchImpl) {
  const jobId = text(job.id || job.jobId);
  const targetType = text(job.target_type || job.targetType);
  const targetId = text(job.target_id || job.targetId);
  if (!jobId || !targetType || !targetId) {
    return { jobId, targetType, targetId, completed: false, error: "invalid_storage_delete_job" };
  }

  let data = null;
  let completed = false;
  let finalError = null;
  try {
    if (targetType === "route_customer") {
      data = await supabaseRpc(config, "mcp_delete_route_customer_hard", {
        p_route_customer_id: targetId
      }, { fetchImpl });
    } else if (targetType === "route") {
      data = await supabaseRpc(config, "mcp_delete_route_hard", {
        p_route_id: targetId
      }, { fetchImpl });
    } else {
      fail("invalid_storage_delete_target_type");
    }
    completed = true;
  } catch (error) {
    const code = errorCode(error);
    const alreadyAbsent =
      (targetType === "route_customer" && code === "route_customer_not_found") ||
      (targetType === "route" && code === "route_not_found");
    completed = alreadyAbsent;
    finalError = alreadyAbsent ? null : code.slice(0, 300);
  }

  try {
    await finishDeleteJob(jobId, completed, finalError, context, config, fetchImpl);
  } catch (error) {
    return {
      jobId,
      targetType,
      targetId,
      completed: false,
      parentDeleted: completed,
      error: `delete_job_finish_failed:${errorCode(error).slice(0, 260)}`
    };
  }

  return { jobId, targetType, targetId, completed, data: object(data), error: finalError };
}

async function markDeleteJobFailed(job, reason, context, config, fetchImpl) {
  const jobId = text(object(job).id);
  if (!jobId) return;
  try {
    await finishDeleteJob(jobId, false, reason, context, config, fetchImpl);
  } catch {
    // A still-pending job remains reclaimable; do not hide the original R2 failure.
  }
}

export async function prepareOutletMediaUpload(body, context, config, { fetchImpl = fetch } = {}) {
  const routeCustomerId = text(body.routeCustomerId || body.route_customer_id);
  const sessionId = text(body.sessionId || body.session_id);
  const clientUploadId = text(body.clientUploadId || body.client_upload_id);
  const mimeType = text(body.mimeType || body.mime_type)?.toLowerCase();
  const byteSize = number(body.byteSize ?? body.byte_size);
  const geoLat = number(body.geoLat ?? body.geo_lat);
  const geoLng = number(body.geoLng ?? body.geo_lng);
  const geoAccuracy = number(body.geoAccuracy ?? body.geo_accuracy);

  if (!routeCustomerId) fail("route_customer_id_required");
  if (!clientUploadId) fail("client_upload_id_required");
  if (!ALLOWED_MIME_TYPES.has(mimeType)) fail("invalid_media_mime_type");
  if (!Number.isInteger(byteSize) || byteSize < 1 || byteSize > MAX_IMAGE_BYTES) fail("invalid_media_byte_size");
  if ((geoLat === null) !== (geoLng === null)) fail("geo_coordinates_incomplete");

  try {
    const media = await supabaseRpc(config, "mcp_prepare_outlet_media_upload", {
      p_installation_id: context.installation.id,
      p_route_customer_id: routeCustomerId,
      p_session_id: sessionId,
      p_client_upload_id: clientUploadId,
      p_mime_type: mimeType,
      p_expected_byte_size: byteSize,
      p_geo_lat: geoLat,
      p_geo_lng: geoLng,
      p_geo_accuracy: geoAccuracy,
      p_context: contextPayload(context)
    }, { fetchImpl });

    const signed = presignR2Put(requireR2(config), media.object_key, mimeType);
    return {
      mediaId: media.id,
      mimeType: media.mime_type,
      status: media.status,
      ...signed
    };
  } catch (error) {
    throw normalizeProviderError(error);
  }
}

export async function finalizeOutletMediaUpload(body, context, config, { fetchImpl = fetch } = {}) {
  const mediaId = text(body.mediaId || body.media_id);
  const width = number(body.width);
  const height = number(body.height);
  if (!mediaId) fail("media_id_required");

  try {
    const result = await supabaseRest(
      config,
      `mcp_outlet_media?select=id,object_key,mime_type,status&installation_id=eq.${encodeURIComponent(context.installation.id)}&id=eq.${encodeURIComponent(mediaId)}&limit=1`,
      { fetchImpl }
    );
    const media = rows(result)[0] || null;
    if (!media) fail("outlet_media_not_found", 404);

    const headRequest = signedR2HeadRequest(requireR2(config), media.object_key);
    const headResponse = await fetchImpl(headRequest.url, headRequest.init);
    if (!headResponse.ok) fail("r2_object_not_found", headResponse.status === 404 ? 409 : 502);

    const contentType = text(headResponse.headers.get("content-type"))?.split(";")[0]?.toLowerCase();
    const actualByteSize = Number(headResponse.headers.get("content-length"));
    if (contentType !== media.mime_type) fail("outlet_media_content_type_mismatch", 409);
    if (!Number.isInteger(actualByteSize) || actualByteSize < 1 || actualByteSize > MAX_IMAGE_BYTES) {
      fail("invalid_media_byte_size", 409);
    }

    return await supabaseRpc(config, "mcp_finalize_outlet_media_upload", {
      p_media_id: mediaId,
      p_etag: text(headResponse.headers.get("etag")),
      p_actual_byte_size: actualByteSize,
      p_content_type: contentType,
      p_width: Number.isInteger(width) && width > 0 ? width : null,
      p_height: Number.isInteger(height) && height > 0 ? height : null,
      p_context: contextPayload(context)
    }, { fetchImpl });
  } catch (error) {
    throw normalizeProviderError(error);
  }
}

export async function deleteOutletMedia(body, context, config, { fetchImpl = fetch } = {}) {
  const mediaId = text(body.mediaId || body.media_id);
  if (!mediaId) fail("media_id_required");

  try {
    const media = await supabaseRpc(config, "mcp_claim_outlet_media_delete", {
      p_installation_id: context.installation.id,
      p_media_id: mediaId,
      p_context: contextPayload(context)
    }, { fetchImpl });
    const result = await deleteClaimedMedia(media, context, config, fetchImpl);
    if (!result.deleted) fail("outlet_media_delete_incomplete", 502, { mediaId });
    return {
      mediaId: result.mediaId,
      deleted: result.deleted,
      status: result.status || null,
      alreadyDeleted: Boolean(result.alreadyDeleted)
    };
  } catch (error) {
    throw normalizeProviderError(error);
  }
}

export async function deleteRouteCustomerAndMedia(routeCustomerId, context, config, { fetchImpl = fetch } = {}) {
  if (!text(routeCustomerId)) fail("route_customer_id_required");

  try {
    const claim = object(await supabaseRpc(config, "mcp_claim_route_customer_media_delete", {
      p_installation_id: context.installation.id,
      p_route_customer_id: routeCustomerId,
      p_context: contextPayload(context)
    }, { fetchImpl }));
    const deleted = await deleteClaimedRows(claim.media, context, config, fetchImpl);
    if (deleted.failed.length) {
      await markDeleteJobFailed(claim.deleteJob, "route_customer_media_delete_incomplete", context, config, fetchImpl);
      fail("route_customer_media_delete_incomplete", 502, {
        routeCustomerId,
        failedMediaIds: deleted.failed.map((item) => item.mediaId).filter(Boolean)
      });
    }
    const finalized = await finalizeDeleteJob(claim.deleteJob, context, config, fetchImpl);
    if (!finalized.completed) {
      fail("route_customer_delete_incomplete", 502, { routeCustomerId, deleteJobId: finalized.jobId });
    }
    return { ...finalized.data, deletedMediaCount: deleted.deletedCount, deleteJobId: finalized.jobId };
  } catch (error) {
    throw normalizeProviderError(error);
  }
}

export async function deleteRouteAndMedia(routeId, context, config, { fetchImpl = fetch } = {}) {
  if (!text(routeId)) fail("route_id_required");

  try {
    const claim = object(await supabaseRpc(config, "mcp_claim_route_media_delete", {
      p_installation_id: context.installation.id,
      p_route_id: routeId,
      p_context: contextPayload(context)
    }, { fetchImpl }));
    const deleted = await deleteClaimedRows(claim.media, context, config, fetchImpl);
    if (deleted.failed.length) {
      await markDeleteJobFailed(claim.deleteJob, "route_media_delete_incomplete", context, config, fetchImpl);
      fail("route_media_delete_incomplete", 502, {
        routeId,
        failedMediaIds: deleted.failed.map((item) => item.mediaId).filter(Boolean)
      });
    }
    const finalized = await finalizeDeleteJob(claim.deleteJob, context, config, fetchImpl);
    if (!finalized.completed) {
      fail("route_delete_incomplete", 502, { routeId, deleteJobId: finalized.jobId });
    }
    return { ...finalized.data, deletedMediaCount: deleted.deletedCount, deleteJobId: finalized.jobId };
  } catch (error) {
    throw normalizeProviderError(error);
  }
}

export async function cleanupOutletMedia(body, context, config, { fetchImpl = fetch, now = new Date() } = {}) {
  const pendingAgeHours = Math.max(1, Math.min(Math.trunc(number(body.pendingAgeHours ?? body.pending_age_hours) || 24), 720));
  const retryAgeMinutes = Math.max(5, Math.min(Math.trunc(number(body.retryAgeMinutes ?? body.retry_age_minutes) || 15), 1440));
  const limit = Math.max(1, Math.min(Math.trunc(number(body.limit) || 50), 200));
  const pendingBefore = new Date(now.getTime() - pendingAgeHours * 60 * 60 * 1000).toISOString();
  const retryBefore = new Date(now.getTime() - retryAgeMinutes * 60 * 1000).toISOString();

  try {
    const claimed = await supabaseRpc(config, "mcp_claim_stale_outlet_media_delete", {
      p_installation_id: context.installation.id,
      p_pending_before: pendingBefore,
      p_retry_before: retryBefore,
      p_limit: limit,
      p_context: contextPayload(context)
    }, { fetchImpl });
    const deleted = await deleteClaimedRows(claimed, context, config, fetchImpl);

    const claimedJobs = await supabaseRpc(config, "mcp_claim_ready_storage_delete_jobs", {
      p_installation_id: context.installation.id,
      p_retry_before: retryBefore,
      p_limit: Math.min(limit, 100),
      p_context: contextPayload(context)
    }, { fetchImpl });
    const finalizedJobs = await mapWithConcurrency(rows(claimedJobs), DELETE_CONCURRENCY, (job) => (
      finalizeDeleteJob(job, context, config, fetchImpl)
    ));
    const failedJobs = finalizedJobs.filter((job) => !job.completed);

    return {
      claimedCount: rows(claimed).length,
      deletedCount: deleted.deletedCount,
      failedCount: deleted.failed.length,
      failedMediaIds: deleted.failed.map((item) => item.mediaId).filter(Boolean),
      claimedDeleteJobCount: rows(claimedJobs).length,
      completedDeleteJobCount: finalizedJobs.filter((job) => job.completed).length,
      failedDeleteJobCount: failedJobs.length,
      failedDeleteJobIds: failedJobs.map((job) => job.jobId).filter(Boolean),
      pendingBefore,
      retryBefore
    };
  } catch (error) {
    throw normalizeProviderError(error);
  }
}

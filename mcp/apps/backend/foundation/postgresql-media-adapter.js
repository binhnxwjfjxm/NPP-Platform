import { createHash, randomUUID } from "node:crypto";
import { providerPersistence } from "./provider-runtime.js";

export const POSTGRESQL_SPECIAL_RPC_NAMES = Object.freeze(new Set([
  "mcp_search_products",
  "mcp_get_product_variants",
  "mcp_prepare_outlet_media_upload",
  "mcp_finalize_outlet_media_upload",
  "mcp_claim_outlet_media_delete",
  "mcp_finish_outlet_media_delete",
  "mcp_claim_route_customer_media_delete",
  "mcp_claim_route_media_delete",
  "mcp_claim_stale_outlet_media_delete",
  "mcp_finish_storage_delete_job",
  "mcp_claim_ready_storage_delete_jobs",
  "mcp_delete_route_customer_hard",
  "mcp_delete_route_hard",
  "mcp_claim_archive_intent",
  "mcp_finish_archive_intent"
]));

function text(value) {
  const candidate = String(value ?? "").trim();
  return candidate || null;
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function json(value) {
  return JSON.stringify(value ?? null);
}

function providerError(code, statusCode = 400, details = null) {
  const error = new Error(code);
  error.code = code;
  error.providerMessage = code;
  error.statusCode = statusCode;
  if (details) error.publicDetails = details;
  return error;
}

function required(value, code) {
  const candidate = text(value);
  if (!candidate) throw providerError(code);
  return candidate;
}

function installation(config, args) {
  const value = text(args.p_installation_id) || text(config.installationId);
  if (!value) throw providerError("installation_id_required");
  if (text(args.p_installation_id) && text(config.installationId) && value !== config.installationId) {
    throw providerError("installation_scope_mismatch", 403);
  }
  return value;
}

function safePathSegment(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function archiveHash(operation, payload) {
  const canonical = JSON.stringify({ operation, payload: object(payload) }, Object.keys({ operation, payload }).sort());
  return createHash("sha256").update(canonical).digest("hex");
}

async function withClient(work) {
  const persistence = providerPersistence();
  await persistence.assertReady();
  return persistence.withTransaction(work);
}

async function searchProducts(client, args) {
  const query = text(args.p_q) || "";
  const category = text(args.p_category) || "";
  const brand = text(args.p_brand) || "";
  const limit = Math.max(1, Math.min(Number(args.p_limit || 50), 100));
  const result = await client.query(
    `SELECT id, installation_id, name, product_code, brand_code, brand_name,
            category, active, raw_payload, created_at, updated_at
     FROM mcp.products
     WHERE ($1 = '' OR name ILIKE '%' || $1 || '%' OR product_code ILIKE '%' || $1 || '%')
       AND ($2 = '' OR category = $2)
       AND ($3 = '' OR brand_name = $3 OR brand_code = $3)
       AND active IS TRUE
     ORDER BY name, id
     LIMIT $4`,
    [query, category, brand, limit]
  );
  return result.rows || [];
}

async function productVariants(client, args) {
  const productId = required(args.p_product_id, "product_id_required");
  const result = await client.query(
    `SELECT id, installation_id, product_id, sku, variant_name, size_label,
            sell_unit, pack_unit, pack_quantity, active, raw_options,
            raw_payload, created_at, updated_at
     FROM mcp.product_variants
     WHERE product_id = $1 AND active IS TRUE
     ORDER BY variant_name, sku, id`,
    [productId]
  );
  return result.rows || [];
}

async function requireMutableSession(client, installationId, sessionId) {
  const result = await client.query(
    `SELECT * FROM mcp.mcp_route_sessions
     WHERE installation_id = $1 AND id = $2
     FOR UPDATE`,
    [installationId, required(sessionId, "session_id_required")]
  );
  const row = result.rows?.[0];
  if (!row) throw providerError("session_not_found", 404);
  if (row.status !== "active") throw providerError("session_read_only", 409);
  return row;
}

async function requireRouteCustomer(client, installationId, routeCustomerId, lock = false) {
  const result = await client.query(
    `SELECT * FROM mcp.mcp_route_customers
     WHERE installation_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`,
    [installationId, required(routeCustomerId, "route_customer_id_required")]
  );
  const row = result.rows?.[0];
  if (!row) throw providerError("route_customer_not_found", 404);
  return row;
}

async function requireRoute(client, installationId, routeId, lock = false) {
  const result = await client.query(
    `SELECT * FROM mcp.mcp_routes
     WHERE installation_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`,
    [installationId, required(routeId, "route_id_required")]
  );
  const row = result.rows?.[0];
  if (!row) throw providerError("route_not_found", 404);
  return row;
}

async function prepareMedia(client, config, args) {
  const installationId = installation(config, args);
  const routeCustomerId = required(args.p_route_customer_id, "route_customer_id_required");
  const sessionId = required(args.p_session_id, "session_id_required");
  const clientUploadId = required(args.p_client_upload_id, "client_upload_id_required");
  const mimeType = required(args.p_mime_type, "mime_type_required").toLowerCase();
  const expectedByteSize = Number(args.p_expected_byte_size);
  if (!["image/jpeg", "image/webp", "image/png"].includes(mimeType)) {
    throw providerError("invalid_media_mime_type");
  }
  if (!Number.isInteger(expectedByteSize) || expectedByteSize < 1 || expectedByteSize > 5242880) {
    throw providerError("invalid_media_byte_size");
  }
  const lat = args.p_geo_lat == null ? null : Number(args.p_geo_lat);
  const lng = args.p_geo_lng == null ? null : Number(args.p_geo_lng);
  const accuracy = args.p_geo_accuracy == null ? null : Number(args.p_geo_accuracy);
  if ((lat === null) !== (lng === null)) throw providerError("geo_coordinates_incomplete");
  if (lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) throw providerError("invalid_geo_lat");
  if (lng !== null && (!Number.isFinite(lng) || lng < -180 || lng > 180)) throw providerError("invalid_geo_lng");
  if (accuracy !== null && (!Number.isFinite(accuracy) || accuracy < 0)) throw providerError("invalid_geo_accuracy");

  const session = await requireMutableSession(client, installationId, sessionId);
  const customer = await requireRouteCustomer(client, installationId, routeCustomerId, true);
  if (session.route_id !== customer.route_id) throw providerError("route_customer_route_mismatch");

  const existing = await client.query(
    `SELECT * FROM mcp.mcp_outlet_media
     WHERE installation_id = $1 AND client_upload_id = $2
     FOR UPDATE`,
    [installationId, clientUploadId]
  );
  if (existing.rows?.[0]) {
    const row = existing.rows[0];
    if (
      row.route_customer_id !== routeCustomerId ||
      row.session_id !== sessionId ||
      row.mime_type !== mimeType ||
      Number(row.expected_byte_size) !== expectedByteSize
    ) {
      throw providerError("outlet_media_upload_conflict", 409);
    }
    return row;
  }

  const id = `mom_${randomUUID().replaceAll("-", "")}`;
  const extension = mimeType === "image/webp" ? "webp" : mimeType === "image/png" ? "png" : "jpg";
  const objectKey = `mcp-plan/outlets/${safePathSegment(installationId)}/${safePathSegment(routeCustomerId)}/${id}.${extension}`;
  const inserted = await client.query(
    `INSERT INTO mcp.mcp_outlet_media (
       id, installation_id, route_customer_id, session_id, object_key,
       mime_type, expected_byte_size, client_upload_id, captured_by,
       geo_lat, geo_lng, geo_accuracy, raw_payload
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
       jsonb_build_object('foundation_context', $13::jsonb))
     RETURNING *`,
    [
      id, installationId, routeCustomerId, sessionId, objectKey,
      mimeType, expectedByteSize, clientUploadId, text(object(args.p_context).actorId),
      lat, lng, accuracy, json(args.p_context || {})
    ]
  );
  return inserted.rows[0];
}

async function finalizeMedia(client, config, args) {
  const mediaId = required(args.p_media_id, "media_id_required");
  const result = await client.query(
    `SELECT * FROM mcp.mcp_outlet_media
     WHERE installation_id = $1 AND id = $2
     FOR UPDATE`,
    [config.installationId, mediaId]
  );
  const row = result.rows?.[0];
  if (!row) throw providerError("outlet_media_not_found", 404);
  if (row.status === "ready") return row;
  if (row.status !== "pending") throw providerError("outlet_media_not_pending", 409);
  const contentType = required(args.p_content_type, "content_type_required").toLowerCase();
  if (contentType !== row.mime_type) throw providerError("outlet_media_content_type_mismatch", 409);
  const actualByteSize = Number(args.p_actual_byte_size);
  if (!Number.isInteger(actualByteSize) || actualByteSize < 1 || actualByteSize > 5242880) {
    throw providerError("invalid_media_byte_size");
  }
  const updated = await client.query(
    `UPDATE mcp.mcp_outlet_media
     SET status = 'ready', etag = $3, actual_byte_size = $4,
         width = $5, height = $6,
         raw_payload = COALESCE(raw_payload, '{}'::jsonb) ||
           jsonb_build_object('finalized_context', $7::jsonb),
         updated_at = now()
     WHERE installation_id = $1 AND id = $2
     RETURNING *`,
    [
      config.installationId, mediaId, text(args.p_etag), actualByteSize,
      args.p_width == null ? null : Number(args.p_width),
      args.p_height == null ? null : Number(args.p_height),
      json(args.p_context || {})
    ]
  );
  return updated.rows[0];
}

async function claimMediaDelete(client, config, args) {
  const installationId = installation(config, args);
  const mediaId = required(args.p_media_id, "media_id_required");
  const result = await client.query(
    `UPDATE mcp.mcp_outlet_media
     SET status = CASE WHEN status = 'deleted' THEN status ELSE 'deleting' END,
         delete_requested_at = CASE WHEN status = 'deleted' THEN delete_requested_at ELSE COALESCE(delete_requested_at, now()) END,
         delete_attempt_count = CASE WHEN status = 'deleted' THEN delete_attempt_count ELSE delete_attempt_count + 1 END,
         last_delete_error = CASE WHEN status = 'deleted' THEN last_delete_error ELSE NULL END,
         raw_payload = COALESCE(raw_payload, '{}'::jsonb) ||
           jsonb_build_object('delete_claim_context', $3::jsonb),
         updated_at = now()
     WHERE installation_id = $1 AND id = $2
     RETURNING *`,
    [installationId, mediaId, json(args.p_context || {})]
  );
  if (!result.rows?.[0]) throw providerError("outlet_media_not_found", 404);
  return result.rows[0];
}

async function finishMediaDelete(client, config, args) {
  const installationId = installation(config, args);
  const mediaId = required(args.p_media_id, "media_id_required");
  const succeeded = args.p_succeeded === true;
  const result = await client.query(
    `UPDATE mcp.mcp_outlet_media
     SET status = CASE WHEN $3 THEN 'deleted' ELSE 'delete_failed' END,
         deleted_at = CASE WHEN $3 THEN COALESCE(deleted_at, now()) ELSE deleted_at END,
         last_delete_error = CASE WHEN $3 THEN NULL ELSE left(COALESCE(NULLIF(btrim($4), ''), 'r2_delete_failed'), 500) END,
         raw_payload = COALESCE(raw_payload, '{}'::jsonb) ||
           jsonb_build_object('delete_finish_context', $5::jsonb),
         updated_at = now()
     WHERE installation_id = $1 AND id = $2
     RETURNING *`,
    [installationId, mediaId, succeeded, text(args.p_error), json(args.p_context || {})]
  );
  if (!result.rows?.[0]) throw providerError("outlet_media_not_found", 404);
  if (succeeded) {
    await client.query(
      `UPDATE shared.customer_media
       SET status = 'deleted',
           object_key = NULL,
           updated_by = $3,
           updated_at = now()
       WHERE installation_id = $1
         AND source_app = 'MCP'
         AND source_media_id = $2
         AND status <> 'deleted'`,
      [installationId, mediaId, text(object(args.p_context).actorId)]
    );
  }
  return result.rows[0];
}

async function upsertDeleteJob(client, installationId, targetType, targetId, context) {
  const result = await client.query(
    `INSERT INTO mcp.mcp_storage_delete_jobs (
       installation_id, target_type, target_id, status, requested_by, raw_payload
     ) VALUES ($1, $2, $3, 'pending', $4,
       jsonb_build_object('request_context', $5::jsonb))
     ON CONFLICT (installation_id, target_type, target_id)
     DO UPDATE SET
       status = CASE WHEN mcp.mcp_storage_delete_jobs.status = 'completed' THEN 'completed' ELSE 'pending' END,
       requested_by = EXCLUDED.requested_by,
       last_error = NULL,
       raw_payload = COALESCE(mcp.mcp_storage_delete_jobs.raw_payload, '{}'::jsonb) || EXCLUDED.raw_payload,
       updated_at = now()
     RETURNING *`,
    [installationId, targetType, targetId, text(object(context).actorId), json(context || {})]
  );
  return result.rows[0];
}

async function claimRouteCustomerDelete(client, config, args) {
  const installationId = installation(config, args);
  const customer = await requireRouteCustomer(client, installationId, args.p_route_customer_id, true);
  const job = await upsertDeleteJob(client, installationId, "route_customer", customer.id, args.p_context);
  const updatedCustomer = await client.query(
    `UPDATE mcp.mcp_route_customers
     SET active = false,
         raw_payload = COALESCE(raw_payload, '{}'::jsonb) ||
           jsonb_build_object('hard_delete_job_id', $3, 'hard_delete_requested_context', $4::jsonb),
         updated_at = now()
     WHERE installation_id = $1 AND id = $2
     RETURNING *`,
    [installationId, customer.id, job.id, json(args.p_context || {})]
  );
  const media = await client.query(
    `UPDATE mcp.mcp_outlet_media
     SET status = 'deleting', delete_requested_at = COALESCE(delete_requested_at, now()),
         delete_attempt_count = delete_attempt_count + 1, last_delete_error = NULL, updated_at = now()
     WHERE installation_id = $1 AND route_customer_id = $2 AND status <> 'deleted'
     RETURNING *`,
    [installationId, customer.id]
  );
  return { deleteJob: job, routeCustomer: updatedCustomer.rows[0], media: media.rows || [] };
}

async function claimRouteDelete(client, config, args) {
  const installationId = installation(config, args);
  const route = await requireRoute(client, installationId, args.p_route_id, true);
  const job = await upsertDeleteJob(client, installationId, "route", route.id, args.p_context);
  const updatedRoute = await client.query(
    `UPDATE mcp.mcp_routes
     SET active = false,
         raw_payload = COALESCE(raw_payload, '{}'::jsonb) ||
           jsonb_build_object('hard_delete_job_id', $3, 'hard_delete_requested_context', $4::jsonb),
         updated_at = now()
     WHERE installation_id = $1 AND id = $2
     RETURNING *`,
    [installationId, route.id, job.id, json(args.p_context || {})]
  );
  await client.query(
    `UPDATE mcp.mcp_route_customers SET active = false, updated_at = now()
     WHERE installation_id = $1 AND route_id = $2`,
    [installationId, route.id]
  );
  const media = await client.query(
    `UPDATE mcp.mcp_outlet_media media
     SET status = 'deleting', delete_requested_at = COALESCE(media.delete_requested_at, now()),
         delete_attempt_count = media.delete_attempt_count + 1, last_delete_error = NULL, updated_at = now()
     WHERE media.installation_id = $1
       AND media.route_customer_id IN (
         SELECT id FROM mcp.mcp_route_customers WHERE installation_id = $1 AND route_id = $2
       )
       AND media.status <> 'deleted'
     RETURNING media.*`,
    [installationId, route.id]
  );
  return { deleteJob: job, route: updatedRoute.rows[0], media: media.rows || [] };
}

async function claimStaleMedia(client, config, args) {
  const installationId = installation(config, args);
  const limit = Math.max(1, Math.min(Number(args.p_limit || 50), 200));
  const result = await client.query(
    `WITH candidates AS (
       SELECT id
       FROM mcp.mcp_outlet_media
       WHERE installation_id = $1
         AND (
           (status IN ('pending', 'failed') AND created_at < $2::timestamptz)
           OR (status IN ('deleting', 'delete_failed') AND updated_at < $3::timestamptz)
         )
       ORDER BY created_at
       FOR UPDATE SKIP LOCKED
       LIMIT $4
     )
     UPDATE mcp.mcp_outlet_media media
     SET status = 'deleting', delete_requested_at = COALESCE(media.delete_requested_at, now()),
         delete_attempt_count = media.delete_attempt_count + 1,
         last_delete_error = NULL,
         raw_payload = COALESCE(media.raw_payload, '{}'::jsonb) ||
           jsonb_build_object('cleanup_claim_context', $5::jsonb),
         updated_at = now()
     FROM candidates
     WHERE media.id = candidates.id
     RETURNING media.*`,
    [installationId, args.p_pending_before, args.p_retry_before, limit, json(args.p_context || {})]
  );
  return result.rows || [];
}

async function finishDeleteJob(client, config, args) {
  const installationId = installation(config, args);
  const jobId = required(args.p_job_id, "delete_job_id_required");
  const succeeded = args.p_succeeded === true;
  const result = await client.query(
    `UPDATE mcp.mcp_storage_delete_jobs
     SET status = CASE WHEN $3 THEN 'completed' ELSE 'failed' END,
         completed_at = CASE WHEN $3 THEN now() ELSE NULL END,
         last_error = CASE WHEN $3 THEN NULL ELSE left(COALESCE(NULLIF(btrim($4), ''), 'storage_parent_delete_failed'), 500) END,
         raw_payload = COALESCE(raw_payload, '{}'::jsonb) ||
           jsonb_build_object('finish_context', $5::jsonb),
         updated_at = now()
     WHERE installation_id = $1 AND id = $2
     RETURNING *`,
    [installationId, jobId, succeeded, text(args.p_error), json(args.p_context || {})]
  );
  if (!result.rows?.[0]) throw providerError("storage_delete_job_not_found", 404);
  return result.rows[0];
}

async function claimReadyDeleteJobs(client, config, args) {
  const installationId = installation(config, args);
  const limit = Math.max(1, Math.min(Number(args.p_limit || 20), 100));
  const retryBefore = args.p_retry_before || new Date().toISOString();
  const result = await client.query(
    `WITH candidates AS (
       SELECT job.id
       FROM mcp.mcp_storage_delete_jobs job
       WHERE job.installation_id = $1
         AND job.status IN ('pending', 'failed')
         AND job.updated_at <= $2::timestamptz
         AND (
           (job.target_type = 'route_customer' AND NOT EXISTS (
             SELECT 1 FROM mcp.mcp_outlet_media media
             WHERE media.installation_id = job.installation_id
               AND media.route_customer_id = job.target_id
               AND media.status <> 'deleted'
           ))
           OR
           (job.target_type = 'route' AND NOT EXISTS (
             SELECT 1
             FROM mcp.mcp_outlet_media media
             JOIN mcp.mcp_route_customers rc
               ON rc.installation_id = media.installation_id AND rc.id = media.route_customer_id
             WHERE media.installation_id = job.installation_id
               AND rc.route_id = job.target_id
               AND media.status <> 'deleted'
           ))
         )
       ORDER BY job.requested_at
       FOR UPDATE SKIP LOCKED
       LIMIT $3
     )
     UPDATE mcp.mcp_storage_delete_jobs job
     SET status = 'finalizing', attempt_count = job.attempt_count + 1,
         last_error = NULL,
         raw_payload = COALESCE(job.raw_payload, '{}'::jsonb) ||
           jsonb_build_object('finalize_claim_context', $4::jsonb),
         updated_at = now()
     FROM candidates
     WHERE job.id = candidates.id
     RETURNING job.*`,
    [installationId, retryBefore, limit, json(args.p_context || {})]
  );
  return result.rows || [];
}

async function deleteRouteCustomerHard(client, config, args) {
  const routeCustomerId = required(args.p_route_customer_id, "route_customer_id_required");
  const pending = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM mcp.mcp_outlet_media
       WHERE installation_id = $1 AND route_customer_id = $2 AND status <> 'deleted'
     ) AS exists`,
    [config.installationId, routeCustomerId]
  );
  if (pending.rows?.[0]?.exists) throw providerError("route_customer_media_delete_incomplete", 409);
  const deleted = await client.query(
    `DELETE FROM mcp.mcp_route_customers
     WHERE installation_id = $1 AND id = $2
     RETURNING *`,
    [config.installationId, routeCustomerId]
  );
  if (!deleted.rows?.[0]) throw providerError("route_customer_not_found", 404);
  return { routeCustomerId, deleted: true };
}

async function deleteRouteHard(client, config, args) {
  const routeId = required(args.p_route_id, "route_id_required");
  const pending = await client.query(
    `SELECT EXISTS (
       SELECT 1
       FROM mcp.mcp_outlet_media media
       JOIN mcp.mcp_route_customers rc
         ON rc.installation_id = media.installation_id AND rc.id = media.route_customer_id
       WHERE media.installation_id = $1 AND rc.route_id = $2 AND media.status <> 'deleted'
     ) AS exists`,
    [config.installationId, routeId]
  );
  if (pending.rows?.[0]?.exists) throw providerError("route_media_delete_incomplete", 409);
  const deleted = await client.query(
    `DELETE FROM mcp.mcp_routes
     WHERE installation_id = $1 AND id = $2
     RETURNING *`,
    [config.installationId, routeId]
  );
  if (!deleted.rows?.[0]) throw providerError("route_not_found", 404);
  return { routeId, deleted: true };
}

async function claimArchiveIntent(client, config, args) {
  const installationId = installation(config, args);
  const operation = required(args.p_operation, "archive_operation_required");
  const idempotencyKey = required(args.p_idempotency_key, "idempotency_key_required");
  const targetType = required(args.p_target_type, "archive_target_type_required");
  const targetId = required(args.p_target_id, "archive_target_id_required");
  if (!["route.archive", "route-customer.archive"].includes(operation)) throw providerError("invalid_archive_operation");
  if (!["route", "route_customer"].includes(targetType)) throw providerError("invalid_archive_target_type");
  if ((operation === "route.archive") !== (targetType === "route")) {
    throw providerError("archive_operation_target_mismatch");
  }
  const requestPayload = object(args.p_request_payload);
  const requestHash = archiveHash(operation, requestPayload);

  const byKey = await client.query(
    `SELECT * FROM mcp.mcp_archive_intents
     WHERE installation_id = $1 AND operation = $2 AND idempotency_key = $3
     FOR UPDATE`,
    [installationId, operation, idempotencyKey]
  );
  let intent = byKey.rows?.[0] || null;
  if (intent) {
    if (intent.target_type !== targetType || intent.target_id !== targetId || intent.request_hash !== requestHash) {
      throw providerError("idempotency_key_conflict", 409);
    }
    if (intent.status === "completed") {
      const job = intent.delete_job_id
        ? (await client.query(`SELECT * FROM mcp.mcp_storage_delete_jobs WHERE installation_id = $1 AND id = $2`, [installationId, intent.delete_job_id])).rows?.[0] || null
        : null;
      return { mode: "replay", intent, deleteJob: job };
    }
    const resumed = await client.query(
      `UPDATE mcp.mcp_archive_intents
       SET status = 'processing', attempt_count = attempt_count + 1, last_error = NULL,
           raw_payload = COALESCE(raw_payload, '{}'::jsonb) ||
             jsonb_build_object('latest_request_context', $2::jsonb),
           updated_at = now()
       WHERE id = $1 RETURNING *`,
      [intent.id, json(args.p_context || {})]
    );
    intent = resumed.rows[0];
    const job = intent.delete_job_id
      ? (await client.query(`SELECT * FROM mcp.mcp_storage_delete_jobs WHERE installation_id = $1 AND id = $2`, [installationId, intent.delete_job_id])).rows?.[0] || null
      : null;
    return { mode: "resume", intent, deleteJob: job };
  }

  const byTarget = await client.query(
    `SELECT * FROM mcp.mcp_archive_intents
     WHERE installation_id = $1 AND target_type = $2 AND target_id = $3
     FOR UPDATE`,
    [installationId, targetType, targetId]
  );
  intent = byTarget.rows?.[0] || null;
  if (intent) {
    if (intent.operation !== operation || intent.request_hash !== requestHash) {
      throw providerError("archive_target_intent_conflict", 409);
    }
    if (intent.status === "completed") {
      const job = intent.delete_job_id
        ? (await client.query(`SELECT * FROM mcp.mcp_storage_delete_jobs WHERE installation_id = $1 AND id = $2`, [installationId, intent.delete_job_id])).rows?.[0] || null
        : null;
      return { mode: "replay", intent, deleteJob: job };
    }
    const resumed = await client.query(
      `UPDATE mcp.mcp_archive_intents
       SET status = 'processing', attempt_count = attempt_count + 1, last_error = NULL,
           raw_payload = COALESCE(raw_payload, '{}'::jsonb) ||
             jsonb_build_object('latest_request_context', $2::jsonb, 'latest_idempotency_key', $3),
           updated_at = now()
       WHERE id = $1 RETURNING *`,
      [intent.id, json(args.p_context || {}), idempotencyKey]
    );
    intent = resumed.rows[0];
    const job = intent.delete_job_id
      ? (await client.query(`SELECT * FROM mcp.mcp_storage_delete_jobs WHERE installation_id = $1 AND id = $2`, [installationId, intent.delete_job_id])).rows?.[0] || null
      : null;
    return { mode: "resume", intent, deleteJob: job };
  }

  const job = (await client.query(
    `SELECT * FROM mcp.mcp_storage_delete_jobs
     WHERE installation_id = $1 AND target_type = $2 AND target_id = $3
     FOR UPDATE`,
    [installationId, targetType, targetId]
  )).rows?.[0] || null;
  const inserted = await client.query(
    `INSERT INTO mcp.mcp_archive_intents (
       installation_id, operation, idempotency_key, target_type, target_id,
       request_payload, request_hash, delete_job_id, status, attempt_count,
       requested_by, raw_payload
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, 'processing', 1, $9,
       jsonb_build_object('request_context', $10::jsonb))
     RETURNING *`,
    [
      installationId, operation, idempotencyKey, targetType, targetId,
      json(requestPayload), requestHash, job?.id || null, text(object(args.p_context).actorId),
      json(args.p_context || {})
    ]
  );
  return { mode: "execute", intent: inserted.rows[0], deleteJob: job };
}

async function finishArchiveIntent(client, config, args) {
  const installationId = installation(config, args);
  const intentId = required(args.p_intent_id, "archive_intent_id_required");
  const current = await client.query(
    `SELECT * FROM mcp.mcp_archive_intents
     WHERE installation_id = $1 AND id = $2
     FOR UPDATE`,
    [installationId, intentId]
  );
  const intent = current.rows?.[0];
  if (!intent) throw providerError("archive_intent_not_found", 404);
  if (intent.status === "completed") {
    if (args.p_succeeded === true) return intent;
    throw providerError("archive_intent_already_completed", 409);
  }
  const succeeded = args.p_succeeded === true;
  const updated = await client.query(
    `UPDATE mcp.mcp_archive_intents
     SET status = CASE WHEN $3 THEN 'completed' ELSE 'failed' END,
         response_status = CASE WHEN $3 THEN COALESCE($4, 200) ELSE NULL END,
         response_payload = CASE WHEN $3 THEN COALESCE($5::jsonb, '{}'::jsonb) ELSE response_payload END,
         last_error = CASE WHEN $3 THEN NULL ELSE left(COALESCE(NULLIF(btrim($6), ''), 'archive_failed'), 500) END,
         completed_at = CASE WHEN $3 THEN now() ELSE NULL END,
         raw_payload = COALESCE(raw_payload, '{}'::jsonb) ||
           jsonb_build_object('finish_context', $7::jsonb),
         updated_at = now()
     WHERE installation_id = $1 AND id = $2
     RETURNING *`,
    [
      installationId, intentId, succeeded, args.p_response_status,
      args.p_response_payload == null ? null : json(args.p_response_payload),
      text(args.p_error), json(args.p_context || {})
    ]
  );
  return updated.rows[0];
}

export async function postgresqlSpecialRpc(config, name, args = {}) {
  if (!POSTGRESQL_SPECIAL_RPC_NAMES.has(name)) {
    throw providerError("postgresql_rpc_not_implemented", 503, { name });
  }
  try {
    return await withClient(async (client) => {
      switch (name) {
        case "mcp_search_products": return searchProducts(client, args);
        case "mcp_get_product_variants": return productVariants(client, args);
        case "mcp_prepare_outlet_media_upload": return prepareMedia(client, config, args);
        case "mcp_finalize_outlet_media_upload": return finalizeMedia(client, config, args);
        case "mcp_claim_outlet_media_delete": return claimMediaDelete(client, config, args);
        case "mcp_finish_outlet_media_delete": return finishMediaDelete(client, config, args);
        case "mcp_claim_route_customer_media_delete": return claimRouteCustomerDelete(client, config, args);
        case "mcp_claim_route_media_delete": return claimRouteDelete(client, config, args);
        case "mcp_claim_stale_outlet_media_delete": return claimStaleMedia(client, config, args);
        case "mcp_finish_storage_delete_job": return finishDeleteJob(client, config, args);
        case "mcp_claim_ready_storage_delete_jobs": return claimReadyDeleteJobs(client, config, args);
        case "mcp_delete_route_customer_hard": return deleteRouteCustomerHard(client, config, args);
        case "mcp_delete_route_hard": return deleteRouteHard(client, config, args);
        case "mcp_claim_archive_intent": return claimArchiveIntent(client, config, args);
        case "mcp_finish_archive_intent": return finishArchiveIntent(client, config, args);
        default: throw providerError("postgresql_rpc_not_implemented", 503, { name });
      }
    });
  } catch (error) {
    if (!error.providerMessage) error.providerMessage = text(error.code) || text(error.message) || "provider_request_failed";
    throw error;
  }
}

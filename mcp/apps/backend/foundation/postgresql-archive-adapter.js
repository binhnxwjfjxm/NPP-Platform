import { createHash, randomUUID } from "node:crypto";
import { providerPersistence } from "./provider-runtime.js";

export const POSTGRESQL_ARCHIVE_RPC_NAMES = Object.freeze(new Set([
  "mcp_claim_archive_intent",
  "mcp_finish_archive_intent",
  "mcp_claim_route_customer_media_delete",
  "mcp_claim_route_media_delete"
]));

function text(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function json(value) {
  return JSON.stringify(value ?? null);
}

function fail(code, statusCode = 400) {
  const error = new Error(code);
  error.code = code;
  error.providerMessage = code;
  error.statusCode = statusCode;
  throw error;
}

function installation(config, args) {
  const value = text(args.p_installation_id) || text(config.installationId);
  if (!value) fail("installation_id_required");
  if (text(args.p_installation_id) && text(config.installationId) && value !== config.installationId) {
    fail("installation_scope_mismatch", 403);
  }
  return value;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonical(value[key])])
  );
}

function requestHash(operation, payload) {
  return createHash("sha256")
    .update(JSON.stringify({ operation, payload: canonical(object(payload)) }))
    .digest("hex");
}

function context(args) {
  return object(args.p_context);
}

async function withClient(work) {
  const persistence = providerPersistence();
  await persistence.assertReady();
  return persistence.withTransaction(work);
}

async function selectIntent(client, installationId, whereSql, values) {
  const result = await client.query(
    `SELECT * FROM mcp.mcp_archive_intents
     WHERE installation_id = $1 AND ${whereSql}
     FOR UPDATE`,
    [installationId, ...values]
  );
  return result.rows?.[0] || null;
}

async function selectDeleteJob(client, installationId, jobId) {
  if (!jobId) return null;
  const result = await client.query(
    `SELECT * FROM mcp.mcp_storage_delete_jobs
     WHERE installation_id = $1 AND id = $2`,
    [installationId, jobId]
  );
  return result.rows?.[0] || null;
}

async function claimArchiveIntent(client, config, args) {
  const installationId = installation(config, args);
  const operation = text(args.p_operation);
  const idempotencyKey = text(args.p_idempotency_key);
  const targetType = text(args.p_target_type);
  const targetId = text(args.p_target_id);
  const payload = object(args.p_request_payload);
  if (!idempotencyKey) fail("idempotency_key_required");
  if (!["route.archive", "route-customer.archive"].includes(operation)) fail("invalid_archive_operation");
  if (!["route", "route_customer"].includes(targetType)) fail("invalid_archive_target_type");
  if ((operation === "route.archive") !== (targetType === "route")) fail("archive_operation_target_mismatch");
  if (!targetId) fail("archive_target_id_required");
  const hash = requestHash(operation, payload);

  let intent = await selectIntent(
    client,
    installationId,
    "operation = $2 AND idempotency_key = $3",
    [operation, idempotencyKey]
  );
  if (intent) {
    if (intent.target_type !== targetType || intent.target_id !== targetId || intent.request_hash !== hash) {
      fail("idempotency_key_conflict", 409);
    }
    const deleteJob = await selectDeleteJob(client, installationId, intent.delete_job_id);
    if (intent.status === "completed") return { mode: "replay", intent, deleteJob };
    const resumed = await client.query(
      `UPDATE mcp.mcp_archive_intents
       SET status = 'processing', attempt_count = attempt_count + 1,
           last_error = NULL,
           raw_payload = COALESCE(raw_payload, '{}'::jsonb) ||
             jsonb_build_object('latest_request_context', $2::jsonb),
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [intent.id, json(context(args))]
    );
    return { mode: "resume", intent: resumed.rows[0], deleteJob };
  }

  intent = await selectIntent(
    client,
    installationId,
    "target_type = $2 AND target_id = $3",
    [targetType, targetId]
  );
  if (intent) {
    if (intent.operation !== operation || intent.request_hash !== hash) {
      fail("archive_target_intent_conflict", 409);
    }
    const deleteJob = await selectDeleteJob(client, installationId, intent.delete_job_id);
    if (intent.status === "completed") return { mode: "replay", intent, deleteJob };
    const resumed = await client.query(
      `UPDATE mcp.mcp_archive_intents
       SET status = 'processing', attempt_count = attempt_count + 1,
           last_error = NULL,
           raw_payload = COALESCE(raw_payload, '{}'::jsonb) ||
             jsonb_build_object(
               'latest_request_context', $2::jsonb,
               'latest_idempotency_key', $3::text
             ),
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [intent.id, json(context(args)), idempotencyKey]
    );
    return { mode: "resume", intent: resumed.rows[0], deleteJob };
  }

  const existingJob = await client.query(
    `SELECT * FROM mcp.mcp_storage_delete_jobs
     WHERE installation_id = $1 AND target_type = $2 AND target_id = $3
     FOR UPDATE`,
    [installationId, targetType, targetId]
  );
  const deleteJob = existingJob.rows?.[0] || null;
  const inserted = await client.query(
    `INSERT INTO mcp.mcp_archive_intents (
       installation_id, operation, idempotency_key, target_type, target_id,
       request_payload, request_hash, delete_job_id, status, attempt_count,
       requested_by, raw_payload
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8,
       'processing', 1, $9,
       jsonb_build_object('request_context', $10::jsonb))
     RETURNING *`,
    [
      installationId, operation, idempotencyKey, targetType, targetId,
      json(payload), hash, deleteJob?.id || null,
      text(context(args).actorId), json(context(args))
    ]
  );
  return { mode: "execute", intent: inserted.rows[0], deleteJob };
}

async function appendTerminalAudit(client, intent, succeeded, args) {
  const ctx = context(args);
  await client.query(
    `INSERT INTO mcp.audit_events (
       event_id, event_type, aggregate_type, aggregate_id, aggregate_version,
       installation_id, actor_id, actor_type, employee_id, request_id,
       idempotency_key, source, action, permission, scope,
       occurred_at, payload
     ) VALUES (
       $1::uuid, $2, 'archive_intent', $3, 1,
       $4, $5, $6, NULL, $7,
       $8, 'mcp-foundation', $9, 'mcp.archive.write', NULL,
       now(), $10::jsonb
     )`,
    [
      randomUUID(),
      succeeded ? "mcp.archive.completed" : "mcp.archive.failed",
      intent.id,
      intent.installation_id,
      text(ctx.actorId) || text(intent.requested_by) || "service:mcp",
      text(ctx.actorType) || "service",
      text(ctx.requestId) || `archive:${intent.id}`,
      intent.idempotency_key,
      intent.operation,
      json({
        targetType: intent.target_type,
        targetId: intent.target_id,
        deleteJobId: intent.delete_job_id,
        succeeded,
        responseStatus: args.p_response_status ?? null,
        responsePayload: args.p_response_payload ?? null,
        error: text(args.p_error)
      })
    ]
  );
}

async function finishArchiveIntent(client, config, args) {
  const installationId = installation(config, args);
  const intentId = text(args.p_intent_id);
  if (!intentId) fail("archive_intent_id_required");
  const selected = await client.query(
    `SELECT * FROM mcp.mcp_archive_intents
     WHERE installation_id = $1 AND id = $2
     FOR UPDATE`,
    [installationId, intentId]
  );
  const intent = selected.rows?.[0];
  if (!intent) fail("archive_intent_not_found", 404);
  const succeeded = args.p_succeeded === true;
  if (intent.status === "completed") {
    if (succeeded) return intent;
    fail("archive_intent_already_completed", 409);
  }

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
      text(args.p_error), json(context(args))
    ]
  );
  await appendTerminalAudit(client, updated.rows[0], succeeded, args);
  return updated.rows[0];
}

async function upsertDeleteJob(client, installationId, targetType, targetId, args) {
  const result = await client.query(
    `INSERT INTO mcp.mcp_storage_delete_jobs (
       installation_id, target_type, target_id, status, requested_by, raw_payload
     ) VALUES ($1, $2, $3, 'pending', $4,
       jsonb_build_object('request_context', $5::jsonb))
     ON CONFLICT (installation_id, target_type, target_id)
     DO UPDATE SET
       status = CASE
         WHEN mcp.mcp_storage_delete_jobs.status = 'completed' THEN 'completed'
         ELSE 'pending'
       END,
       requested_by = EXCLUDED.requested_by,
       last_error = NULL,
       raw_payload = COALESCE(mcp.mcp_storage_delete_jobs.raw_payload, '{}'::jsonb) || EXCLUDED.raw_payload,
       updated_at = now()
     RETURNING *`,
    [installationId, targetType, targetId, text(context(args).actorId), json(context(args))]
  );
  const job = result.rows[0];
  await client.query(
    `UPDATE mcp.mcp_archive_intents
     SET delete_job_id = $4,
         raw_payload = COALESCE(raw_payload, '{}'::jsonb) ||
           jsonb_build_object('delete_job_linked_at', now()),
         updated_at = now()
     WHERE installation_id = $1
       AND target_type = $2
       AND target_id = $3
       AND status IN ('pending', 'processing', 'failed')`,
    [installationId, targetType, targetId, job.id]
  );
  return job;
}

async function requireRouteCustomer(client, installationId, id) {
  const result = await client.query(
    `SELECT * FROM mcp.mcp_route_customers
     WHERE installation_id = $1 AND id = $2
     FOR UPDATE`,
    [installationId, id]
  );
  if (!result.rows?.[0]) fail("route_customer_not_found", 404);
  return result.rows[0];
}

async function requireRoute(client, installationId, id) {
  const result = await client.query(
    `SELECT * FROM mcp.mcp_routes
     WHERE installation_id = $1 AND id = $2
     FOR UPDATE`,
    [installationId, id]
  );
  if (!result.rows?.[0]) fail("route_not_found", 404);
  return result.rows[0];
}

async function claimRouteCustomerDelete(client, config, args) {
  const installationId = installation(config, args);
  const targetId = text(args.p_route_customer_id);
  if (!targetId) fail("route_customer_id_required");
  const customer = await requireRouteCustomer(client, installationId, targetId);
  const deleteJob = await upsertDeleteJob(client, installationId, "route_customer", targetId, args);
  const routeCustomer = (await client.query(
    `UPDATE mcp.mcp_route_customers
     SET active = false,
         raw_payload = COALESCE(raw_payload, '{}'::jsonb) ||
           jsonb_build_object(
             'hard_delete_job_id', $3::text,
             'hard_delete_requested_context', $4::jsonb
           ),
         updated_at = now()
     WHERE installation_id = $1 AND id = $2
     RETURNING *`,
    [installationId, targetId, deleteJob.id, json(context(args))]
  )).rows[0];
  const media = (await client.query(
    `UPDATE mcp.mcp_outlet_media
     SET status = 'deleting',
         delete_requested_at = COALESCE(delete_requested_at, now()),
         delete_attempt_count = delete_attempt_count + 1,
         last_delete_error = NULL,
         updated_at = now()
     WHERE installation_id = $1
       AND route_customer_id = $2
       AND status <> 'deleted'
     RETURNING *`,
    [installationId, targetId]
  )).rows || [];
  return { deleteJob, routeCustomer: routeCustomer || customer, media };
}

async function claimRouteDelete(client, config, args) {
  const installationId = installation(config, args);
  const targetId = text(args.p_route_id);
  if (!targetId) fail("route_id_required");
  const route = await requireRoute(client, installationId, targetId);
  const deleteJob = await upsertDeleteJob(client, installationId, "route", targetId, args);
  const updatedRoute = (await client.query(
    `UPDATE mcp.mcp_routes
     SET active = false,
         raw_payload = COALESCE(raw_payload, '{}'::jsonb) ||
           jsonb_build_object(
             'hard_delete_job_id', $3::text,
             'hard_delete_requested_context', $4::jsonb
           ),
         updated_at = now()
     WHERE installation_id = $1 AND id = $2
     RETURNING *`,
    [installationId, targetId, deleteJob.id, json(context(args))]
  )).rows[0];
  await client.query(
    `UPDATE mcp.mcp_route_customers
     SET active = false, updated_at = now()
     WHERE installation_id = $1 AND route_id = $2`,
    [installationId, targetId]
  );
  const media = (await client.query(
    `UPDATE mcp.mcp_outlet_media media
     SET status = 'deleting',
         delete_requested_at = COALESCE(media.delete_requested_at, now()),
         delete_attempt_count = media.delete_attempt_count + 1,
         last_delete_error = NULL,
         updated_at = now()
     WHERE media.installation_id = $1
       AND media.route_customer_id IN (
         SELECT id FROM mcp.mcp_route_customers
         WHERE installation_id = $1 AND route_id = $2
       )
       AND media.status <> 'deleted'
     RETURNING media.*`,
    [installationId, targetId]
  )).rows || [];
  return { deleteJob, route: updatedRoute || route, media };
}

export async function postgresqlArchiveRpc(config, name, args = {}) {
  if (!POSTGRESQL_ARCHIVE_RPC_NAMES.has(name)) fail("postgresql_rpc_not_implemented", 503);
  try {
    return await withClient(async (client) => {
      switch (name) {
        case "mcp_claim_archive_intent": return claimArchiveIntent(client, config, args);
        case "mcp_finish_archive_intent": return finishArchiveIntent(client, config, args);
        case "mcp_claim_route_customer_media_delete": return claimRouteCustomerDelete(client, config, args);
        case "mcp_claim_route_media_delete": return claimRouteDelete(client, config, args);
        default: fail("postgresql_rpc_not_implemented", 503);
      }
    });
  } catch (error) {
    if (!error.providerMessage) error.providerMessage = text(error.code) || text(error.message) || "provider_request_failed";
    throw error;
  }
}

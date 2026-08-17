import { randomUUID } from "node:crypto";
import { providerPersistence } from "./provider-runtime.js";

export const POSTGRESQL_MEDIA_UPLOAD_RPC_NAMES = Object.freeze(new Set([
  "mcp_prepare_outlet_media_upload",
  "mcp_finalize_outlet_media_upload"
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

function safeSegment(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, "_");
}

async function withClient(work) {
  const persistence = providerPersistence();
  await persistence.assertReady();
  return persistence.withTransaction(work);
}

async function requireRouteCustomer(client, installationId, routeCustomerId) {
  const result = await client.query(
    `SELECT * FROM mcp.mcp_route_customers
     WHERE installation_id = $1 AND id = $2
     FOR UPDATE`,
    [installationId, routeCustomerId]
  );
  const row = result.rows?.[0];
  if (!row) fail("route_customer_not_found", 404);
  return row;
}

async function optionalSession(client, installationId, sessionId) {
  if (!sessionId) return null;
  const result = await client.query(
    `SELECT * FROM mcp.mcp_route_sessions
     WHERE installation_id = $1 AND id = $2
     FOR UPDATE`,
    [installationId, sessionId]
  );
  const row = result.rows?.[0];
  if (!row) fail("session_not_found", 404);
  if (row.status !== "active") fail("session_read_only", 409);
  return row;
}

async function linkedCustomer(client, installationId, coreCustomerId) {
  if (!text(coreCustomerId)) return null;
  const result = await client.query(
    `SELECT id, is_active
     FROM shared.customers
     WHERE installation_id = $1 AND id::text = $2
     FOR UPDATE`,
    [installationId, text(coreCustomerId)]
  );
  const row = result.rows?.[0];
  if (!row) fail("linked_customer_not_found", 409);
  if (row.is_active !== true) fail("linked_customer_inactive", 409);
  return row;
}

async function reserveSharedCustomerMedia(client, {
  installationId,
  customerId,
  mediaId,
  routeCustomerId,
  sessionId,
  clientUploadId,
  objectKey,
  mimeType,
  expectedByteSize,
  actorId
}) {
  await client.query(
    `INSERT INTO shared.customer_media (
       id, installation_id, customer_id, source_app, source_media_id,
       source_route_customer_id, source_session_id, client_upload_id,
       object_key, mime_type, expected_byte_size, status,
       captured_by, captured_at, created_by, updated_by
     ) VALUES ($1, $2, $3, 'MCP', $4, $5, $6, $7, $8, $9, $10, 'pending',
       $11, now(), $11, $11)`,
    [
      randomUUID(), installationId, customerId, mediaId, routeCustomerId,
      sessionId, clientUploadId, objectKey, mimeType, expectedByteSize, actorId
    ]
  );
}

async function syncSharedCustomerMediaReady(client, installationId, media, actorId) {
  await client.query(
    `UPDATE shared.customer_media
     SET actual_byte_size = $3,
         width = $4,
         height = $5,
         etag = $6,
         status = 'ready',
         updated_at = now(),
         updated_by = $7
     WHERE installation_id = $1
       AND source_app = 'MCP'
       AND source_media_id = $2
       AND status IN ('pending', 'ready')`,
    [
      installationId, media.id, Number(media.actual_byte_size),
      media.width == null ? null : Number(media.width),
      media.height == null ? null : Number(media.height),
      text(media.etag), actorId
    ]
  );
}

async function prepare(client, config, args) {
  const installationId = installation(config, args);
  const routeCustomerId = text(args.p_route_customer_id);
  const sessionId = text(args.p_session_id);
  const clientUploadId = text(args.p_client_upload_id);
  const mimeType = text(args.p_mime_type)?.toLowerCase();
  const expectedByteSize = Number(args.p_expected_byte_size);
  if (!routeCustomerId) fail("route_customer_id_required");
  if (!clientUploadId) fail("client_upload_id_required");
  if (!["image/jpeg", "image/webp", "image/png"].includes(mimeType)) fail("invalid_media_mime_type");
  if (!Number.isInteger(expectedByteSize) || expectedByteSize < 1 || expectedByteSize > 5242880) {
    fail("invalid_media_byte_size");
  }

  const lat = args.p_geo_lat == null ? null : Number(args.p_geo_lat);
  const lng = args.p_geo_lng == null ? null : Number(args.p_geo_lng);
  const accuracy = args.p_geo_accuracy == null ? null : Number(args.p_geo_accuracy);
  if ((lat === null) !== (lng === null)) fail("geo_coordinates_incomplete");
  if (lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) fail("invalid_geo_lat");
  if (lng !== null && (!Number.isFinite(lng) || lng < -180 || lng > 180)) fail("invalid_geo_lng");
  if (accuracy !== null && (!Number.isFinite(accuracy) || accuracy < 0)) fail("invalid_geo_accuracy");

  const customer = await requireRouteCustomer(client, installationId, routeCustomerId);
  const session = await optionalSession(client, installationId, sessionId);
  if (session && session.route_id !== customer.route_id) fail("route_customer_route_mismatch");

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
      text(row.session_id) !== sessionId ||
      row.mime_type !== mimeType ||
      Number(row.expected_byte_size) !== expectedByteSize
    ) {
      fail("outlet_media_upload_conflict", 409);
    }
    return row;
  }

  const sharedCustomer = await linkedCustomer(client, installationId, customer.core_customer_id);
  if (sharedCustomer) {
    const active = await client.query(
      `SELECT count(*)::integer AS count
       FROM shared.customer_media
       WHERE installation_id = $1
         AND customer_id = $2
         AND status IN ('pending', 'ready')`,
      [installationId, sharedCustomer.id]
    );
    if (Number(active.rows?.[0]?.count || 0) >= 3) fail("outlet_media_limit_reached", 409);
  } else {
    const active = await client.query(
      `SELECT count(*)::integer AS count
       FROM mcp.mcp_outlet_media
       WHERE installation_id = $1
         AND route_customer_id = $2
         AND status IN ('pending', 'ready', 'deleting', 'delete_failed')`,
      [installationId, routeCustomerId]
    );
    if (Number(active.rows?.[0]?.count || 0) >= 3) fail("outlet_media_limit_reached", 409);
  }

  const id = `mom_${randomUUID().replaceAll("-", "")}`;
  const extension = mimeType === "image/webp" ? "webp" : mimeType === "image/png" ? "png" : "jpg";
  const objectKey = `mcp-plan/outlets/${safeSegment(installationId)}/${safeSegment(routeCustomerId)}/${id}.${extension}`;
  const actorId = text(object(args.p_context).actorId);
  const inserted = await client.query(
    `INSERT INTO mcp.mcp_outlet_media (
       id, installation_id, route_customer_id, session_id, object_key,
       media_type, mime_type, expected_byte_size, client_upload_id,
       captured_by, geo_lat, geo_lng, geo_accuracy, raw_payload
     ) VALUES ($1, $2, $3, $4, $5, 'storefront', $6, $7, $8, $9, $10, $11, $12,
       jsonb_build_object('foundation_context', $13::jsonb))
     RETURNING *`,
    [
      id, installationId, routeCustomerId, sessionId, objectKey,
      mimeType, expectedByteSize, clientUploadId,
      actorId, lat, lng, accuracy,
      json(args.p_context || {})
    ]
  );
  if (sharedCustomer) {
    await reserveSharedCustomerMedia(client, {
      installationId,
      customerId: sharedCustomer.id,
      mediaId: id,
      routeCustomerId,
      sessionId,
      clientUploadId,
      objectKey,
      mimeType,
      expectedByteSize,
      actorId
    });
  }
  return inserted.rows[0];
}

async function finalize(client, config, args) {
  const mediaId = text(args.p_media_id);
  if (!mediaId) fail("media_id_required");
  const installationId = text(config.installationId);
  if (!installationId) fail("installation_id_required");
  const selected = await client.query(
    `SELECT * FROM mcp.mcp_outlet_media
     WHERE installation_id = $1 AND id = $2
     FOR UPDATE`,
    [installationId, mediaId]
  );
  const row = selected.rows?.[0];
  if (!row) fail("outlet_media_not_found", 404);
  const actorId = text(object(args.p_context).actorId);
  if (row.status === "ready") {
    await syncSharedCustomerMediaReady(client, installationId, row, actorId);
    return row;
  }
  if (row.status !== "pending") fail("outlet_media_not_pending", 409);

  const contentType = text(args.p_content_type)?.toLowerCase();
  if (contentType !== row.mime_type) fail("outlet_media_content_type_mismatch", 409);
  const actualByteSize = Number(args.p_actual_byte_size);
  if (!Number.isInteger(actualByteSize) || actualByteSize < 1 || actualByteSize > 5242880) {
    fail("invalid_media_byte_size");
  }
  const updated = await client.query(
    `UPDATE mcp.mcp_outlet_media
     SET status = 'ready',
         etag = $3,
         actual_byte_size = $4,
         width = $5,
         height = $6,
         raw_payload = COALESCE(raw_payload, '{}'::jsonb) ||
           jsonb_build_object('finalized_context', $7::jsonb),
         updated_at = now()
     WHERE installation_id = $1 AND id = $2
     RETURNING *`,
    [
      installationId, mediaId, text(args.p_etag), actualByteSize,
      args.p_width == null ? null : Number(args.p_width),
      args.p_height == null ? null : Number(args.p_height),
      json(args.p_context || {})
    ]
  );
  await syncSharedCustomerMediaReady(client, installationId, updated.rows[0], actorId);
  return updated.rows[0];
}

export async function postgresqlMediaUploadRpc(config, name, args = {}) {
  if (!POSTGRESQL_MEDIA_UPLOAD_RPC_NAMES.has(name)) fail("postgresql_rpc_not_implemented", 503);
  try {
    return await withClient((client) => name === "mcp_prepare_outlet_media_upload"
      ? prepare(client, config, args)
      : finalize(client, config, args));
  } catch (error) {
    if (!error.providerMessage) error.providerMessage = text(error.code) || text(error.message) || "provider_request_failed";
    throw error;
  }
}

import { executeWriteCommand } from "./write-command.js";
import { createPostgresqlWriteTransaction } from "./postgresql-write-repository.js";
import { providerPersistence } from "./provider-runtime.js";

export const POSTGRESQL_CHECKIN_RPC_NAMES = Object.freeze(new Set([
  "mcp_idempotent_set_session_customer_checkin"
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

function requestContext(config, args) {
  const source = object(args?.p_context);
  return Object.freeze({
    requestId: text(source.requestId) || `req_checkin_${Date.now()}`,
    installation: Object.freeze({
      id: text(source.installationId) || config.installationId,
      nppCode: text(source.nppCode) || config.nppCode
    }),
    actor: Object.freeze({
      id: text(source.actorId) || config.legacyActorId,
      type: text(source.actorType) || "service",
      authentication: text(source.actorAuthentication) || "backend-token"
    }),
    principal: config.servicePrincipal,
    auth: Object.freeze({ mode: config.authMode, authenticated: true }),
    idempotencyKey: text(source.idempotencyKey),
    receivedAt: text(source.receivedAt) || new Date().toISOString()
  });
}

function coordinate(value, code, min, max, { optional = false } = {}) {
  if (value == null || value === "") {
    if (optional) return null;
    fail(code);
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) fail(code);
  return number;
}

function sessionCustomerResult(row) {
  return {
    id: row.id,
    sessionCustomerId: row.id,
    sessionId: row.session_id,
    routeId: row.route_id,
    routeCustomerId: row.route_customer_id,
    customerId: row.customer_id,
    customerName: row.customer_name,
    accountName: row.account_name,
    phone: row.phone,
    area: row.area,
    address: row.address,
    sortOrder: row.sort_order,
    source: row.source,
    status: row.status,
    visitStatus: row.visit_status,
    statusReason: row.status_reason,
    orderId: row.order_id,
    testId: row.test_id,
    reportId: row.report_id,
    followupCount: row.followup_count,
    checkedIn: row.checked_in,
    checkinAt: row.checkin_at,
    checkinLat: row.checkin_lat,
    checkinLng: row.checkin_lng,
    checkinAccuracy: row.checkin_accuracy,
    checkinSource: row.checkin_source,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function executeCheckin(client, args, context) {
  const installationId = text(context?.installation?.id);
  const sessionCustomerId = text(args.p_session_customer_id);
  if (!installationId) fail("installation_id_required");
  if (!sessionCustomerId) fail("session_customer_id_required");

  const selected = await client.query(
    `SELECT sc.*, s.status AS session_status
     FROM mcp.mcp_session_customers sc
     JOIN mcp.mcp_route_sessions s
       ON s.id = sc.session_id AND s.installation_id = sc.installation_id
     WHERE sc.installation_id = $1 AND sc.id = $2
     FOR UPDATE OF sc, s`,
    [installationId, sessionCustomerId]
  );
  const row = selected.rows?.[0];
  if (!row) fail("session_customer_not_found", 404);
  if (row.session_status !== "active") fail("session_read_only", 409);

  const checkedIn = args.p_checked_in === true;
  const lat = checkedIn ? coordinate(args.p_geo_lat, "invalid_geo_lat", -90, 90) : null;
  const lng = checkedIn ? coordinate(args.p_geo_lng, "invalid_geo_lng", -180, 180) : null;
  const accuracy = checkedIn
    ? coordinate(args.p_geo_accuracy, "invalid_geo_accuracy", 0, Number.MAX_SAFE_INTEGER, { optional: true })
    : null;

  const updated = await client.query(
    `UPDATE mcp.mcp_session_customers
     SET checked_in = $3,
         checkin_at = CASE WHEN $3 THEN now() ELSE NULL END,
         checkin_lat = CASE WHEN $3 THEN $4::numeric ELSE NULL END,
         checkin_lng = CASE WHEN $3 THEN $5::numeric ELSE NULL END,
         checkin_accuracy = CASE WHEN $3 THEN $6::numeric ELSE NULL END,
         checkin_source = CASE WHEN $3 THEN $7 ELSE NULL END,
         raw_payload = jsonb_set(
           COALESCE(raw_payload, '{}'::jsonb),
           '{foundation_context}',
           $8::jsonb,
           true
         ),
         updated_at = now()
     WHERE installation_id = $1 AND id = $2
     RETURNING *`,
    [
      installationId,
      sessionCustomerId,
      checkedIn,
      lat,
      lng,
      accuracy,
      checkedIn ? text(args.p_geo_source) : null,
      json(args.p_context || {})
    ]
  );
  return sessionCustomerResult(updated.rows[0]);
}

function repositoryFactory(client) {
  return Object.freeze({
    checkin: Object.freeze({
      execute(args, context) {
        return executeCheckin(client, args, context);
      }
    })
  });
}

export async function postgresqlCheckinRpc(config, name, args = {}) {
  if (!POSTGRESQL_CHECKIN_RPC_NAMES.has(name)) fail("postgresql_rpc_not_implemented", 503);
  try {
    const context = requestContext(config, args);
    const transaction = createPostgresqlWriteTransaction(providerPersistence(), {
      domainRepositoryFactory: repositoryFactory
    });
    return await executeWriteCommand({
      context,
      commandName: "mcp.session-customer.checkin",
      permission: "mcp.session-customer.write",
      payload: Object.fromEntries(Object.entries(args).filter(([key]) => key !== "p_context")),
      aggregate: (result) => ({
        type: "session_customer",
        id: text(result?.sessionCustomerId ?? result?.id) || "unknown",
        version: 1
      }),
      eventType: "mcp.session-customer.checkin-updated",
      transaction,
      mutate: (tx) => tx.repositories.checkin.execute(args, context)
    });
  } catch (error) {
    if (!error.providerMessage) {
      error.providerMessage = text(error.code) || text(error.message) || "provider_request_failed";
    }
    throw error;
  }
}

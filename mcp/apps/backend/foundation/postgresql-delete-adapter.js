import { providerPersistence } from "./provider-runtime.js";

export const POSTGRESQL_DELETE_RPC_NAMES = Object.freeze(new Set([
  "mcp_delete_route_customer_hard",
  "mcp_delete_route_hard"
]));

function text(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function fail(code, statusCode = 400) {
  const error = new Error(code);
  error.code = code;
  error.providerMessage = code;
  error.statusCode = statusCode;
  throw error;
}

function required(value, code) {
  const normalized = text(value);
  if (!normalized) fail(code);
  return normalized;
}

function installation(config, args) {
  const configured = text(config.installationId);
  const requested = text(args.p_installation_id);
  const installationId = requested || configured;
  if (!installationId) fail("installation_id_required");
  if (requested && configured && requested !== configured) fail("installation_scope_mismatch", 403);
  return installationId;
}

async function deleteRouteCustomer(client, installationId, args) {
  const routeCustomerId = required(args.p_route_customer_id, "route_customer_id_required");
  const pending = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM mcp.mcp_outlet_media
       WHERE installation_id = $1
         AND route_customer_id = $2
         AND status <> 'deleted'
     ) AS exists`,
    [installationId, routeCustomerId]
  );
  if (pending.rows?.[0]?.exists) fail("route_customer_media_delete_incomplete", 409);

  const deleted = await client.query(
    `DELETE FROM mcp.mcp_route_customers
     WHERE installation_id = $1 AND id = $2
     RETURNING id`,
    [installationId, routeCustomerId]
  );
  if (!deleted.rows?.[0]) fail("route_customer_not_found", 404);
  return { routeCustomerId, deleted: true };
}

async function deleteRoute(client, installationId, args) {
  const routeId = required(args.p_route_id, "route_id_required");
  const pending = await client.query(
    `SELECT EXISTS (
       SELECT 1
       FROM mcp.mcp_outlet_media media
       JOIN mcp.mcp_route_customers route_customer
         ON route_customer.installation_id = media.installation_id
        AND route_customer.id = media.route_customer_id
       WHERE media.installation_id = $1
         AND route_customer.route_id = $2
         AND media.status <> 'deleted'
     ) AS exists`,
    [installationId, routeId]
  );
  if (pending.rows?.[0]?.exists) fail("route_media_delete_incomplete", 409);

  const deleted = await client.query(
    `DELETE FROM mcp.mcp_routes
     WHERE installation_id = $1 AND id = $2
     RETURNING id`,
    [installationId, routeId]
  );
  if (!deleted.rows?.[0]) fail("route_not_found", 404);
  return { routeId, deleted: true };
}

export async function postgresqlDeleteRpc(config, name, args = {}) {
  if (!POSTGRESQL_DELETE_RPC_NAMES.has(name)) fail("postgresql_rpc_not_implemented", 503);
  const installationId = installation(config, args);
  const persistence = providerPersistence();
  await persistence.assertReady();
  return persistence.withTransaction(async (client) => {
    if (name === "mcp_delete_route_customer_hard") {
      return deleteRouteCustomer(client, installationId, args);
    }
    return deleteRoute(client, installationId, args);
  });
}

import { executeWriteCommand } from "./write-command.js";
import { createPostgresqlWriteTransaction } from "./postgresql-write-repository.js";
import { providerPersistence } from "./provider-runtime.js";

export const POSTGRESQL_SESSION_RPC_NAMES = Object.freeze(new Set([
  "mcp_idempotent_open_route_session"
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
  const source = object(args.p_context);
  const installationId = text(source.installationId) || text(config.installationId);
  if (!installationId) fail("installation_id_required");
  if (text(source.installationId) && text(config.installationId) && installationId !== config.installationId) {
    fail("installation_scope_mismatch", 403);
  }
  return Object.freeze({
    requestId: text(source.requestId) || `req_session_${Date.now()}`,
    idempotencyKey: text(source.idempotencyKey),
    receivedAt: text(source.receivedAt) || new Date().toISOString(),
    installation: Object.freeze({
      id: installationId,
      nppCode: text(source.nppCode) || text(config.nppCode)
    }),
    actor: Object.freeze({
      id: text(source.actorId) || text(config.legacyActorId) || "service:mcp",
      type: text(source.actorType) || "service",
      authentication: text(source.actorAuthentication) || "backend-token"
    }),
    principal: config.servicePrincipal,
    auth: Object.freeze({ mode: config.authMode, authenticated: true })
  });
}

function sessionResult(row) {
  return {
    id: row.id,
    sessionId: row.id,
    routeId: row.route_id,
    routeName: row.route_name,
    sessionDate: row.session_date,
    sales: row.sales,
    area: row.area,
    status: row.status,
    plannedCustomers: row.planned_customers,
    visitedCustomers: row.visited_customers,
    orderCount: row.order_count,
    testCount: row.test_count,
    reportCount: row.report_count,
    followupCount: row.followup_count,
    note: row.note,
    openedAt: row.opened_at,
    closedAt: row.closed_at
  };
}

async function finalizeStaleSession(client, context, routeId, requestedDate) {
  const active = await client.query(
    `SELECT *, session_date::text AS session_date_text
     FROM mcp.mcp_route_sessions
     WHERE installation_id = $1 AND route_id = $2 AND status = 'active'
     FOR UPDATE`,
    [context.installation.id, routeId]
  );
  const session = active.rows?.[0];
  if (!session) return;
  if (session.session_date_text >= requestedDate) fail("active_session_already_exists", 409);

  await client.query(
    `WITH stats AS (
       SELECT
         COUNT(*)::integer AS planned,
         COUNT(*) FILTER (WHERE visit_status = 'visited')::integer AS visited,
         COUNT(*) FILTER (WHERE order_id IS NOT NULL)::integer AS orders,
         COUNT(*) FILTER (WHERE test_id IS NOT NULL)::integer AS tests,
         COUNT(*) FILTER (WHERE report_id IS NOT NULL)::integer AS reports,
         COALESCE(SUM(followup_count), 0)::integer AS followups
       FROM mcp.mcp_session_customers
       WHERE installation_id = $1 AND session_id = $2
     )
     UPDATE mcp.mcp_route_sessions session
     SET status = 'done',
         planned_customers = stats.planned,
         visited_customers = stats.visited,
         order_count = stats.orders,
         test_count = stats.tests,
         report_count = stats.reports,
         followup_count = stats.followups,
         closed_at = COALESCE(session.closed_at, now()),
         raw_payload = COALESCE(session.raw_payload, '{}'::jsonb) ||
           jsonb_build_object(
             'auto_closed_for_session_date', $3::text,
             'auto_closed_context', $4::jsonb
           ),
         updated_at = now()
     FROM stats
     WHERE session.installation_id = $1 AND session.id = $2`,
    [context.installation.id, session.id, requestedDate, json({ requestId: context.requestId, actorId: context.actor.id })]
  );
}

async function openRouteSession(client, args, context) {
  const routeId = text(args.p_route_id);
  const sessionDate = text(args.p_session_date)?.slice(0, 10);
  if (!routeId) fail("route_id_required");
  if (!sessionDate || !/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) fail("invalid_session_date");

  const selectedRoute = await client.query(
    `SELECT * FROM mcp.mcp_routes
     WHERE installation_id = $1 AND id = $2 AND active IS TRUE
     FOR UPDATE`,
    [context.installation.id, routeId]
  );
  const route = selectedRoute.rows?.[0];
  if (!route) fail("route_inactive_or_not_found", 404);

  await finalizeStaleSession(client, context, route.id, sessionDate);

  const count = await client.query(
    `SELECT COUNT(*)::integer AS count
     FROM mcp.mcp_route_customers
     WHERE installation_id = $1 AND route_id = $2 AND active IS TRUE`,
    [context.installation.id, route.id]
  );
  const created = await client.query(
    `INSERT INTO mcp.mcp_route_sessions (
       installation_id, route_id, route_name, session_date, sales, area, status,
       planned_customers, opened_at, raw_payload
     ) VALUES ($1, $2, $3, $4::date, $5, $6, 'active', $7, now(),
       jsonb_build_object('foundation_context', $8::jsonb))
     RETURNING *`,
    [
      context.installation.id,
      route.id,
      route.route_name,
      sessionDate,
      text(args.p_owner) || route.sales,
      route.area,
      Number(count.rows?.[0]?.count || 0),
      json(args.p_context || {})
    ]
  );
  const session = created.rows[0];
  await client.query(
    `INSERT INTO mcp.mcp_session_customers (
       installation_id, session_id, route_id, route_customer_id, customer_id,
       customer_name, account_name, phone, area, address, sort_order, source, note, raw_payload
     )
     SELECT installation_id, $3, route_id, id, customer_id,
            customer_name, customer_name, phone, area, address, sort_order, 'planned', note,
            jsonb_build_object('route_customer_snapshot', to_jsonb(route_customer))
     FROM mcp.mcp_route_customers route_customer
     WHERE installation_id = $1 AND route_id = $2 AND active IS TRUE
     ORDER BY sort_order, id`,
    [context.installation.id, route.id, session.id]
  );
  return sessionResult(session);
}

function repositoryFactory(client) {
  return Object.freeze({
    session: Object.freeze({
      open(args, context) {
        return openRouteSession(client, args, context);
      }
    })
  });
}

export async function postgresqlSessionRpc(config, name, args = {}) {
  if (!POSTGRESQL_SESSION_RPC_NAMES.has(name)) fail("postgresql_rpc_not_implemented", 503);
  try {
    const context = requestContext(config, args);
    const persistence = providerPersistence();
    const transaction = createPostgresqlWriteTransaction(persistence, {
      domainRepositoryFactory: repositoryFactory
    });
    return await executeWriteCommand({
      context,
      commandName: "mcp.session.open",
      permission: "mcp.session.write",
      payload: Object.fromEntries(Object.entries(args).filter(([key]) => key !== "p_context")),
      aggregate: (result) => ({ type: "route_session", id: result.sessionId, version: 1 }),
      eventType: "mcp.session.opened",
      transaction,
      mutate: (tx) => tx.repositories.session.open(args, context)
    });
  } catch (error) {
    if (!error.providerMessage) error.providerMessage = text(error.code) || text(error.message) || "provider_request_failed";
    throw error;
  }
}

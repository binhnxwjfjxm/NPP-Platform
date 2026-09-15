const MCP_SHELL_PATH = "/api/local-read/mcp-shell";
const RECENT_SESSION_DAYS = 45;
const RECENT_SESSION_LIMIT = 1200;

function text(value) {
  return String(value ?? "").trim();
}

function localReadError(code, statusCode = 400) {
  const error = new Error(code);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

async function readCursor(client, installationId) {
  const result = await client.query(
    `SELECT md5(concat_ws('|',
       COALESCE((SELECT MAX(updated_at)::text FROM mcp.mcp_routes WHERE installation_id = $1), ''),
       (SELECT COUNT(*)::text FROM mcp.mcp_routes WHERE installation_id = $1),
       COALESCE((SELECT MAX(updated_at)::text FROM mcp.mcp_route_customers WHERE installation_id = $1), ''),
       (SELECT COUNT(*)::text FROM mcp.mcp_route_customers WHERE installation_id = $1),
       COALESCE((SELECT MAX(updated_at)::text FROM mcp.mcp_route_sessions WHERE installation_id = $1), ''),
       (SELECT COUNT(*)::text FROM mcp.mcp_route_sessions WHERE installation_id = $1),
       COALESCE((SELECT MAX(updated_at)::text FROM mcp.mcp_session_customers WHERE installation_id = $1), ''),
       (SELECT COUNT(*)::text FROM mcp.mcp_session_customers WHERE installation_id = $1),
       COALESCE((SELECT MAX(updated_at)::text FROM mcp.mcp_session_reports WHERE installation_id = $1), ''),
       (SELECT COUNT(*)::text FROM mcp.mcp_session_reports WHERE installation_id = $1)
     )) AS cursor`,
    [installationId]
  );
  const cursor = text(result.rows?.[0]?.cursor);
  if (!cursor) throw localReadError("mcp_local_read_cursor_unavailable", 500);
  return cursor;
}

async function readSnapshot(client, installationId) {
  const routesResult = await client.query(
    `SELECT id, route_name, area, active, sales, updated_at
       FROM mcp.mcp_routes
      WHERE installation_id = $1
      ORDER BY route_name ASC, id ASC`,
    [installationId]
  );

  const customersResult = await client.query(
    `SELECT id, route_id, customer_id, customer_name, phone, area, address,
            sort_order, active, note, geo_lat, geo_lng, geo_accuracy,
            geo_captured_at, updated_at
       FROM mcp.mcp_route_customers
      WHERE installation_id = $1
      ORDER BY route_id ASC, sort_order ASC, id ASC`,
    [installationId]
  );

  const latestSessionsResult = await client.query(
    `SELECT DISTINCT ON (route_id)
            id, route_id, route_name, session_date, sales, status,
            planned_customers, visited_customers, order_count, test_count,
            report_count, followup_count, note, opened_at, closed_at,
            created_at, updated_at
       FROM mcp.mcp_route_sessions
      WHERE installation_id = $1
      ORDER BY route_id, session_date DESC, updated_at DESC, id DESC`,
    [installationId]
  );

  const recentSessionsResult = await client.query(
    `SELECT id, route_id, route_name, session_date, sales, status,
            planned_customers, visited_customers, order_count, test_count,
            report_count, followup_count, note, opened_at, closed_at,
            created_at, updated_at
       FROM mcp.mcp_route_sessions
      WHERE installation_id = $1
        AND session_date >= CURRENT_DATE - $2::integer
      ORDER BY session_date DESC, updated_at DESC, id DESC
      LIMIT $3`,
    [installationId, RECENT_SESSION_DAYS, RECENT_SESSION_LIMIT]
  );

  const latestSessionIds = (latestSessionsResult.rows || []).map((row) => text(row.id)).filter(Boolean);
  const latestReportsResult = latestSessionIds.length
    ? await client.query(
        `SELECT DISTINCT ON (session_id)
                id, session_id, route_id, route_name, session_date, sales, status,
                overview, snapshot_at, created_at, updated_at
           FROM mcp.mcp_session_reports
          WHERE installation_id = $1
            AND session_id = ANY($2::text[])
          ORDER BY session_id, snapshot_at DESC NULLS LAST, updated_at DESC, id DESC`,
        [installationId, latestSessionIds]
      )
    : { rows: [] };

  const recentSessionIds = (recentSessionsResult.rows || []).map((row) => text(row.id)).filter(Boolean);
  const aggregatesResult = recentSessionIds.length
    ? await client.query(
        `SELECT session_id,
                COUNT(*)::integer AS planned,
                COUNT(*) FILTER (WHERE visit_status = 'visited')::integer AS visited,
                COUNT(*) FILTER (WHERE NULLIF(order_id, '') IS NOT NULL)::integer AS orders,
                COUNT(*) FILTER (WHERE NULLIF(test_id, '') IS NOT NULL)::integer AS tests,
                COUNT(*) FILTER (WHERE NULLIF(report_id, '') IS NOT NULL)::integer AS reports,
                COALESCE(SUM(followup_count), 0)::integer AS followups
           FROM mcp.mcp_session_customers
          WHERE installation_id = $1
            AND session_id = ANY($2::text[])
          GROUP BY session_id`,
        [installationId, recentSessionIds]
      )
    : { rows: [] };

  return {
    generatedAt: new Date().toISOString(),
    recentSessionDays: RECENT_SESSION_DAYS,
    routes: routesResult.rows || [],
    routeCustomers: customersResult.rows || [],
    latestSessions: latestSessionsResult.rows || [],
    latestReports: latestReportsResult.rows || [],
    recentSessions: recentSessionsResult.rows || [],
    recentSessionAggregates: aggregatesResult.rows || []
  };
}

export async function handleLocalReadApi(req, url, context, _config, { persistence } = {}) {
  const method = String(req.method || "GET").toUpperCase();
  if (method !== "GET" || url.pathname !== MCP_SHELL_PATH) return null;
  if (!persistence || typeof persistence.assertReady !== "function" || typeof persistence.withTransaction !== "function") {
    throw localReadError("provider_unavailable", 503);
  }

  const installationId = text(context?.installation?.id);
  if (!installationId) throw localReadError("installation_context_required", 500);
  const requestedCursor = text(url.searchParams.get("cursor"));

  await persistence.assertReady();
  const data = await persistence.withTransaction(async (client) => {
    const cursor = await readCursor(client, installationId);
    if (requestedCursor && requestedCursor === cursor) {
      return { cursor, unchanged: true, snapshot: null };
    }
    return { cursor, unchanged: false, snapshot: await readSnapshot(client, installationId) };
  });

  return { statusCode: 200, payload: { data, receivedAt: new Date().toISOString() } };
}

export const localReadApiInternals = Object.freeze({ MCP_SHELL_PATH, RECENT_SESSION_DAYS, RECENT_SESSION_LIMIT });

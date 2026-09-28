const MCP_SHELL_PATH = "/api/local-read/mcp-shell";
const MCP_REPORT_HISTORY_PATH = "/api/local-read/mcp-session-reports";
const MCP_REPORT_DETAIL_PATH = "/api/local-read/mcp-session-report";
const MCP_FOLLOWUPS_PATH = "/api/local-read/mcp-followups";
const MCP_OUTLET_HISTORY_PATH = "/api/local-read/mcp-outlet-history";
const RECENT_SESSION_DAYS = 45;
const RECENT_SESSION_LIMIT = 1200;
const REPORT_HISTORY_LIMIT = 240;
const FOLLOWUP_HISTORY_DAYS = 45;
const FOLLOWUP_LIMIT = 500;

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
    `WITH route_state AS (
       SELECT MAX(updated_at)::text AS max_updated, COUNT(*)::text AS row_count
         FROM mcp.mcp_routes
        WHERE installation_id = $1
     ), route_customer_state AS (
       SELECT MAX(updated_at)::text AS max_updated, COUNT(*)::text AS row_count
         FROM mcp.mcp_route_customers
        WHERE installation_id = $1
     ), session_state AS (
       SELECT MAX(updated_at)::text AS max_updated, COUNT(*)::text AS row_count
         FROM mcp.mcp_route_sessions
        WHERE installation_id = $1
     ), session_customer_state AS (
       SELECT MAX(updated_at)::text AS max_updated, COUNT(*)::text AS row_count
         FROM mcp.mcp_session_customers
        WHERE installation_id = $1
     ), report_state AS (
       SELECT MAX(updated_at)::text AS max_updated, COUNT(*)::text AS row_count
         FROM mcp.mcp_session_reports
        WHERE installation_id = $1
     )
     SELECT md5(concat_ws('|',
       COALESCE(route_state.max_updated, ''), route_state.row_count,
       COALESCE(route_customer_state.max_updated, ''), route_customer_state.row_count,
       COALESCE(session_state.max_updated, ''), session_state.row_count,
       COALESCE(session_customer_state.max_updated, ''), session_customer_state.row_count,
       COALESCE(report_state.max_updated, ''), report_state.row_count
     )) AS cursor
       FROM route_state, route_customer_state, session_state, session_customer_state, report_state`,
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
                overview, sections, snapshot_at, created_at, updated_at
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

async function readReportHistory(client, installationId) {
  const result = await client.query(
    `SELECT *
       FROM (
         SELECT DISTINCT ON (report.session_id)
                report.id, report.session_id, report.route_id, report.route_name,
                report.session_date, report.sales, report.status,
                report.overview, report.sections, report.snapshot_source,
                report.snapshot_at, report.created_at, report.updated_at,
                session.status AS session_status,
                session.planned_customers, session.visited_customers,
                session.order_count, session.test_count, session.report_count,
                session.followup_count
           FROM mcp.mcp_session_reports report
           JOIN mcp.mcp_route_sessions session
             ON session.installation_id = report.installation_id
            AND session.id = report.session_id
          WHERE report.installation_id = $1
            AND session.session_date >= CURRENT_DATE - $2::integer
          ORDER BY report.session_id,
                   report.snapshot_at DESC NULLS LAST,
                   report.updated_at DESC,
                   report.id DESC
       ) recent
      ORDER BY session_date DESC, snapshot_at DESC NULLS LAST, updated_at DESC, id DESC
      LIMIT $3`,
    [installationId, RECENT_SESSION_DAYS, REPORT_HISTORY_LIMIT]
  );
  return {
    days: RECENT_SESSION_DAYS,
    reports: result.rows || []
  };
}

async function readFollowups(client, installationId) {
  const result = await client.query(
    `SELECT followup.id,
            followup.session_id,
            followup.session_customer_id,
            followup.route_id,
            COALESCE(session.route_name, route.route_name, '') AS route_name,
            followup.route_customer_id,
            followup.customer_id,
            followup.customer_name,
            followup.followup_type,
            followup.title,
            followup.due_date,
            followup.status,
            followup.priority,
            followup.owner,
            followup.note,
            session.session_date,
            followup.created_at,
            followup.updated_at
       FROM mcp.mcp_followups followup
       LEFT JOIN mcp.mcp_route_sessions session
         ON session.installation_id = followup.installation_id
        AND session.id = followup.session_id
       LEFT JOIN mcp.mcp_routes route
         ON route.installation_id = followup.installation_id
        AND route.id = followup.route_id
      WHERE followup.installation_id = $1
        AND (
          COALESCE(lower(followup.status), 'pending') NOT IN
            ('done', 'completed', 'closed', 'cancelled')
          OR followup.created_at >= CURRENT_DATE - $2::integer
        )
      ORDER BY
        CASE
          WHEN COALESCE(lower(followup.status), 'pending') IN
            ('done', 'completed', 'closed', 'cancelled') THEN 1
          ELSE 0
        END ASC,
        followup.due_date ASC NULLS LAST,
        followup.updated_at DESC,
        followup.id DESC
      LIMIT $3`,
    [installationId, FOLLOWUP_HISTORY_DAYS, FOLLOWUP_LIMIT]
  );

  return {
    days: FOLLOWUP_HISTORY_DAYS,
    items: result.rows || []
  };
}

async function readOutletHistory(client, installationId, routeCustomerId) {
  const result = await client.query(
    `SELECT session_customer.id AS session_customer_id,
            session_customer.session_id,
            session_customer.route_id,
            session_customer.route_customer_id,
            session_customer.customer_id,
            session_customer.customer_name,
            session_customer.account_name,
            session_customer.phone,
            session_customer.area,
            session_customer.address,
            session_customer.source,
            session_customer.status,
            session_customer.visit_status,
            session_customer.status_reason,
            session_customer.order_id,
            session_customer.test_id,
            session_customer.report_id,
            session_customer.followup_count,
            session_customer.note,
            session_customer.checkin_at,
            session_customer.checkin_lat,
            session_customer.checkin_lng,
            session_customer.checkin_accuracy,
            session_customer.checkin_source,
            session_customer.created_at,
            session_customer.updated_at,
            route_session.route_name,
            route_session.session_date,
            route_session.sales,
            route_session.status AS session_status,
            route_session.opened_at,
            route_session.closed_at
       FROM mcp.mcp_session_customers session_customer
       JOIN mcp.mcp_route_sessions route_session
         ON route_session.installation_id = session_customer.installation_id
        AND route_session.id = session_customer.session_id
      WHERE session_customer.installation_id = $1
        AND session_customer.route_customer_id = $2
      ORDER BY route_session.session_date DESC,
               session_customer.updated_at DESC,
               session_customer.id DESC`,
    [installationId, routeCustomerId]
  );

  return {
    routeCustomerId,
    items: result.rows || []
  };
}

async function readReportDetail(client, installationId, sessionId) {
  const sessionResult = await client.query(
    `SELECT id, route_id, route_name, session_date, sales, area, status,
            planned_customers, visited_customers, order_count, test_count,
            report_count, followup_count, note, opened_at, closed_at,
            created_at, updated_at
       FROM mcp.mcp_route_sessions session
      WHERE installation_id = $1 AND id = $2
      LIMIT 1`,
    [installationId, sessionId]
  );
  const session = sessionResult.rows?.[0];
  if (!session) throw localReadError("mcp_session_not_found", 404);

  const snapshotResult = await client.query(
    `SELECT id, session_id, route_id, route_name, session_date, sales, status,
            kpis, overview, sections, customer_details, summary_text,
            snapshot_source, snapshot_at, created_at, updated_at
       FROM mcp.mcp_session_reports report
      WHERE installation_id = $1 AND session_id = $2
      ORDER BY snapshot_at DESC NULLS LAST, updated_at DESC, id DESC
      LIMIT 1`,
    [installationId, sessionId]
  );

  const customersResult = await client.query(
    `SELECT id, session_id, route_id, route_customer_id, customer_id,
            customer_name, account_name, phone, area, address, sort_order,
            source, status, visit_status, status_reason, order_id, test_id,
            report_id, followup_count, note, checkin_at, updated_at
       FROM mcp.mcp_session_customers
      WHERE installation_id = $1 AND session_id = $2
      ORDER BY sort_order ASC, id ASC`,
    [installationId, sessionId]
  );

  const reportsResult = await client.query(
    `SELECT sc.id AS session_customer_id,
            sc.customer_name,
            sc.area,
            report.id,
            report.report_date,
            report.report_type,
            report.content,
            report.price_summary,
            report.competitor_summary,
            report.display_summary,
            report.stock_summary,
            report.demand_summary,
            report.opportunity_summary,
            report.risk_summary,
            report.next_action,
            report.note,
            report.selected_competitor_ids,
            report.selected_used_product_ids,
            report.selected_setting_item_ids,
            report.created_at,
            report.updated_at
       FROM mcp.mcp_session_customers sc
       JOIN mcp.market_reports report
         ON report.installation_id = sc.installation_id
        AND report.id = sc.report_id
      WHERE sc.installation_id = $1 AND sc.session_id = $2
      ORDER BY sc.sort_order ASC, report.created_at ASC, report.id ASC`,
    [installationId, sessionId]
  );

  const testsResult = await client.query(
    `SELECT sc.id AS session_customer_id,
            sc.customer_name,
            sc.area,
            result.id,
            result.file_id,
            result.product_id,
            result.product_name,
            result.status,
            result.note,
            result.created_at,
            result.updated_at
       FROM mcp.mcp_session_customers sc
       JOIN mcp.test_customer_results result
         ON result.installation_id = sc.installation_id
        AND (
          result.raw_payload ->> 'session_customer_id' = sc.id
          OR result.id = sc.test_id
        )
      WHERE sc.installation_id = $1 AND sc.session_id = $2
      ORDER BY sc.sort_order ASC, result.created_at ASC, result.id ASC`,
    [installationId, sessionId]
  );

  const followupsResult = await client.query(
    `SELECT id, session_id, session_customer_id, route_id, route_customer_id,
            customer_id, customer_name, followup_type, title, due_date,
            status, priority, owner, note, created_at, updated_at
       FROM mcp.mcp_followups
      WHERE installation_id = $1 AND session_id = $2
      ORDER BY due_date ASC NULLS LAST, created_at ASC, id ASC`,
    [installationId, sessionId]
  );

  return {
    session,
    snapshot: snapshotResult.rows?.[0] || null,
    customers: customersResult.rows || [],
    marketReports: reportsResult.rows || [],
    tests: testsResult.rows || [],
    followups: followupsResult.rows || []
  };
}

export async function handleLocalReadApi(req, url, context, _config, { persistence } = {}) {
  const method = String(req.method || "GET").toUpperCase();
  if (method !== "GET") return null;
  const supported = new Set([
    MCP_SHELL_PATH,
    MCP_REPORT_HISTORY_PATH,
    MCP_REPORT_DETAIL_PATH,
    MCP_FOLLOWUPS_PATH,
    MCP_OUTLET_HISTORY_PATH
  ]);
  if (!supported.has(url.pathname)) return null;
  if (!persistence || typeof persistence.assertReady !== "function" || typeof persistence.withTransaction !== "function") {
    throw localReadError("provider_unavailable", 503);
  }

  const installationId = text(context?.installation?.id);
  if (!installationId) throw localReadError("installation_context_required", 500);

  await persistence.assertReady();

  if (url.pathname === MCP_REPORT_HISTORY_PATH) {
    const data = await persistence.withTransaction((client) =>
      readReportHistory(client, installationId)
    );
    return { statusCode: 200, payload: { data, receivedAt: new Date().toISOString() } };
  }

  if (url.pathname === MCP_FOLLOWUPS_PATH) {
    const data = await persistence.withTransaction((client) =>
      readFollowups(client, installationId)
    );
    return { statusCode: 200, payload: { data, receivedAt: new Date().toISOString() } };
  }

  if (url.pathname === MCP_REPORT_DETAIL_PATH) {
    const sessionId = text(url.searchParams.get("sessionId") || url.searchParams.get("session_id"));
    if (!sessionId) throw localReadError("session_id_required", 400);
    const data = await persistence.withTransaction((client) =>
      readReportDetail(client, installationId, sessionId)
    );
    return { statusCode: 200, payload: { data, receivedAt: new Date().toISOString() } };
  }

  if (url.pathname === MCP_OUTLET_HISTORY_PATH) {
    const routeCustomerId = text(url.searchParams.get("routeCustomerId") || url.searchParams.get("route_customer_id"));
    if (!routeCustomerId) throw localReadError("route_customer_id_required", 400);
    const data = await persistence.withTransaction((client) =>
      readOutletHistory(client, installationId, routeCustomerId)
    );
    return { statusCode: 200, payload: { data, receivedAt: new Date().toISOString() } };
  }

  const requestedCursor = text(url.searchParams.get("cursor"));
  const data = await persistence.withTransaction(async (client) => {
    const cursor = await readCursor(client, installationId);
    if (requestedCursor && requestedCursor === cursor) {
      return { cursor, unchanged: true, snapshot: null };
    }
    return { cursor, unchanged: false, snapshot: await readSnapshot(client, installationId) };
  });

  return { statusCode: 200, payload: { data, receivedAt: new Date().toISOString() } };
}

export const localReadApiInternals = Object.freeze({
  MCP_SHELL_PATH,
  MCP_REPORT_HISTORY_PATH,
  MCP_REPORT_DETAIL_PATH,
  MCP_FOLLOWUPS_PATH,
  MCP_OUTLET_HISTORY_PATH,
  RECENT_SESSION_DAYS,
  RECENT_SESSION_LIMIT,
  REPORT_HISTORY_LIMIT,
  FOLLOWUP_HISTORY_DAYS,
  FOLLOWUP_LIMIT
});

import http from "node:http";
import { handleMockReadRequest } from "./mock-read-server.mjs";

const port = Number(process.env.DASHBOARD_MOCK_PORT || 3112);
let failReads = false;
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

const data = {
  mcp_routes: [
    { id: "route-smoke-a", route_name: "Tuyến Browser A", area: "Quận 1", active: true, updated_at: `${today}T04:00:00Z` },
    { id: "route-smoke-b", route_name: "Tuyến Browser B", area: "Quận 2", active: true, updated_at: `${today}T03:00:00Z` },
    { id: "route-smoke-empty", route_name: "Tuyến chưa có phiên", area: "Quận 3", active: true, updated_at: `${today}T02:00:00Z` }
  ],
  mcp_route_customers: [],
  mcp_route_sessions: [
    { id: "session-old-a", route_id: "route-smoke-a", route_name: "Tuyến Browser A", session_date: "2026-01-01", updated_at: "2026-01-01T03:00:00Z", status: "done", planned_customers: 20, visited_customers: 20, order_count: 20, test_count: 0, report_count: 0, followup_count: 20 },
    { id: "session-cancelled-b", route_id: "route-smoke-b", route_name: "Tuyến Browser B", session_date: today, updated_at: `${today}T03:00:00Z`, status: "cancelled", planned_customers: 4, visited_customers: 1, order_count: 1, test_count: 0, report_count: 0, followup_count: 1 },
    { id: "session-latest-a", route_id: "route-smoke-a", route_name: "Tuyến Browser A", session_date: today, updated_at: `${today}T04:00:00Z`, status: "active", planned_customers: 12, visited_customers: 8, order_count: 9, test_count: 0, report_count: 1, followup_count: 9 }
  ],
  mcp_session_reports: [
    { id: "report-old-a", session_id: "session-old-a", route_id: "route-smoke-a", route_name: "Tuyến Browser A", session_date: "2026-01-01", snapshot_at: `${today}T06:00:00Z`, overview: { planned: 99, visited: 99, orders: 99, followups: 99 }, sections: {} },
    { id: "report-latest-a", session_id: "session-latest-a", route_id: "route-smoke-a", route_name: "Tuyến Browser A", session_date: today, snapshot_at: `${today}T05:00:00Z`, overview: { planned: 12, visited: 9 }, sections: { orders: [{ id: "o-1" }, { id: "o-1" }, { id: "o-2" }], followups: [{ id: "f-1" }, { id: "f-1" }, { id: "f-2" }, { id: "f-3" }] } }
  ]
};

function workforceMe() {
  return {
    employeeId: "22222222-2222-4222-8222-222222222222",
    roles: ["mcp.admin"],
    permissions: ["mcp.route.write"],
    scopes: [],
    session: {
      loginName: "dashboard.smoke",
      employeeFullName: "Dashboard Smoke",
      expiresAt: "2099-12-31T23:59:59.000Z"
    }
  };
}

function latestSessionsByRoute() {
  const byRoute = new Map();
  for (const row of data.mcp_route_sessions) {
    const current = byRoute.get(row.route_id);
    if (!current || `${row.session_date}|${row.updated_at}|${row.id}` > `${current.session_date}|${current.updated_at}|${current.id}`) {
      byRoute.set(row.route_id, row);
    }
  }
  return [...byRoute.values()];
}

function latestReportsForSessions(sessionIds) {
  const allowed = new Set(sessionIds);
  const bySession = new Map();
  for (const row of data.mcp_session_reports) {
    if (!allowed.has(row.session_id)) continue;
    const current = bySession.get(row.session_id);
    if (!current || String(row.snapshot_at || row.updated_at || row.id) > String(current.snapshot_at || current.updated_at || current.id)) {
      bySession.set(row.session_id, row);
    }
  }
  return [...bySession.values()];
}

function localReadPayload(url) {
  const cursor = "dashboard-persisted-v2";
  const requestedCursor = String(url.searchParams.get("cursor") || "").trim();
  if (requestedCursor === cursor) return { cursor, unchanged: true, snapshot: null };
  const latestSessions = latestSessionsByRoute();
  return {
    cursor,
    unchanged: false,
    snapshot: {
      generatedAt: new Date().toISOString(),
      recentSessionDays: 45,
      routes: data.mcp_routes,
      routeCustomers: data.mcp_route_customers,
      latestSessions,
      latestReports: latestReportsForSessions(latestSessions.map((row) => row.id)),
      recentSessions: data.mcp_route_sessions,
      recentSessionAggregates: []
    }
  };
}

function json(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(payload));
}

http.createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://127.0.0.1:${port}`);
  if (url.pathname === "/__fail" && request.method === "POST") {
    failReads = true;
    response.writeHead(204).end();
    return;
  }
  if (url.pathname === "/__ready") {
    response.writeHead(200).end("ok");
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/internal-auth/me") {
    json(response, 200, { data: workforceMe() });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/local-read/mcp-shell") {
    if (failReads) {
      json(response, 503, { error: { code: "fixture_read_failed", message: "fixture_read_failed" } });
      return;
    }
    json(response, 200, { data: localReadPayload(url), requestId: "dashboard-local-read", receivedAt: new Date().toISOString() });
    return;
  }
  const readResult = await handleMockReadRequest(request, url, data, { failReads });
  if (readResult) {
    response.writeHead(readResult.status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    response.end(JSON.stringify(readResult.body));
    return;
  }
  const table = url.pathname.match(/^\/rest\/v1\/([^/]+)$/)?.[1];
  if (!table || !(table in data)) {
    response.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ message: "not_found" }));
    return;
  }
  if (failReads) {
    response.writeHead(503, { "Content-Type": "application/json" }).end(JSON.stringify({ message: "fixture_read_failed" }));
    return;
  }
  const offset = Number(url.searchParams.get("offset") || 0);
  const limit = Number(url.searchParams.get("limit") || 500);
  response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(data[table].slice(offset, offset + limit)));
}).listen(port, "127.0.0.1", () => console.log(`dashboard_mock_ready=${port}`));

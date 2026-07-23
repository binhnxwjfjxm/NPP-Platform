import http from "node:http";

const port = Number(process.env.DASHBOARD_MOCK_PORT || 3112);
let failReads = false;
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

const data = {
  mcp_routes: [
    { id: "route-smoke-a", route_name: "Tuyến Browser A", area: "Quận 1", active: true },
    { id: "route-smoke-b", route_name: "Tuyến Browser B", area: "Quận 2", active: true },
    { id: "route-smoke-empty", route_name: "Tuyến chưa có phiên", area: "Quận 3", active: true }
  ],
  mcp_route_sessions: [
    { id: "session-old-a", route_id: "route-smoke-a", route_name: "Tuyến Browser A", session_date: "2026-01-01", updated_at: "2026-01-01T03:00:00Z", status: "done", planned_customers: 20, visited_customers: 20, order_count: 20, followup_count: 20 },
    { id: "session-cancelled-b", route_id: "route-smoke-b", route_name: "Tuyến Browser B", session_date: today, updated_at: `${today}T03:00:00Z`, status: "cancelled", planned_customers: 4, visited_customers: 1, order_count: 1, followup_count: 1 },
    { id: "session-latest-a", route_id: "route-smoke-a", route_name: "Tuyến Browser A", session_date: today, updated_at: `${today}T04:00:00Z`, status: "active", planned_customers: 12, visited_customers: 8, order_count: 9, followup_count: 9 }
  ],
  mcp_session_reports: [
    { id: "report-old-a", session_id: "session-old-a", snapshot_at: `${today}T06:00:00Z`, overview: { planned: 99, visited: 99, orders: 99, followups: 99 } },
    { id: "report-latest-a", session_id: "session-latest-a", snapshot_at: `${today}T05:00:00Z`, overview: { planned: 12, visited: 9 }, sections: { orders: [{ id: "o-1" }, { id: "o-1" }, { id: "o-2" }], followups: [{ id: "f-1" }, { id: "f-1" }, { id: "f-2" }, { id: "f-3" }] } }
  ]
};

http.createServer((request, response) => {
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

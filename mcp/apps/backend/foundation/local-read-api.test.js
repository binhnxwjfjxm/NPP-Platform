import test from "node:test";
import assert from "node:assert/strict";
import { handleLocalReadApi, localReadApiInternals } from "./local-read-api.js";

function request() {
  return { method: "GET", headers: {} };
}

function url(cursor = "") {
  const target = new URL("http://mcp.local/api/local-read/mcp-shell");
  if (cursor) target.searchParams.set("cursor", cursor);
  return target;
}

function context() {
  return { installation: { id: "installation-a" } };
}

function persistenceWithRows(cursor = "cursor-a") {
  const queries = [];
  const persistence = {
    async assertReady() {},
    async withTransaction(work) {
      return work({
        async query(sql, values) {
          queries.push({ sql: String(sql), values });
          const source = String(sql);
          if (source.includes("AS cursor")) return { rows: [{ cursor }] };
          if (source.includes("FROM mcp.mcp_routes") && source.includes("route_name")) return { rows: [{ id: "route-1", route_name: "Tuyến 1", active: true }] };
          if (source.includes("FROM mcp.mcp_route_customers")) return { rows: [{ id: "rc-1", route_id: "route-1", customer_name: "Điểm bán 1", active: true }] };
          if (source.includes("DISTINCT ON (route_id)")) return { rows: [{ id: "session-1", route_id: "route-1", route_name: "Tuyến 1", session_date: "2026-09-15", status: "active" }] };
          if (source.includes("FROM mcp.mcp_route_sessions") && source.includes("CURRENT_DATE")) return { rows: [{ id: "session-1", route_id: "route-1", route_name: "Tuyến 1", session_date: "2026-09-15", status: "active" }] };
          if (source.includes("DISTINCT ON (session_id)")) return { rows: [{ id: "report-1", session_id: "session-1", overview: { planned: 1, visited: 1 }, sections: { orders: [{ id: "o-1" }] } }] };
          if (source.includes("GROUP BY session_id")) return { rows: [{ session_id: "session-1", planned: 1, visited: 1, orders: 0, tests: 0, reports: 1, followups: 0 }] };
          throw new Error(`unexpected_query:${source}`);
        }
      });
    }
  };
  return { persistence, queries };
}

test("MCP local read is installation-scoped, bounded and aggregated", async () => {
  const state = persistenceWithRows();
  const result = await handleLocalReadApi(request(), url(), context(), {}, { persistence: state.persistence });
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.data.unchanged, false);
  assert.equal(result.payload.data.cursor, "cursor-a");
  assert.equal(result.payload.data.snapshot.routes.length, 1);
  assert.equal(result.payload.data.snapshot.routeCustomers.length, 1);
  assert.equal(result.payload.data.snapshot.recentSessions.length, 1);
  assert.equal(result.payload.data.snapshot.recentSessionAggregates.length, 1);
  for (const query of state.queries) assert.equal(query.values[0], "installation-a");
  const cursorQuery = state.queries[0];
  assert.match(cursorQuery.sql, /WITH route_state AS/);
  assert.match(cursorQuery.sql, /route_customer_state AS/);
  assert.match(cursorQuery.sql, /session_customer_state AS/);
  const recent = state.queries.find((item) => item.sql.includes("CURRENT_DATE"));
  assert.ok(recent);
  assert.match(recent.sql, /LIMIT \$3/);
  assert.deepEqual(recent.values, ["installation-a", localReadApiInternals.RECENT_SESSION_DAYS, localReadApiInternals.RECENT_SESSION_LIMIT]);
  assert.ok(state.queries.some((item) => item.sql.includes("DISTINCT ON (route_id)")));
  const reportQuery = state.queries.find((item) => item.sql.includes("DISTINCT ON (session_id)"));
  assert.ok(reportQuery);
  assert.match(reportQuery.sql, /overview, sections, snapshot_at/);
  assert.ok(state.queries.some((item) => item.sql.includes("GROUP BY session_id")));
});

test("matching cursor stops after the change check", async () => {
  const state = persistenceWithRows("same-cursor");
  const result = await handleLocalReadApi(request(), url("same-cursor"), context(), {}, { persistence: state.persistence });
  assert.equal(result.payload.data.unchanged, true);
  assert.equal(result.payload.data.snapshot, null);
  assert.equal(state.queries.length, 1);
  assert.match(state.queries[0].sql, /AS cursor/);
});

test("non-local-read routes are ignored", async () => {
  const state = persistenceWithRows();
  const result = await handleLocalReadApi(request(), new URL("http://mcp.local/api/routes"), context(), {}, { persistence: state.persistence });
  assert.equal(result, null);
  assert.equal(state.queries.length, 0);
});

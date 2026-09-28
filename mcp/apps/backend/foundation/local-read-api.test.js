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

function reportHistoryUrl() {
  return new URL("http://mcp.local/api/local-read/mcp-session-reports");
}

function reportDetailUrl(sessionId = "session-1") {
  const target = new URL("http://mcp.local/api/local-read/mcp-session-report");
  if (sessionId) target.searchParams.set("sessionId", sessionId);
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


function reportPersistence() {
  const queries = [];
  const persistence = {
    async assertReady() {},
    async withTransaction(work) {
      return work({
        async query(sql, values) {
          const source = String(sql);
          queries.push({ sql: source, values });
          if (source.includes("FROM (") && source.includes("mcp.mcp_session_reports report")) {
            return {
              rows: [
                {
                  id: "session-report-1",
                  session_id: "session-1",
                  route_name: "Tuyến 1",
                  session_date: "2026-09-27",
                  report_count: 1
                }
              ]
            };
          }
          if (source.includes("FROM mcp.mcp_route_sessions session")) {
            return {
              rows: [
                {
                  id: "session-1",
                  route_name: "Tuyến 1",
                  session_date: "2026-09-27",
                  status: "done",
                  planned_customers: 2,
                  visited_customers: 1,
                  order_count: 1,
                  test_count: 1,
                  report_count: 1,
                  followup_count: 1
                }
              ]
            };
          }
          if (source.includes("FROM mcp.mcp_session_reports report") && source.includes("LIMIT 1")) {
            return {
              rows: [
                {
                  id: "session-report-1",
                  session_id: "session-1",
                  overview: { planned: 2, visited: 1 },
                  snapshot_source: "close_session"
                }
              ]
            };
          }
          if (source.includes("FROM mcp.mcp_session_customers") && !source.includes("JOIN")) {
            return {
              rows: [
                {
                  id: "session-customer-1",
                  session_id: "session-1",
                  customer_name: "Điểm bán 1",
                  visit_status: "visited",
                  order_id: "order-1",
                  test_id: "test-result-1",
                  report_id: "market-report-1",
                  followup_count: 1
                },
                {
                  id: "session-customer-2",
                  session_id: "session-1",
                  customer_name: "Điểm bán 2",
                  visit_status: "skipped",
                  status_reason: "closed"
                }
              ]
            };
          }
          if (source.includes("JOIN mcp.market_reports report")) {
            return {
              rows: [
                {
                  session_customer_id: "session-customer-1",
                  customer_name: "Điểm bán 1",
                  id: "market-report-1",
                  competitor_summary: "Đối thủ A",
                  selected_competitor_ids: ["competitor-a"],
                  selected_used_product_ids: ["used-tea-a"]
                }
              ]
            };
          }
          if (source.includes("JOIN mcp.test_customer_results result")) {
            return {
              rows: [
                {
                  session_customer_id: "session-customer-1",
                  customer_name: "Điểm bán 1",
                  id: "test-result-1",
                  product_name: "Trà đào",
                  status: "interested"
                }
              ]
            };
          }
          if (source.includes("FROM mcp.mcp_followups")) {
            return {
              rows: [
                {
                  id: "followup-1",
                  session_id: "session-1",
                  session_customer_id: "session-customer-1",
                  customer_name: "Điểm bán 1",
                  title: "Gọi lại",
                  status: "pending"
                }
              ]
            };
          }
          throw new Error(`unexpected_query:${source}`);
        }
      });
    }
  };
  return { persistence, queries };
}

test("report history is installation-scoped and bounded", async () => {
  const state = reportPersistence();
  const result = await handleLocalReadApi(
    request(),
    reportHistoryUrl(),
    context(),
    {},
    { persistence: state.persistence }
  );
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.data.days, localReadApiInternals.RECENT_SESSION_DAYS);
  assert.equal(result.payload.data.reports.length, 1);
  assert.equal(result.payload.data.reports[0].session_id, "session-1");
  assert.equal(state.queries.length, 1);
  assert.deepEqual(state.queries[0].values, [
    "installation-a",
    localReadApiInternals.RECENT_SESSION_DAYS,
    localReadApiInternals.REPORT_HISTORY_LIMIT
  ]);
  assert.match(state.queries[0].sql, /DISTINCT ON \(report\.session_id\)/);
  assert.match(state.queries[0].sql, /LIMIT \$3/);
});

test("report detail returns one session with server facts", async () => {
  const state = reportPersistence();
  const result = await handleLocalReadApi(
    request(),
    reportDetailUrl(),
    context(),
    {},
    { persistence: state.persistence }
  );
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.data.session.id, "session-1");
  assert.equal(result.payload.data.snapshot.id, "session-report-1");
  assert.equal(result.payload.data.customers.length, 2);
  assert.equal(result.payload.data.marketReports[0].id, "market-report-1");
  assert.equal(result.payload.data.tests[0].id, "test-result-1");
  assert.equal(result.payload.data.followups[0].id, "followup-1");
  for (const query of state.queries) {
    assert.equal(query.values[0], "installation-a");
    assert.equal(query.values[1], "session-1");
  }
});

test("report detail requires session id", async () => {
  const state = reportPersistence();
  await assert.rejects(
    () =>
      handleLocalReadApi(
        request(),
        reportDetailUrl(""),
        context(),
        {},
        { persistence: state.persistence }
      ),
    (error) => error.code === "session_id_required" && error.statusCode === 400
  );
  assert.equal(state.queries.length, 0);
});

test("non-local-read routes are ignored", async () => {
  const state = persistenceWithRows();
  const result = await handleLocalReadApi(request(), new URL("http://mcp.local/api/routes"), context(), {}, { persistence: state.persistence });
  assert.equal(result, null);
  assert.equal(state.queries.length, 0);
});

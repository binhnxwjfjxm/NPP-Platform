import {
  db,
  ensure,
  errorCode,
  gateway,
  must,
  object,
  stamp,
  verifyCanonical
} from "./a5-5-2-smoke-http.mjs";

const cleanupRouteIds = new Set();

export async function createFixture() {
  const route = await must("/api/routes", {
    method: "POST",
    requestId: `a552-route-${stamp}`,
    body: {
      routeName: `__MCP_V1_API_FULL__${stamp}`,
      area: "API Smoke",
      weekday: 5,
      note: "temporary MCP v1 API smoke"
    }
  });
  const routeData = object(route.payload.data);
  const routeId = String(routeData.routeId || routeData.id || "");
  ensure(routeId, "fixture_route_id_missing");
  cleanupRouteIds.add(routeId);

  const customer = await must("/api/route-customers", {
    method: "POST",
    requestId: `a552-customer-${stamp}`,
    idempotencyKey: `a552.route-customer.${stamp}`,
    body: {
      routeId,
      customerName: `__MCP_V1_API_A552_CUSTOMER__${stamp}`,
      area: "API Smoke",
      sortOrder: 1,
      note: "temporary MCP v1 API smoke"
    }
  });
  const customerData = object(customer.payload.data);
  const routeCustomerId = String(customerData.routeCustomerId || customerData.id || "");
  ensure(routeCustomerId, "fixture_route_customer_id_missing");

  const sessionDate = "2099-12-30";
  const opened = await must("/api/mcp-day/open-session", {
    method: "POST",
    requestId: `a552-open-${stamp}`,
    idempotencyKey: `a552.route-session.open.${stamp}`,
    body: { routeId, sessionDate, owner: "API Smoke" }
  });
  const sessionId = String(object(object(opened.payload.data).session).id || "");
  ensure(sessionId, "fixture_session_id_missing");

  const day = await must(
    `/api/mcp-day/data?routeId=${encodeURIComponent(routeId)}&date=${sessionDate}`,
    { requestId: `a552-day-${stamp}` }
  );
  const lines = object(day.payload.data).lines;
  ensure(Array.isArray(lines) && lines.length === 1, "fixture_line_count_mismatch");
  const line = object(lines[0]);
  const sessionCustomerId = String(line.sessionCustomerId || line.id || "");
  ensure(sessionCustomerId, "fixture_session_customer_id_missing");
  ensure(String(line.routeCustomerId || "") === routeCustomerId, "fixture_route_customer_mismatch");

  return { routeId, routeCustomerId, sessionId, sessionDate, sessionCustomerId };
}

async function cleanupRoute(routeId) {
  if (!routeId || !cleanupRouteIds.has(routeId)) return;
  const result = await gateway(`/api/routes/${encodeURIComponent(routeId)}/archive`, {
    method: "POST",
    requestId: `a552-cleanup-${stamp}`,
    body: {}
  });
  if (result.response.status === 404) {
    cleanupRouteIds.delete(routeId);
    return;
  }
  if (!result.response.ok) {
    throw new Error(`cleanup_route_${routeId}_failed_${result.response.status}_${errorCode(result.payload)}`);
  }
  verifyCanonical(result, "cleanup_route");
  ensure(object(result.payload.data).smokeCleanup === true, "cleanup_not_smoke_guarded");
  cleanupRouteIds.delete(routeId);
}

export async function cleanupAll() {
  const errors = [];
  for (const routeId of Array.from(cleanupRouteIds).reverse()) {
    try {
      await cleanupRoute(routeId);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, "a552_runtime_cleanup_failed");
}

export async function verifyFixtureRemoved(routeId, aggregateRows) {
  const routes = await db(`mcp_routes?id=eq.${encodeURIComponent(routeId)}&select=id`);
  ensure(routes.length === 0, "cleanup_route_leak");
  for (const row of aggregateRows) {
    const records = await db(`${row.table}?id=eq.${encodeURIComponent(row.id)}&select=id`);
    ensure(records.length === 0, `cleanup_${row.label}_aggregate_leak`);
  }
}

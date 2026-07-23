const base = String(
  process.env.MCP_API_BASE_URL || "http://127.0.0.1:3001"
).replace(/\/+$/, "");
const backendToken = String(process.env.BACKEND_API_TOKEN || "").trim();

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const cleanupRouteIds = new Set();
const cleanupResults = [];

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function errorCode(payload) {
  const envelope = object(payload.error);
  if (envelope.code) return String(envelope.code);
  if (typeof payload.error === "string" && payload.error) return payload.error;
  if (payload.message) return String(payload.message);
  return "request_failed";
}

async function call(path, init = {}) {
  const response = await fetch(`${base}${path}`, {
    cache: "no-store",
    ...init,
    headers: {
      Accept: "application/json",
      "X-Backend-Token": backendToken,
      "X-Request-Id": `mcp_v1_smoke_${stamp}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {})
    }
  });
  const payload = object(await response.json().catch(() => ({})));
  return { response, payload };
}

async function must(path, init = {}) {
  const result = await call(path, init);
  if (!result.response.ok) {
    throw new Error(
      `${init.method || "GET"} ${path} -> ${result.response.status}: ${errorCode(result.payload)}`
    );
  }
  return object(result.payload.data);
}

async function mustConflict(path, init = {}) {
  const result = await call(path, init);
  assert(
    result.response.status === 409,
    `${init.method || "GET"} ${path} expected 409, got ${result.response.status}: ${errorCode(result.payload)}`
  );
  return result.payload;
}

async function createRoute(label, weekday) {
  const route = await must("/api/routes", {
    method: "POST",
    body: JSON.stringify({
      routeName: `__MCP_V1_API_${label}__${stamp}`,
      area: "API Smoke",
      weekday,
      note: "temporary MCP v1 API smoke"
    })
  });
  const routeId = String(route.routeId || route.id || "");
  assert(routeId, `${label}_route_id_missing`);
  cleanupRouteIds.add(routeId);
  return routeId;
}

async function createCustomer(routeId, label) {
  const customer = await must("/api/route-customers", {
    method: "POST",
    body: JSON.stringify({
      routeId,
      customerName: `__MCP_V1_API_CUSTOMER_${label}__${stamp}`,
      area: "API Smoke",
      sortOrder: 1,
      note: "temporary MCP v1 API smoke"
    })
  });
  const routeCustomerId = String(
    customer.routeCustomerId || customer.id || ""
  );
  assert(routeCustomerId, `${label}_route_customer_id_missing`);
  return routeCustomerId;
}

async function cleanupRoute(routeId) {
  if (!routeId || !cleanupRouteIds.has(routeId)) return;
  const result = await call(`/api/routes/${encodeURIComponent(routeId)}/archive`, {
    method: "POST",
    body: "{}"
  });
  if (result.response.status === 404) {
    cleanupRouteIds.delete(routeId);
    return;
  }
  if (!result.response.ok) {
    throw new Error(
      `cleanup route ${routeId} failed: ${result.response.status} ${errorCode(result.payload)}`
    );
  }
  const data = object(result.payload.data);
  assert(data.smokeCleanup === true, `cleanup route ${routeId} was not guarded smoke cleanup`);
  cleanupResults.push(data);
  cleanupRouteIds.delete(routeId);
}

async function cleanupAllRoutes() {
  const errors = [];
  for (const routeId of Array.from(cleanupRouteIds).reverse()) {
    try {
      await cleanupRoute(routeId);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, "mcp_v1_smoke_cleanup_failed");
  }
}

async function fullSessionSmoke() {
  const routeId = await createRoute("FULL", 5);
  await createCustomer(routeId, "FULL");
  const sessionDate = "2099-12-31";

  const firstOpen = await must("/api/mcp-day/open-session", {
    method: "POST",
    body: JSON.stringify({ routeId, sessionDate, owner: "API Smoke" })
  });
  const secondOpen = await must("/api/mcp-day/open-session", {
    method: "POST",
    body: JSON.stringify({ routeId, sessionDate, owner: "API Smoke" })
  });

  const sessionId = String(object(firstOpen.session).id || "");
  assert(sessionId, "full_session_id_missing");
  assert(firstOpen.created === true, "full_first_open_not_created");
  assert(secondOpen.created === false, "full_second_open_created_duplicate");
  assert(
    String(object(secondOpen.session).id || "") === sessionId,
    "full_open_not_idempotent"
  );

  const day = await must(
    `/api/mcp-day/data?routeId=${encodeURIComponent(routeId)}&date=${sessionDate}`
  );
  assert(object(day.run).id === sessionId, "full_day_session_mismatch");
  assert(Array.isArray(day.lines) && day.lines.length === 1, "full_snapshot_count_mismatch");

  const line = object(day.lines[0]);
  const sessionCustomerId = String(line.sessionCustomerId || line.id || "");
  assert(sessionCustomerId, "full_session_customer_id_missing");

  const visited = await must("/api/mcp-day/session-customer/status", {
    method: "POST",
    body: JSON.stringify({
      sessionCustomerId,
      visitStatus: "visited",
      note: "API smoke visited"
    })
  });
  assert(visited.visitStatus === "visited", "full_visit_not_recorded");

  const order = await must("/api/mcp-day/session-customer/order", {
    method: "POST",
    body: JSON.stringify({
      sessionCustomerId,
      status: "confirmed",
      note: "API smoke order",
      items: [
        {
          productName: "API Smoke Product",
          sku: "SMOKE-001",
          unit: "gói",
          quantity: 2,
          unitPrice: 15000,
          discount: 0
        }
      ]
    })
  });
  assert(Object.keys(order).length > 0, "full_order_not_created");

  const test = await must("/api/mcp-day/session-customer/test", {
    method: "POST",
    body: JSON.stringify({
      sessionCustomerId,
      fileTitle: "API Smoke Test",
      customerStatus: "tested",
      results: [
        {
          productName: "API Smoke Product",
          status: "ok",
          note: "Đạt"
        }
      ]
    })
  });
  assert(Object.keys(test).length > 0, "full_test_not_created");

  const report = await must("/api/mcp-day/session-customer/report", {
    method: "POST",
    body: JSON.stringify({
      sessionCustomerId,
      reportType: "market_report",
      content: "API smoke market report",
      fields: {
        priceSummary: "Giá ổn",
        demandSummary: "Có nhu cầu",
        nextAction: "Theo dõi đơn"
      },
      selected: {
        competitors: [],
        usedProducts: [],
        settingItems: []
      },
      context: {
        routeId,
        sessionDate,
        customerName: line.accountName || "API Smoke Customer"
      }
    })
  });
  assert(Object.keys(report).length > 0, "full_report_not_created");

  const followup = await must("/api/mcp-day/session-customer/followup", {
    method: "POST",
    body: JSON.stringify({
      sessionCustomerId,
      title: "API smoke follow-up",
      dueDate: "2100-01-03",
      priority: "high",
      owner: "API Smoke",
      followupType: "order",
      note: "Gọi lại chốt đơn"
    })
  });
  assert(Object.keys(followup).length > 0, "full_followup_not_created");

  await mustConflict(`/api/mcp-sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE"
  });

  const closed = await must(`/api/mcp-sessions/${encodeURIComponent(sessionId)}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "done", note: "API smoke closed" })
  });
  assert(closed.status === "done", "full_session_not_closed");
  assert(Object.keys(object(closed.snapshot)).length > 0, "full_close_snapshot_missing");

  await mustConflict("/api/mcp-day/session-customer/status", {
    method: "POST",
    body: JSON.stringify({
      sessionCustomerId,
      visitStatus: "visited",
      note: "must stay read-only"
    })
  });

  return {
    routeId,
    sessionId,
    snapshotCount: day.lines.length,
    orderCreated: true,
    testCreated: true,
    reportCreated: true,
    followupCreated: true,
    activityDeleteBlocked: true,
    closedStatus: closed.status,
    closeSnapshotCreated: true,
    closedMutationBlocked: true
  };
}

async function frozenEmptySnapshotSmoke() {
  const routeId = await createRoute("SNAPSHOT_ONCE", 4);
  const sessionDate = "2099-12-30";

  const firstOpen = await must("/api/mcp-day/open-session", {
    method: "POST",
    body: JSON.stringify({ routeId, sessionDate, owner: "API Smoke" })
  });
  const sessionId = String(object(firstOpen.session).id || "");
  assert(sessionId, "snapshot_once_session_id_missing");
  assert(firstOpen.created === true, "snapshot_once_first_open_not_created");

  await createCustomer(routeId, "AFTER_OPEN");

  const secondOpen = await must("/api/mcp-day/open-session", {
    method: "POST",
    body: JSON.stringify({ routeId, sessionDate, owner: "API Smoke" })
  });
  assert(secondOpen.created === false, "snapshot_once_second_open_created_duplicate");
  assert(
    String(object(secondOpen.session).id || "") === sessionId,
    "snapshot_once_session_changed"
  );
  assert(
    object(secondOpen.backfill).skipped === "existing_session_snapshot_frozen",
    "snapshot_once_backfill_not_frozen"
  );

  const day = await must(
    `/api/mcp-day/data?routeId=${encodeURIComponent(routeId)}&date=${sessionDate}`
  );
  assert(Array.isArray(day.lines) && day.lines.length === 0, "snapshot_once_customer_leaked_into_session");

  const cancelled = await must(`/api/mcp-sessions/${encodeURIComponent(sessionId)}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "cancelled", note: "API smoke cancelled" })
  });
  assert(cancelled.status === "cancelled", "snapshot_once_cancel_failed");

  const deleted = await must(`/api/mcp-sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE"
  });
  assert(deleted.deleted === true, "snapshot_once_empty_cancelled_delete_failed");

  return {
    routeId,
    sessionId,
    firstCreated: firstOpen.created,
    secondCreated: secondOpen.created,
    backfillSkipped: object(secondOpen.backfill).skipped,
    snapshotCountAfterRouteCustomerAdded: day.lines.length,
    cancelledStatus: cancelled.status,
    emptyCancelledSessionDeleted: deleted.deleted
  };
}

async function runSmoke() {
  let output = null;
  let primaryError = null;
  let cleanupError = null;

  try {
    assert(backendToken, "missing_BACKEND_API_TOKEN");

    const healthResult = await call("/api/health");
    assert(healthResult.response.ok, `health_http_${healthResult.response.status}`);
    const healthData = object(healthResult.payload.data);
    assert(healthData.service === "mcp-plan-backend", "health_service_invalid");
    assert(healthData.installationConfigured === true, "health_installation_not_configured");
    assert(healthData.providerConfigured === true, "health_provider_not_configured");
    assert(healthData.authBoundary === "proxy-service", "health_auth_boundary_invalid");

    const fullSession = await fullSessionSmoke();
    const frozenEmptySnapshot = await frozenEmptySnapshotSmoke();

    output = {
      ok: true,
      base,
      health: true,
      authBoundary: true,
      fullSession,
      frozenEmptySnapshot
    };
  } catch (error) {
    primaryError = error;
  }

  try {
    await cleanupAllRoutes();
  } catch (error) {
    cleanupError = error;
  }

  if (primaryError || cleanupError) {
    throw new AggregateError(
      [primaryError, cleanupError].filter(Boolean),
      "mcp_v1_api_smoke_failed"
    );
  }

  return { ...output, cleanup: cleanupResults };
}

try {
  const result = await runSmoke();
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
}

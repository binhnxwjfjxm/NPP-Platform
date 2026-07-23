import { asObject as object, readJsonValue } from "./json-response.mjs";

const gatewayBase = String(
  process.env.MCP_API_BASE_URL || "http://127.0.0.1:3001"
).replace(/\/+$/, "");
const supabaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const backendToken = String(process.env.BACKEND_API_TOKEN || "").trim();
const serviceRole = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const cleanupRouteIds = new Set();

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])])
    );
  }
  return value;
}

function sameJson(left, right) {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

function errorCode(payload) {
  const root = object(payload);
  const envelope = object(root.error);
  return String(envelope.code || root.error || root.message || "request_failed");
}

function flattenErrors(error) {
  if (error instanceof AggregateError) {
    return Array.from(error.errors || []).flatMap((item) => flattenErrors(item));
  }
  return [error?.message || String(error)];
}

async function gateway(path, {
  method = "GET",
  body,
  requestId = `f05-runtime-${stamp}`,
  idempotencyKey
} = {}) {
  const response = await fetch(`${gatewayBase}${path}`, {
    method,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "X-Backend-Token": backendToken,
      "X-Request-Id": requestId,
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = object(await readJsonValue(response, `${method} ${path}`));
  return { response, payload, requestId };
}

function verifyCanonical(result, label) {
  ensure(result.payload.requestId === result.requestId, `${label}: request_id_mismatch`);
  ensure(typeof result.payload.receivedAt === "string", `${label}: received_at_missing`);
  ensure(
    Object.prototype.hasOwnProperty.call(result.payload, "data"),
    `${label}: canonical_data_missing`
  );
}

async function must(path, options = {}) {
  const result = await gateway(path, options);
  if (!result.response.ok) {
    throw new Error(
      `${options.method || "GET"} ${path} -> ${result.response.status}: ${errorCode(result.payload)}`
    );
  }
  verifyCanonical(result, `${options.method || "GET"} ${path}`);
  return result;
}

async function mustConflict(path, options = {}) {
  const result = await gateway(path, options);
  ensure(
    result.response.status === 409,
    `${options.method || "GET"} ${path}: expected_409_got_${result.response.status}`
  );
  ensure(
    errorCode(result.payload).toLowerCase().includes("idempotency_key_conflict"),
    `${options.method || "GET"} ${path}: wrong_conflict_code_${errorCode(result.payload)}`
  );
  ensure(result.payload.requestId === result.requestId, `${path}: conflict_request_id_mismatch`);
  ensure(typeof result.payload.receivedAt === "string", `${path}: conflict_received_at_missing`);
  return result;
}

async function db(path) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      apikey: serviceRole,
      Authorization: `Bearer ${serviceRole}`
    }
  });
  const payload = await readJsonValue(response, `DB GET ${path}`);
  if (!response.ok) {
    throw new Error(`DB GET ${path} -> ${response.status}: ${errorCode(payload)}`);
  }
  ensure(Array.isArray(payload), `DB GET ${path}: response_not_array`);
  return payload;
}

async function createFixture() {
  const routeResult = await must("/api/routes", {
    method: "POST",
    requestId: `f05-route-${stamp}`,
    body: {
      routeName: `__MCP_V1_API_FULL__${stamp}`,
      area: "API Smoke",
      weekday: 5,
      note: "temporary MCP v1 API smoke"
    }
  });
  const routeData = object(routeResult.payload.data);
  const routeId = String(routeData.routeId || routeData.id || "");
  ensure(routeId, "fixture_route_id_missing");
  cleanupRouteIds.add(routeId);

  const customerKey = `f05.route-customer.${stamp}`;
  const customerResult = await must("/api/route-customers", {
    method: "POST",
    requestId: `f05-customer-${stamp}`,
    idempotencyKey: customerKey,
    body: {
      routeId,
      customerName: `__MCP_V1_API_F05_CUSTOMER__${stamp}`,
      area: "API Smoke",
      sortOrder: 1,
      note: "temporary MCP v1 API smoke"
    }
  });
  const customerData = object(customerResult.payload.data);
  const routeCustomerId = String(customerData.routeCustomerId || customerData.id || "");
  ensure(routeCustomerId, "fixture_route_customer_id_missing");

  const sessionDate = "2099-12-29";
  const openResult = await must("/api/mcp-day/open-session", {
    method: "POST",
    requestId: `f05-open-${stamp}`,
    body: { routeId, sessionDate, owner: "API Smoke" }
  });
  const openData = object(openResult.payload.data);
  const sessionId = String(object(openData.session).id || "");
  ensure(sessionId, "fixture_session_id_missing");

  const dayResult = await must(
    `/api/mcp-day/data?routeId=${encodeURIComponent(routeId)}&date=${sessionDate}`,
    { requestId: `f05-day-${stamp}` }
  );
  const dayData = object(dayResult.payload.data);
  ensure(Array.isArray(dayData.lines) && dayData.lines.length === 1, "fixture_line_count_mismatch");
  const line = object(dayData.lines[0]);
  const sessionCustomerId = String(line.sessionCustomerId || line.id || "");
  const lineRouteCustomerId = String(line.routeCustomerId || "");
  ensure(sessionCustomerId, "fixture_session_customer_id_missing");
  ensure(lineRouteCustomerId === routeCustomerId, "route_customer_response_line_mismatch");

  return {
    routeId,
    routeCustomerId,
    sessionId,
    sessionDate,
    sessionCustomerId,
    initialVisitStatus: String(line.visitStatus || line.status || ""),
    initialCheckedIn: line.checkedIn === true
  };
}

async function cleanupRoute(routeId) {
  if (!routeId || !cleanupRouteIds.has(routeId)) return;
  const result = await gateway(`/api/routes/${encodeURIComponent(routeId)}/archive`, {
    method: "POST",
    requestId: `f05-cleanup-${stamp}`,
    body: {}
  });
  if (result.response.status === 404) {
    cleanupRouteIds.delete(routeId);
    return;
  }
  if (!result.response.ok) {
    throw new Error(
      `cleanup_route_${routeId}_failed_${result.response.status}_${errorCode(result.payload)}`
    );
  }
  verifyCanonical(result, "cleanup_route");
  ensure(object(result.payload.data).smokeCleanup === true, "cleanup_not_smoke_guarded");
  cleanupRouteIds.delete(routeId);
}

async function cleanupAll() {
  const errors = [];
  for (const routeId of Array.from(cleanupRouteIds).reverse()) {
    try {
      await cleanupRoute(routeId);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, "f05_runtime_cleanup_failed");
}

async function auditRows(operation, idempotencyKey) {
  return db(
    "mcp_audit_events" +
      `?operation=eq.${encodeURIComponent(operation)}` +
      `&idempotency_key=eq.${encodeURIComponent(idempotencyKey)}` +
      "&select=request_id,action,outcome,status_code,aggregate_id" +
      "&order=occurred_at.asc"
  );
}

async function idempotencyRows(operation, idempotencyKey) {
  return db(
    "mcp_idempotency_records" +
      `?operation=eq.${encodeURIComponent(operation)}` +
      `&idempotency_key=eq.${encodeURIComponent(idempotencyKey)}` +
      "&select=status,attempt_count,response_status,original_request_id,last_request_id,aggregate_id"
  );
}

function replayed(payload) {
  return object(object(payload).meta).idempotency
    ? object(object(object(payload).meta).idempotency).replayed === true
    : false;
}

async function runCheckinFlow(fixture) {
  ensure(fixture.initialCheckedIn === false, "fixture_unexpected_existing_checkin");

  const outletBeforeRows = await db(
    "mcp_route_customers" +
      `?id=eq.${encodeURIComponent(fixture.routeCustomerId)}` +
      "&select=geo_lat,geo_lng,geo_accuracy,geo_source,geo_captured_at,google_maps_url"
  );
  ensure(outletBeforeRows.length === 1, "outlet_before_missing");
  const outletBefore = outletBeforeRows[0];

  const key = `f05.checkin.${stamp}`;
  const undoKey = `f05.checkin.undo.${stamp}`;
  const payload = {
    sessionCustomerId: fixture.sessionCustomerId,
    checkedIn: true,
    geoLat: 10.123456,
    geoLng: 106.123456,
    geoAccuracy: 12,
    geoSource: "runtime_smoke_manual"
  };

  const first = await must("/api/mcp-day/session-customer/checkin", {
    method: "POST",
    requestId: `f05-checkin-first-${stamp}`,
    idempotencyKey: key,
    body: payload
  });
  ensure(object(first.payload.data).checkedIn === true, "checkin_first_not_checked_in");
  ensure(!replayed(first.payload), "checkin_first_marked_replay");

  const second = await must("/api/mcp-day/session-customer/checkin", {
    method: "POST",
    requestId: `f05-checkin-replay-${stamp}`,
    idempotencyKey: key,
    body: payload
  });
  ensure(replayed(second.payload), "checkin_second_not_replayed");
  ensure(
    object(first.payload.data).checkinAt === object(second.payload.data).checkinAt,
    "checkin_replay_timestamp_changed"
  );

  await mustConflict("/api/mcp-day/session-customer/checkin", {
    method: "POST",
    requestId: `f05-checkin-conflict-${stamp}`,
    idempotencyKey: key,
    body: { ...payload, geoAccuracy: 13 }
  });

  const undo = await must("/api/mcp-day/session-customer/checkin", {
    method: "POST",
    requestId: `f05-checkin-undo-${stamp}`,
    idempotencyKey: undoKey,
    body: {
      sessionCustomerId: fixture.sessionCustomerId,
      checkedIn: false
    }
  });
  const undoData = object(undo.payload.data);
  ensure(undoData.checkedIn === false, "checkin_undo_still_checked_in");
  ensure(undoData.geoLat == null && undoData.geoLng == null, "checkin_undo_kept_coordinates");

  const dayAfter = await must(
    `/api/mcp-day/data?routeId=${encodeURIComponent(fixture.routeId)}&date=${fixture.sessionDate}`,
    { requestId: `f05-day-after-checkin-${stamp}` }
  );
  const lines = object(dayAfter.payload.data).lines;
  ensure(Array.isArray(lines) && lines.length === 1, "checkin_day_after_line_missing");
  const lineAfter = object(lines[0]);
  ensure(lineAfter.checkedIn !== true, "checkin_day_after_still_checked_in");
  ensure(
    String(lineAfter.visitStatus || lineAfter.status || "") === fixture.initialVisitStatus,
    "checkin_changed_visit_status"
  );

  const outletAfterRows = await db(
    "mcp_route_customers" +
      `?id=eq.${encodeURIComponent(fixture.routeCustomerId)}` +
      "&select=geo_lat,geo_lng,geo_accuracy,geo_source,geo_captured_at,google_maps_url"
  );
  ensure(outletAfterRows.length === 1, "outlet_after_missing");
  ensure(sameJson(outletBefore, outletAfterRows[0]), "checkin_overwrote_outlet_gps");

  const events = await auditRows("session-customer.checkin.set", key);
  const outcomes = events.map((row) => row.outcome);
  ensure(outcomes.includes("succeeded"), "checkin_audit_succeeded_missing");
  ensure(outcomes.includes("replayed"), "checkin_audit_replayed_missing");

  const undoEvents = await auditRows("session-customer.checkin.set", undoKey);
  ensure(
    undoEvents.some((row) => row.action === "remove_checkin" && row.outcome === "succeeded"),
    "checkin_audit_undo_missing"
  );

  const records = await idempotencyRows("session-customer.checkin.set", key);
  ensure(records.length === 1, "checkin_idempotency_record_missing");
  ensure(records[0].status === "completed", "checkin_idempotency_not_completed");
  ensure(Number(records[0].attempt_count) === 2, "checkin_idempotency_attempt_count_mismatch");

  return {
    first: "PASS",
    replay: "PASS",
    conflict: "PASS",
    secondClickUndo: "PASS",
    audit: "PASS",
    outletGpsUnchanged: true,
    visitStatusUnchanged: true
  };
}

async function runFoundationResultFlow(fixture) {
  const key = `f05.result.${stamp}`;
  const payload = {
    sessionCustomerId: fixture.sessionCustomerId,
    note: `F05 runtime result ${stamp}`
  };

  const first = await must("/api/mcp-day/session-customer/result", {
    method: "POST",
    requestId: `f05-result-first-${stamp}`,
    idempotencyKey: key,
    body: payload
  });
  ensure(!replayed(first.payload), "result_first_marked_replay");

  const second = await must("/api/mcp-day/session-customer/result", {
    method: "POST",
    requestId: `f05-result-replay-${stamp}`,
    idempotencyKey: key,
    body: payload
  });
  ensure(replayed(second.payload), "result_second_not_replayed");
  ensure(
    sameJson(first.payload.data, second.payload.data),
    "result_replay_response_changed"
  );

  await mustConflict("/api/mcp-day/session-customer/result", {
    method: "POST",
    requestId: `f05-result-conflict-${stamp}`,
    idempotencyKey: key,
    body: { ...payload, note: `${payload.note} changed` }
  });

  const events = await auditRows("session-customer.result.record", key);
  const outcomes = events.map((row) => row.outcome);
  ensure(outcomes.includes("succeeded"), "result_audit_succeeded_missing");
  ensure(outcomes.includes("replayed"), "result_audit_replayed_missing");

  const records = await idempotencyRows("session-customer.result.record", key);
  ensure(records.length === 1, "result_idempotency_record_missing");
  ensure(records[0].status === "completed", "result_idempotency_not_completed");
  ensure(Number(records[0].attempt_count) === 2, "result_idempotency_attempt_count_mismatch");

  return {
    first: "PASS",
    replay: "PASS",
    conflict: "PASS",
    audit: "PASS",
    responsePreserved: true
  };
}

async function run() {
  let primaryError = null;
  let cleanupError = null;
  let output = null;

  try {
    ensure(backendToken.length >= 32, "missing_BACKEND_API_TOKEN");
    ensure(supabaseUrl.startsWith("https://"), "missing_SUPABASE_URL");
    ensure(serviceRole.length > 20, "missing_SUPABASE_SERVICE_ROLE_KEY");

    const health = await must("/api/health", {
      requestId: `f05-health-${stamp}`
    });
    const healthData = object(health.payload.data);
    ensure(healthData.service === "mcp-plan-backend", "health_service_invalid");
    ensure(healthData.installationConfigured === true, "health_installation_not_configured");
    ensure(healthData.providerConfigured === true, "health_provider_not_configured");
    ensure(healthData.authBoundary === "proxy-service", "health_auth_boundary_invalid");

    const fixture = await createFixture();
    const checkin = await runCheckinFlow(fixture);
    const foundationResult = await runFoundationResultFlow(fixture);

    output = {
      F05_RUNTIME_CLOSURE_SMOKE: "PASS",
      gateway: gatewayBase,
      health: "PASS",
      canonicalEnvelope: "PASS",
      checkin,
      foundationResult,
      fixtureCleanup: "PENDING"
    };
  } catch (error) {
    primaryError = error;
  }

  try {
    await cleanupAll();
    if (output) output.fixtureCleanup = "PASS";
  } catch (error) {
    cleanupError = error;
  }

  if (primaryError || cleanupError) {
    const errors = [primaryError, cleanupError].filter(Boolean);
    console.error(
      JSON.stringify(
        {
          F05_RUNTIME_CLOSURE_SMOKE: "FAIL",
          errors: errors.flatMap((error) => flattenErrors(error))
        },
        null,
        2
      )
    );
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify(output, null, 2));
}

await run();

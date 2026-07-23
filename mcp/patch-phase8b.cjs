const fs = require("fs");
const path = "apps/backend/server.js";
let s = fs.readFileSync(path, "utf8");

if (!s.includes("async function supabasePatch(")) {
  s = s.replace(
`function randomId(prefix) {`,
`async function supabasePatch(table, values, params = {}) {
  const response = await fetch(buildSupabaseUrl(table, params), {
    method: "PATCH",
    headers: supabaseHeaders({
      "Content-Type": "application/json",
      Prefer: "return=representation"
    }),
    body: JSON.stringify(values)
  });

  if (!response.ok) {
    const detail = await response.text();
    const error = new Error("supabase_update_failed");
    error.statusCode = 502;
    error.detail = detail;
    error.table = table;
    throw error;
  }

  return response.json();
}

function randomId(prefix) {`
  );
}

if (!s.includes("const MCP_SESSION_CUSTOMER_STATUSES")) {
  s = s.replace(
`const SERVICE = "mcp-plan-backend";`,
`const SERVICE = "mcp-plan-backend";
const MCP_SESSION_CUSTOMER_STATUSES = new Set(["pending", "visited", "skipped", "cancelled"]);`
  );
}

if (!s.includes("function normalizeSessionCustomerStatus(")) {
  s = s.replace(
`function healthPayload() {`,
`function normalizeSessionCustomerStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  if (!MCP_SESSION_CUSTOMER_STATUSES.has(status)) {
    throw badRequest("invalid_visit_status");
  }
  return status;
}

function sessionCustomerStatusNeedsReason(status) {
  return status === "skipped" || status === "cancelled";
}

function healthPayload() {`
  );
}

if (!s.includes("async function updateMcpSessionCustomerStatus(")) {
  s = s.replace(
`async function loadMcpDayData() {`,
`async function updateMcpSessionCustomerStatus(body) {
  const sessionCustomerId = String(
    body.sessionCustomerId ||
    body.session_customer_id ||
    body.id ||
    ""
  ).trim();

  const visitStatus = normalizeSessionCustomerStatus(
    body.visitStatus ||
    body.visit_status ||
    body.status
  );

  const statusReason = String(
    body.statusReason ||
    body.status_reason ||
    body.reason ||
    ""
  ).trim();

  const note = String(body.note || "").trim();
  const now = new Date().toISOString();

  if (!sessionCustomerId) throw badRequest("session_customer_id_required");

  if (sessionCustomerStatusNeedsReason(visitStatus) && !statusReason) {
    throw badRequest("status_reason_required");
  }

  const rows = await supabaseGet("mcp_session_customers", {
    select: "id,session_id,route_id,route_customer_id,customer_id,customer_name,visit_status,status_reason,visit_id,note",
    id: \`eq.\${sessionCustomerId}\`,
    limit: 1
  });

  const sessionCustomer = rows[0];
  if (!sessionCustomer) throw badRequest("session_customer_not_found");

  let visit = null;
  let createdVisit = false;

  if (visitStatus === "visited") {
    if (sessionCustomer.visit_id) {
      const updatedVisits = await supabasePatch("mcp_visits", {
        status: "visited",
        checkin_at: now,
        note: note || sessionCustomer.note || "Ðã ghé",
        updated_at: now
      }, {
        id: \`eq.\${sessionCustomer.visit_id}\`
      });

      visit = updatedVisits[0] || null;
    } else {
      const insertedVisits = await supabaseInsert("mcp_visits", {
        id: randomId("mcv"),
        session_id: sessionCustomer.session_id,
        route_id: sessionCustomer.route_id,
        route_customer_id: sessionCustomer.route_customer_id,
        visit_date: todayDateOnly(),
        status: "visited",
        has_order: false,
        has_test: false,
        has_report: false,
        checkin_at: now,
        note: note || "Ðã ghé",
        raw_payload: {
          source: "api_session_customer_status",
          session_customer_id: sessionCustomer.id,
          customer_id: sessionCustomer.customer_id,
          customer_name: sessionCustomer.customer_name
        }
      });

      visit = insertedVisits[0] || null;
      createdVisit = Boolean(visit);
    }
  }

  const updatedSessionCustomers = await supabasePatch("mcp_session_customers", {
    visit_status: visitStatus,
    status_reason: sessionCustomerStatusNeedsReason(visitStatus) ? statusReason : null,
    visit_id: visit?.id || sessionCustomer.visit_id || null,
    note: note || sessionCustomer.note,
    updated_at: now
  }, {
    id: \`eq.\${sessionCustomer.id}\`
  });

  const visitedCount = await supabaseCount("mcp_session_customers", {
    session_id: \`eq.\${sessionCustomer.session_id}\`,
    visit_status: "eq.visited"
  });

  await supabasePatch("mcp_route_sessions", {
    visited_customers: visitedCount,
    updated_at: now
  }, {
    id: \`eq.\${sessionCustomer.session_id}\`
  });

  return {
    sessionCustomer: updatedSessionCustomers[0],
    visit,
    createdVisit
  };
}

async function loadMcpDayData() {`
  );
}

if (!s.includes('/api/mcp-day/session-customer/status')) {
  s = s.replace(
`  if (url.pathname === "/api/mcp-day/open-session") {
    const body = await readJsonBody(req);
    return wrap(await openMcpDaySession(body));
  }`,
`  if (url.pathname === "/api/mcp-day/open-session") {
    const body = await readJsonBody(req);
    return wrap(await openMcpDaySession(body));
  }

  if (url.pathname === "/api/mcp-day/session-customer/status") {
    const body = await readJsonBody(req);
    return wrap(await updateMcpSessionCustomerStatus(body));
  }`
  );
}

fs.writeFileSync(path, s);

const fs = require("node:fs");

const path = "apps/backend/server.js";
let s = fs.readFileSync(path, "utf8");

function replaceOnce(find, repl) {
  if (!s.includes(find)) throw new Error(`Missing marker:\n${find.slice(0, 120)}`);
  s = s.replace(find, repl);
}

if (!s.includes('import { randomUUID } from "node:crypto";')) {
  replaceOnce(
    'import http from "node:http";\nimport { loadEnvFile } from "node:process";',
    'import http from "node:http";\nimport { randomUUID } from "node:crypto";\nimport { loadEnvFile } from "node:process";'
  );
}

s = s.replace(
  '"Access-Control-Allow-Methods": "GET, OPTIONS"',
  '"Access-Control-Allow-Methods": "GET, POST, OPTIONS"'
);

if (!s.includes("async function supabaseInsert(")) {
  replaceOnce(
    '\nfunction numberValue(value) {',
    `
async function supabaseInsert(table, rows, params = {}) {
  const payload = Array.isArray(rows) ? rows : [rows];
  if (payload.length === 0) return [];

  const response = await fetch(buildSupabaseUrl(table, params), {
    method: "POST",
    headers: supabaseHeaders({
      "Content-Type": "application/json",
      Prefer: "return=representation"
    }),
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const detail = await response.text();
    const error = new Error("supabase_insert_failed");
    error.statusCode = 502;
    error.detail = detail;
    error.table = table;
    throw error;
  }

  return response.json();
}

function randomId(prefix) {
  return \`\${prefix}_\${randomUUID().replaceAll("-", "")}\`;
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function todayDateOnly() {
  return new Date().toISOString().slice(0, 10);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    throw badRequest("invalid_json_body");
  }
}
\nfunction numberValue(value) {`
  );
}

if (!s.includes("async function openMcpDaySession(")) {
  replaceOnce(
    '\nasync function loadMcpDayData() {',
    `
async function openMcpDaySession(body) {
  const routeId = String(body.routeId || body.route_id || "").trim();
  const sessionDate = String(body.sessionDate || body.session_date || todayDateOnly()).slice(0, 10);
  const owner = String(body.owner || body.sales || "").trim();

  if (!routeId) throw badRequest("route_id_required");
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(sessionDate)) throw badRequest("invalid_session_date");

  const routes = await supabaseGet("mcp_routes", {
    select: "id,route_name,area,weekday,active,note",
    id: \`eq.\${routeId}\`,
    limit: 1
  });

  const route = routes[0];
  if (!route) throw badRequest("route_not_found");
  if (route.active === false) throw badRequest("route_inactive");

  const routeCustomers = await supabaseGet("mcp_route_customers", {
    select: "id,route_id,customer_id,customer_name,phone,area,address,sort_order,active,note",
    route_id: \`eq.\${routeId}\`,
    order: "sort_order.asc,created_at.asc",
    limit: 1000
  });

  const activeCustomers = routeCustomers.filter((customer) => customer.active !== false);

  const existingSessions = await supabaseGet("mcp_route_sessions", {
    select: "id,route_id,route_name,session_date,sales,area,status,planned_customers,visited_customers,order_count,test_count,report_count,created_at",
    route_id: \`eq.\${routeId}\`,
    session_date: \`eq.\${sessionDate}\`,
    limit: 1
  });

  let session = existingSessions[0] || null;
  let createdSession = false;

  if (!session) {
    const inserted = await supabaseInsert("mcp_route_sessions", {
      id: randomId("mrs"),
      route_id: route.id,
      route_name: route.route_name || route.id,
      session_date: sessionDate,
      weekday: route.weekday,
      sales: owner || "Sale",
      area: route.area,
      status: "active",
      planned_customers: activeCustomers.length,
      visited_customers: 0,
      order_count: 0,
      test_count: 0,
      report_count: 0,
      note: "Opened by backend API",
      raw_payload: {
        source: "api_open_session",
        route_snapshot: route
      }
    });

    session = inserted[0];
    createdSession = true;
  }

  const existingSnapshots = await supabaseGet("mcp_session_customers", {
    select: "route_customer_id",
    session_id: \`eq.\${session.id}\`,
    limit: 2000
  });

  const existingRouteCustomerIds = new Set(
    existingSnapshots.map((item) => item.route_customer_id).filter(Boolean)
  );

  const snapshotRows = activeCustomers
    .filter((customer) => !existingRouteCustomerIds.has(customer.id))
    .map((customer) => ({
      id: randomId("msc"),
      session_id: session.id,
      route_id: route.id,
      route_customer_id: customer.id,
      customer_id: customer.customer_id,
      customer_name: customer.customer_name || "Khách chưa tên",
      phone: customer.phone,
      area: customer.area,
      address: customer.address,
      sort_order: numberValue(customer.sort_order),
      source: "master",
      planned_status: "planned",
      visit_status: "pending",
      note: customer.note,
      raw_payload: {
        route_customer_snapshot: customer
      }
    }));

  const insertedSnapshots = await supabaseInsert("mcp_session_customers", snapshotRows);

  const snapshotCount = await supabaseCount("mcp_session_customers", {
    session_id: \`eq.\${session.id}\`
  });

  return {
    session,
    createdSession,
    insertedSnapshotCount: insertedSnapshots.length,
    snapshotCount
  };
}
\nasync function loadMcpDayData() {`
  );
}

if (!s.includes("async function handlePost(")) {
  replaceOnce(
    '\nasync function handleGet(url) {',
    `
async function handlePost(req, url) {
  if (url.pathname === "/api/mcp-day/open-session") {
    const body = await readJsonBody(req);
    return wrap(await openMcpDaySession(body));
  }

  const error = new Error("not_found");
  error.statusCode = 404;
  throw error;
}
\nasync function handleGet(url) {`
  );
}

const oldServer = `  if (req.method !== "GET") {
    json(res, 405, {
      ok: false,
      service: SERVICE,
      error: "method_not_allowed",
      path: url.pathname
    });
    return;
  }

  handleGet(url)
    .then((payload) => json(res, 200, payload))`;

const newServer = `  const handler = req.method === "GET"
    ? handleGet(url)
    : req.method === "POST"
      ? handlePost(req, url)
      : Promise.reject(Object.assign(new Error("method_not_allowed"), { statusCode: 405 }));

  handler
    .then((payload) => json(res, 200, payload))`;

if (s.includes(oldServer)) {
  s = s.replace(oldServer, newServer);
}

s = s.replace(
  `        error: error.message || "internal_error",
        table: error.table,
        path: url.pathname`,
  `        error: error.message || "internal_error",
        detail: error.detail,
        table: error.table,
        path: url.pathname`
);

fs.writeFileSync(path, s, "utf8");
console.log("patched apps/backend/server.js");

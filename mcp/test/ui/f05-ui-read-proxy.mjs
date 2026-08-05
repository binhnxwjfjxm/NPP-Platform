import http from "node:http";

const port = Number(process.env.F05_UI_READ_PROXY_PORT || 3110);
const upstreamBaseUrl = process.env.F05_UI_MOCK_BACKEND_URL || "http://127.0.0.1:3109";

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function json(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

async function upstreamJson(path) {
  const response = await fetch(new URL(path, upstreamBaseUrl), { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) throw new Error(`mock_upstream_${response.status}`);
  return payload?.data ?? payload;
}

function routeRows(routes) {
  return routes.map((route) => ({
    id: route.id,
    route_name: route.name,
    area: route.area,
    active: route.status !== "paused"
  }));
}

function routeCustomerRows(customers) {
  return customers.map((customer) => ({
    id: customer.id,
    route_id: customer.routeId,
    customer_id: customer.accountId,
    customer_name: customer.accountName,
    phone: customer.contactName,
    area: customer.area,
    address: "",
    sort_order: customer.sortOrder,
    active: customer.status !== "hidden",
    note: customer.note,
    geo_lat: customer.gps?.lat ?? null,
    geo_lng: customer.gps?.lng ?? null,
    geo_accuracy: customer.gps?.accuracyMeters ?? null,
    geo_captured_at: customer.gps?.updatedAt ?? null,
    updated_at: customer.gps?.updatedAt ?? null
  }));
}

function sessionCustomerRows(lines) {
  return lines.map((line) => ({
    id: line.sessionCustomerId || line.id,
    session_id: "session-active",
    route_id: "route-active",
    route_customer_id: line.routeCustomerId,
    sort_order: line.sortOrder,
    customer_name: line.accountName,
    phone: line.phone || "",
    area: line.area,
    address: line.address || "",
    source: line.source,
    visit_status: line.status,
    note: line.note,
    order_id: line.orderId || null,
    test_id: line.testId || null,
    report_id: line.reportId || null,
    followup_count: line.followupCount || 0,
    checkin_at: line.checkinAt || null,
    checkin_lat: line.checkinLat ?? null,
    checkin_lng: line.checkinLng ?? null,
    checkin_accuracy: line.checkinAccuracy ?? null,
    checkin_source: line.checkinSource || null,
    created_at: "2099-12-30T08:00:00.000Z"
  }));
}

function visitRows(results) {
  return results.map((result) => ({
    id: result.id,
    session_id: "session-active",
    route_customer_id: result.routeCustomerId || null,
    order_id: result.orderId || null,
    test_id: result.testId || null,
    report_id: result.reportId || null,
    status: "visited",
    note: result.result || "Đã ghé",
    checkin_at: "2099-12-30T08:00:00.000Z",
    created_at: "2099-12-30T08:00:00.000Z"
  }));
}

function followupRows() {
  return [
    {
      id: "followup-high-overdue",
      session_id: "session-active",
      session_customer_id: "sc-existing",
      route_id: "route-active",
      customer_name: "UI Existing Customer",
      route_name: "UI Smoke Active",
      title: "Ghé lại xác nhận nhu cầu trưng bày",
      owner: "Sales UI",
      source: "session",
      priority: "high",
      status: "todo",
      due_date: "2026-07-30",
      note: "Kiểm tra vị trí trưng bày và ghi nhận phản hồi tại điểm bán.",
      created_at: "2026-07-29T08:00:00.000Z"
    },
    {
      id: "followup-doing",
      session_id: "session-active",
      session_customer_id: "sc-existing",
      route_id: "route-active",
      customer_name: "UI Existing Customer",
      route_name: "UI Smoke Active",
      title: "Theo dõi đơn hàng đã trao đổi",
      owner: "Sales UI",
      source: "order",
      priority: "medium",
      status: "doing",
      due_date: "2099-12-31",
      note: "Gọi lại xác nhận số lượng trước khi lập đơn chính thức.",
      created_at: "2026-08-05T08:00:00.000Z"
    }
  ];
}

async function readTable(table) {
  if (table === "mcp_routes") {
    const data = await upstreamJson("/api/routes/data");
    return routeRows(data.routes || []);
  }
  if (table === "mcp_route_customers") {
    const data = await upstreamJson("/api/routes/customers/data");
    return routeCustomerRows(data.customers || []);
  }
  if (table === "mcp_route_sessions") {
    return [{
      id: "session-active",
      route_id: "route-active",
      route_name: "UI Smoke Active",
      session_date: "2099-12-30",
      sales: "Sales UI",
      planned_customers: 1,
      visited_customers: 0,
      order_count: 0,
      status: "active",
      opened_at: "2099-12-30T08:00:00.000Z",
      created_at: "2099-12-30T08:00:00.000Z",
      updated_at: "2099-12-30T08:00:00.000Z"
    }];
  }
  if (table === "mcp_session_customers") {
    const data = await upstreamJson("/api/mcp-day/data");
    return sessionCustomerRows(data.lines || []);
  }
  if (table === "mcp_visits") {
    const data = await upstreamJson("/api/mcp-day/data");
    return visitRows(data.results || []);
  }
  if (table === "mcp_followups") return followupRows();
  throw new Error(`unsupported_read_table_${table}`);
}

async function forward(request, response, url) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  const headers = { ...request.headers };
  delete headers.host;
  delete headers["content-length"];
  const upstream = await fetch(new URL(`${url.pathname}${url.search}`, upstreamBaseUrl), {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : body
  });
  const payload = Buffer.from(await upstream.arrayBuffer());
  response.writeHead(upstream.status, Object.fromEntries(upstream.headers.entries()));
  response.end(payload);
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || `127.0.0.1:${port}`}`);
  try {
    if (request.method === "POST" && url.pathname === "/api/read") {
      const payload = await readJson(request);
      const data = await readTable(String(payload.table || ""));
      return json(response, 200, {
        data,
        requestId: String(request.headers["x-request-id"] || "ui-smoke-read"),
        receivedAt: new Date().toISOString()
      });
    }
    return await forward(request, response, url);
  } catch (error) {
    return json(response, 500, {
      error: {
        code: "read_proxy_error",
        message: error instanceof Error ? error.message : String(error)
      }
    });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`F05 UI read proxy listening on 127.0.0.1:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

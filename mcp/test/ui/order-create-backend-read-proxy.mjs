import http from "node:http";

const port = Number(process.env.ORDER_CREATE_PROXY_PORT || 3110);
const upstreamBase = String(process.env.ORDER_CREATE_UPSTREAM_BASE || "http://127.0.0.1:3111").replace(/\/+$/, "");

const linkedCustomers = [
  {
    routeCustomerId: "44444444-4444-4444-8444-444444444444",
    routeId: "route-active",
    routeName: "Tuyến phiên đang chạy",
    customerName: "UI Existing Customer",
    phone: "0900000001",
    area: "Bình Đại",
    address: "12 Đường Browser Smoke",
    status: "linked_existing",
    coreRequestId: "88888888-8888-4888-8888-888888888888",
    coreCustomerId: "22222222-2222-4222-8222-222222222222",
    coreCustomerAddressId: "33333333-3333-4333-8333-333333333333",
    coreCustomerCode: "KH-UI-001",
    reviewReason: null,
    submittedAt: new Date().toISOString(),
    lastSyncedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

const directState = {
  attempts: [],
  orders: []
};

function json(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function envelope(request, data) {
  return {
    data,
    requestId: String(request.headers["x-request-id"] || "order-ui-read"),
    receivedAt: new Date().toISOString()
  };
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function upstreamJson(path) {
  const response = await fetch(`${upstreamBase}${path}`);
  const payload = await response.json();
  if (!response.ok) throw new Error(`upstream_${response.status}`);
  return Array.isArray(payload?.data) ? payload.data : [];
}

async function backendReadRows(table) {
  if (table === "orders") {
    const orders = await upstreamJson("/api/orders");
    return orders.map((order) => ({
      id: order.id,
      order_code: order.code,
      order_date: order.date,
      customer_name: order.accountName,
      sales: order.owner,
      source_type: order.source,
      status: order.status,
      subtotal: order.totalAmount,
      discount_total: 0,
      grand_total: order.totalAmount,
      raw_payload: { routeName: order.routeName },
      created_at: `${order.date}T00:00:00.000Z`
    }));
  }

  if (table === "order_items") {
    const orders = await upstreamJson("/api/orders");
    return orders.flatMap((order) => Array.from({ length: Number(order.skuCount || 0) }, (_, index) => ({
      order_id: order.id,
      quantity: index === 0 ? Number(order.quantity || 0) : 0
    })));
  }

  if (table === "mcp_routes" || table === "mcp_route_customers") {
    const response = await fetch(`${upstreamBase}/api/routes/customers/data`);
    const payload = await response.json();
    if (!response.ok) throw new Error(`upstream_${response.status}`);
    const customers = Array.isArray(payload?.data?.customers) ? payload.data.customers : [];

    if (table === "mcp_routes") {
      const routes = new Map();
      for (const customer of customers) {
        if (!customer.routeId || routes.has(customer.routeId)) continue;
        routes.set(customer.routeId, {
          id: customer.routeId,
          route_name: customer.routeName,
          area: customer.area,
          active: true
        });
      }
      return [...routes.values()];
    }

    return customers.map((customer) => ({
      id: customer.id,
      route_id: customer.routeId,
      customer_id: customer.accountId,
      customer_name: customer.accountName,
      phone: customer.contactName,
      area: customer.area,
      sort_order: customer.sortOrder,
      active: customer.status !== "hidden",
      note: customer.note
    }));
  }

  if (table === "mcp_route_sessions") return [];
  throw new Error(`unsupported_read_table_${table}`);
}

async function proxy(request, response, url, requestBody) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value !== undefined && name.toLowerCase() !== "host" && name.toLowerCase() !== "content-length") {
      headers.set(name, Array.isArray(value) ? value.join(",") : value);
    }
  }
  const upstream = await fetch(`${upstreamBase}${url.pathname}${url.search}`, {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : requestBody
  });
  const body = Buffer.from(await upstream.arrayBuffer());
  const responseHeaders = {};
  upstream.headers.forEach((value, name) => {
    if (!["content-encoding", "content-length", "transfer-encoding"].includes(name.toLowerCase())) responseHeaders[name] = value;
  });
  response.writeHead(upstream.status, responseHeaders);
  response.end(body);
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || `127.0.0.1:${port}`}`);
  try {
    const requestBody = await readBody(request);

    if (request.method === "GET" && url.pathname === "/api/internal-auth/me") {
      return json(response, 200, envelope(request, {
        employeeId: "11111111-1111-4111-8111-111111111111",
        roles: ["mcp.sales"],
        permissions: ["mcp.sales-order.read", "mcp.sales-order.create"],
        scopes: ["warehouse:66666666-6666-4666-8666-666666666666"],
        session: {
          loginName: "sale.ui",
          employeeFullName: "Sale UI",
          expiresAt: "2099-12-31T23:59:59.000Z"
        }
      }));
    }
    if (request.method === "GET" && url.pathname === "/__direct-state") {
      return json(response, 200, directState);
    }
    if (request.method === "POST" && url.pathname === "/__direct-reset") {
      directState.attempts = [];
      directState.orders = [];
      return json(response, 200, { ok: true });
    }
    if (request.method === "GET" && url.pathname === "/api/customer-verifications") {
      return json(response, 200, envelope(request, { items: linkedCustomers }));
    }
    if (request.method === "GET" && url.pathname === "/api/core-sales/orders") {
      return json(response, 200, envelope(request, directState.orders));
    }
    if (request.method === "POST" && url.pathname === "/api/core-sales/orders") {
      const payload = requestBody.length ? JSON.parse(requestBody.toString("utf8")) : {};
      const key = String(request.headers["idempotency-key"] || "");
      directState.attempts.push({ key, payload });
      if (!key) {
        return json(response, 400, { error: { code: "missing_idempotency_key", message: "missing_idempotency_key" } });
      }
      const sameKeyAttempts = directState.attempts.filter((attempt) => attempt.key === key);
      if (sameKeyAttempts.length === 1) {
        return json(response, 503, { error: { code: "temporary_core_failure", message: "temporary_core_failure" } });
      }
      let order = directState.orders.find((item) => item.sourceId === key);
      if (!order) {
        order = {
          id: "99999999-9999-4999-8999-999999999999",
          number: "SO-MCP-0001",
          status: "draft",
          sourceType: "MCP",
          sourceId: key,
          sourceOutletId: linkedCustomers[0].routeCustomerId,
          customerId: payload.customerId,
          customerCode: linkedCustomers[0].coreCustomerCode,
          customerName: linkedCustomers[0].customerName,
          salesChannelCode: "MCP",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        directState.orders.unshift(order);
      }
      return json(response, 201, envelope(request, order));
    }

    if (request.method === "POST" && url.pathname === "/api/read") {
      const payload = requestBody.length ? JSON.parse(requestBody.toString("utf8")) : {};
      const rows = await backendReadRows(String(payload.table || ""));
      return json(response, 200, {
        data: payload.count === true ? rows.length : rows,
        requestId: String(request.headers["x-request-id"] || "order-ui-read"),
        receivedAt: new Date().toISOString()
      });
    }
    return proxy(request, response, url, requestBody);
  } catch (error) {
    return json(response, 500, {
      error: { code: "proxy_error", message: error instanceof Error ? error.message : String(error) }
    });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Order create backend-read proxy listening on 127.0.0.1:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

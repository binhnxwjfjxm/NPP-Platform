import http from "node:http";

const port = Number(process.env.ORDER_CREATE_PROXY_PORT || 3110);
const upstreamBase = String(process.env.ORDER_CREATE_UPSTREAM_BASE || "http://127.0.0.1:3111").replace(/\/+$/, "");

function json(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
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

import http from "node:http";
import { mkdir, writeFile } from "node:fs/promises";

const port = Number(process.env.ORDER_CREATE_MOCK_PORT || 3110);
const resultsDir = process.env.ORDER_CREATE_RESULTS_DIR || "test-results/order-create-smoke";

const routeCustomers = [
  {
    id: "rc-existing",
    routeId: "route-active",
    routeName: "Tuyến phiên đang chạy",
    accountId: "customer-existing",
    accountName: "UI Existing Customer",
    contactName: "0900000001",
    area: "Bình Đại",
    sortOrder: 1,
    status: "active",
    note: "Khách thuộc phiên đang chạy"
  },
  {
    id: "rc-second",
    routeId: "route-active",
    routeName: "Tuyến phiên đang chạy",
    accountId: "customer-second",
    accountName: "UI Second Customer",
    contactName: "0900000002",
    area: "Bình Đại",
    sortOrder: 2,
    status: "active",
    note: "Khách thứ hai cùng tuyến"
  },
  {
    id: "rc-other-route",
    routeId: "route-done",
    routeName: "Tuyến phiên đã chốt",
    accountId: "customer-other-route",
    accountName: "UI Other Route Customer",
    contactName: "0900000003",
    area: "Chợ Gạo",
    sortOrder: 1,
    status: "active",
    note: "Không được xuất hiện khi chọn phiên route-active"
  }
];

const products = [
  {
    productId: "product-syrup",
    variantId: "variant-strawberry",
    name: "Siro Hưng Phát",
    brand: "Hưng Phát",
    category: "Siro",
    sku: "HP-SIRO-DAU-750",
    variantName: "Dâu",
    sizeLabel: "750ml",
    sellUnit: "chai",
    packUnit: "thùng",
    packQuantity: 12,
    price: 89000
  },
  {
    productId: "product-syrup",
    variantId: "variant-peach",
    name: "Siro Hưng Phát",
    brand: "Hưng Phát",
    category: "Siro",
    sku: "HP-SIRO-DAO-750",
    variantName: "Đào",
    sizeLabel: "750ml",
    sellUnit: "chai",
    packUnit: "thùng",
    packQuantity: 12,
    price: 92000
  },
  {
    productId: "product-tea",
    variantId: "variant-tea-jasmine",
    name: "Trà Lài Hưng Phát",
    brand: "Hưng Phát",
    category: "Trà",
    sku: "HP-TRA-LAI-500",
    variantName: "Lài",
    sizeLabel: "500g",
    sellUnit: "gói",
    packUnit: "thùng",
    packQuantity: 20,
    price: 118000
  }
];

const orders = [
  {
    id: "order-base-001",
    code: "DH-UI-BASE-001",
    date: "2099-12-30",
    accountName: "UI Existing Customer",
    routeName: "Tuyến phiên đang chạy",
    owner: "Sale A",
    source: "orders_tab",
    skuCount: 3,
    quantity: 10,
    totalAmount: 500000,
    status: "confirmed"
  },
  {
    id: "order-base-002",
    code: "DH-UI-BASE-002",
    date: "2099-12-30",
    accountName: "UI Existing Customer",
    routeName: "Tuyến phiên đang chạy",
    owner: "Sale A",
    source: "orders_tab",
    skuCount: 3,
    quantity: 10,
    totalAmount: 500000,
    status: "confirmed"
  },
  {
    id: "order-base-003",
    code: "DH-UI-BASE-003",
    date: "2099-12-30",
    accountName: "UI Second Customer",
    routeName: "Tuyến phiên đang chạy",
    owner: "Sale A",
    source: "mcp_session_customer",
    skuCount: 2,
    quantity: 8,
    totalAmount: 300000,
    status: "delivered"
  },
  {
    id: "order-base-004",
    code: "DH-UI-BASE-004",
    date: "2099-12-29",
    accountName: "UI Other Route Customer",
    routeName: "Tuyến phiên đã chốt",
    owner: "Sale B",
    source: "mcp_session_customer",
    skuCount: 4,
    quantity: 16,
    totalAmount: 700000,
    status: "delivered"
  },
  {
    id: "order-base-005",
    code: "DH-UI-BASE-005",
    date: "2099-12-20",
    accountName: "UI Other Route Customer",
    routeName: "Tuyến phiên đã chốt",
    owner: "Sale B",
    source: "phone",
    skuCount: 1,
    quantity: 4,
    totalAmount: 200000,
    status: "confirmed"
  },
  {
    id: "order-base-006",
    code: "DH-UI-BASE-006",
    date: "2099-12-28",
    accountName: "UI Existing Customer",
    routeName: "Tuyến phiên đang chạy",
    owner: "Sale A",
    source: "phone",
    skuCount: 1,
    quantity: 2,
    totalAmount: 100000,
    status: "cancelled"
  },
  {
    id: "order-base-007",
    code: "DH-UI-BASE-007",
    date: "2099-12-27",
    accountName: "UI Draft Customer",
    routeName: "Tuyến phiên đã chốt",
    owner: "Sale B",
    source: "orders_tab",
    skuCount: 0,
    quantity: 0,
    totalAmount: 0,
    status: "draft"
  }
];

function initialState() {
  return {
    sequence: 1,
    requests: [],
    createdOrders: []
  };
}

let state = initialState();

function json(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function canonical(request, data, meta) {
  return {
    data,
    ...(meta ? { meta } : {}),
    requestId: String(request.headers["x-request-id"] || "order-ui-request"),
    receivedAt: new Date().toISOString()
  };
}

async function body(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const value = Buffer.concat(chunks).toString("utf8");
  return value ? JSON.parse(value) : {};
}

function record(request, url, payload) {
  const entry = {
    method: request.method,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams),
    idempotencyKey: String(request.headers["idempotency-key"] || ""),
    requestId: String(request.headers["x-request-id"] || ""),
    payload
  };
  state.requests.push(entry);
  return entry;
}

async function persistEvidence() {
  await mkdir(resultsDir, { recursive: true });
  await writeFile(`${resultsDir}/mock-state.json`, JSON.stringify(state, null, 2));
}

function sessionStatus(routeId) {
  if (routeId === "route-active") {
    return [{
      id: "session-active",
      routeId,
      routeName: "Tuyến phiên đang chạy",
      sessionDate: "2099-12-30",
      status: "active",
      plannedCustomers: 2,
      visitedCustomers: 1
    }];
  }
  if (routeId === "route-done") {
    return [{
      id: "session-done",
      routeId,
      routeName: "Tuyến phiên đã chốt",
      sessionDate: "2099-12-29",
      status: "done",
      plannedCustomers: 1,
      visitedCustomers: 1
    }];
  }
  return [];
}

function filteredProducts(url) {
  const query = String(url.searchParams.get("q") || "").trim().toLowerCase();
  const category = String(url.searchParams.get("category") || "").trim().toLowerCase();
  const brand = String(url.searchParams.get("brand") || "").trim().toLowerCase();
  return products.filter((product) => {
    const haystack = `${product.name} ${product.brand} ${product.category} ${product.sku} ${product.variantName} ${product.sizeLabel}`.toLowerCase();
    return (!query || haystack.includes(query))
      && (!category || String(product.category || "").toLowerCase() === category)
      && (!brand || String(product.brand || "").toLowerCase() === brand);
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || `127.0.0.1:${port}`}`);
  try {
    if (request.method === "GET" && url.pathname === "/health") return json(response, 200, { ok: true });
    if (request.method === "POST" && url.pathname === "/__reset") {
      state = initialState();
      await persistEvidence();
      return json(response, 200, { ok: true });
    }
    if (request.method === "GET" && url.pathname === "/__state") {
      return json(response, 200, state);
    }
    if (request.method === "GET" && url.pathname === "/api/orders") {
      return json(response, 200, canonical(request, orders));
    }
    if (request.method === "GET" && url.pathname === "/api/routes/customers/data") {
      return json(response, 200, canonical(request, {
        kpis: [],
        customers: routeCustomers
      }));
    }
    if (request.method === "GET" && url.pathname === "/api/mcp-settings/session-status") {
      const routeId = String(url.searchParams.get("routeId") || "");
      return json(response, 200, canonical(request, {
        selectedRouteId: routeId,
        sessions: sessionStatus(routeId)
      }));
    }
    if (request.method === "GET" && url.pathname === "/api/products/search") {
      return json(response, 200, canonical(request, filteredProducts(url)));
    }
    if (request.method === "POST" && url.pathname === "/api/orders") {
      const payload = await body(request);
      const entry = record(request, url, payload);
      if (!entry.idempotencyKey) {
        return json(response, 400, {
          error: { code: "missing_idempotency_key", message: "missing_idempotency_key" }
        });
      }
      const order = {
        orderId: `order-ui-${state.sequence}`,
        orderCode: `DH-UI-${String(state.sequence).padStart(4, "0")}`,
        status: String(payload.status || "confirmed")
      };
      state.sequence += 1;
      state.createdOrders.push({ ...order, payload });
      await persistEvidence();
      return json(response, 201, canonical(request, order, { idempotency: { replayed: false } }));
    }

    return json(response, 404, {
      error: { code: "not_found", message: `${request.method} ${url.pathname}` }
    });
  } catch (error) {
    return json(response, 500, {
      error: { code: "mock_error", message: error instanceof Error ? error.message : String(error) }
    });
  }
});

server.listen(port, "127.0.0.1", async () => {
  await persistEvidence();
  console.log(`Order create mock backend listening on 127.0.0.1:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

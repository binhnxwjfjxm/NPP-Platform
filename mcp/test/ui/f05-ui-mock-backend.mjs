import http from "node:http";
import { mkdir, writeFile } from "node:fs/promises";

const port = Number(process.env.F05_UI_MOCK_PORT || 3109);
const resultsDir = process.env.F05_UI_RESULTS_DIR || "test-results/f05-ui-smoke";

const routes = [
  {
    id: "route-no-active",
    name: "UI Smoke No Active",
    area: "API Smoke",
    salesOwner: "Sales UI",
    plannedCustomers: 0,
    visitedCustomers: 0,
    orderCount: 0,
    lastVisitDate: "-",
    status: "active"
  },
  {
    id: "route-active",
    name: "UI Smoke Active",
    area: "API Smoke",
    salesOwner: "Sales UI",
    plannedCustomers: 1,
    visitedCustomers: 0,
    orderCount: 0,
    lastVisitDate: "-",
    status: "active"
  }
];

function initialState() {
  return {
    sequence: 1,
    requests: [],
    routeCustomers: [
      {
        id: "rc-existing",
        routeId: "route-active",
        routeName: "UI Smoke Active",
        accountId: "customer-existing",
        accountName: "UI Existing Customer",
        contactName: "0900000000",
        area: "API Smoke",
        sortOrder: 1,
        status: "active",
        gps: { lat: 10.762622, lng: 106.660172, accuracyMeters: 8, updatedAt: "2026-07-18T00:00:00.000Z" },
        note: "Browser smoke seed"
      }
    ],
    sessionLines: [
      {
        id: "sc-existing",
        sessionCustomerId: "sc-existing",
        routeCustomerId: "rc-existing",
        sortOrder: 1,
        accountName: "UI Existing Customer",
        area: "API Smoke",
        source: "planned",
        status: "pending",
        note: "Browser smoke seed",
        hasOrder: false,
        hasTest: false,
        hasReport: false,
        followupCount: 0,
        checkedIn: false
      }
    ],
    idempotency: new Map()
  };
}

let state = initialState();

function json(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(payload));
}

function canonical(request, data, meta) {
  return {
    data,
    meta,
    requestId: String(request.headers["x-request-id"] || "ui-smoke-request"),
    receivedAt: new Date().toISOString()
  };
}

async function body(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
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

function hashPayload(payload) {
  return JSON.stringify(payload, Object.keys(payload).sort());
}

function idempotentResult(request, url, payload, execute) {
  const key = String(request.headers["idempotency-key"] || "").trim();
  if (!key) return { status: 400, payload: canonical(request, null, { error: "missing_idempotency_key" }) };
  const operation = url.pathname;
  const composite = `${operation}:${key}`;
  const payloadHash = hashPayload(payload);
  const existing = state.idempotency.get(composite);
  if (existing) {
    if (existing.payloadHash !== payloadHash) {
      return { status: 409, payload: { error: { code: "idempotency_key_conflict", message: "idempotency_key_conflict" }, requestId: String(request.headers["x-request-id"] || ""), receivedAt: new Date().toISOString() } };
    }
    return { status: existing.status, payload: { ...existing.response, meta: { ...(existing.response.meta || {}), idempotency: { replayed: true } } } };
  }
  const result = execute();
  const responsePayload = canonical(request, result, { idempotency: { replayed: false } });
  state.idempotency.set(composite, { payloadHash, status: 200, response: responsePayload });
  return { status: 200, payload: responsePayload };
}

function routeCustomerData(routeId) {
  const customers = routeId ? state.routeCustomers.filter((item) => item.routeId === routeId) : state.routeCustomers;
  return {
    kpis: [
      { label: "Điểm bán", value: customers.length, hint: "Browser smoke" },
      { label: "Có GPS", value: customers.filter((item) => item.gps).length, hint: "Browser smoke" }
    ],
    customers
  };
}

function dayData() {
  return {
    sessionOpened: true,
    run: {
      id: "session-active",
      routeId: "route-active",
      routeName: "UI Smoke Active",
      date: "2099-12-30",
      owner: "Sales UI",
      status: "active",
      openedAt: "08:00"
    },
    kpis: [
      { label: "Trong phiên", value: state.sessionLines.length, hint: "Browser smoke" },
      { label: "Đã ghé", value: 0, hint: "Browser smoke" },
      { label: "Chờ xử lý", value: state.sessionLines.length, hint: "Browser smoke" },
      { label: "Phát sinh", value: state.sessionLines.filter((line) => line.source === "added").length, hint: "Browser smoke" }
    ],
    lines: state.sessionLines,
    results: []
  };
}

function addRouteCustomer(payload) {
  const normalized = String(payload.customerName || "").trim().toLowerCase();
  let routeCustomer = state.routeCustomers.find((item) => item.routeId === payload.routeId && item.accountName.trim().toLowerCase() === normalized);
  const reusedRouteCustomer = Boolean(routeCustomer);
  if (!routeCustomer) {
    const id = `rc-ui-${state.sequence++}`;
    const route = routes.find((item) => item.id === payload.routeId);
    routeCustomer = {
      id,
      routeId: payload.routeId,
      routeName: route?.name || payload.routeId,
      accountId: `customer-ui-${state.sequence++}`,
      accountName: String(payload.customerName || "UI Customer"),
      contactName: String(payload.phone || "Chưa có SĐT"),
      area: String(payload.area || route?.area || "-"),
      sortOrder: Number(payload.sortOrder || 0),
      status: payload.geoLat && payload.geoLng ? "active" : "needs_gps",
      ...(payload.geoLat && payload.geoLng ? { gps: { lat: Number(payload.geoLat), lng: Number(payload.geoLng), accuracyMeters: Number(payload.geoAccuracy || 0), updatedAt: new Date().toISOString() } } : {}),
      note: String(payload.note || "")
    };
    state.routeCustomers.push(routeCustomer);
  }

  let sessionLine = null;
  let reusedSessionCustomer = false;
  if (payload.includeActiveSession === true) {
    sessionLine = state.sessionLines.find((line) => line.routeCustomerId === routeCustomer.id) || null;
    reusedSessionCustomer = Boolean(sessionLine);
    if (!sessionLine) {
      sessionLine = {
        id: `sc-ui-${state.sequence++}`,
        sessionCustomerId: `sc-ui-${state.sequence++}`,
        routeCustomerId: routeCustomer.id,
        sortOrder: routeCustomer.sortOrder,
        accountName: routeCustomer.accountName,
        area: routeCustomer.area,
        source: "added",
        status: "pending",
        note: routeCustomer.note,
        hasOrder: false,
        hasTest: false,
        hasReport: false,
        followupCount: 0,
        checkedIn: false
      };
      sessionLine.sessionCustomerId = sessionLine.id;
      state.sessionLines.push(sessionLine);
    }
  }

  return {
    routeCustomerId: routeCustomer.id,
    sessionCustomerId: sessionLine?.id || null,
    includedActiveSession: payload.includeActiveSession === true,
    createdRouteCustomer: !reusedRouteCustomer,
    createdSessionCustomer: Boolean(sessionLine) && !reusedSessionCustomer,
    reusedRouteCustomer,
    reusedSessionCustomer
  };
}

function addSessionCustomer(payload) {
  const routeCustomerResult = addRouteCustomer({
    routeId: "route-active",
    customerName: payload.customerName,
    phone: payload.phone,
    area: payload.area,
    address: payload.address,
    note: payload.note,
    geoLat: payload.geoLat,
    geoLng: payload.geoLng,
    geoAccuracy: payload.geoAccuracy,
    includeActiveSession: true,
    activeSessionId: payload.sessionId
  });
  return routeCustomerResult;
}

async function persistEvidence() {
  await mkdir(resultsDir, { recursive: true });
  await writeFile(`${resultsDir}/mock-state.json`, JSON.stringify({ ...state, idempotency: Array.from(state.idempotency.entries()) }, null, 2));
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
      return json(response, 200, { ...state, idempotency: Array.from(state.idempotency.entries()) });
    }
    if (request.method === "GET" && url.pathname === "/api/routes/data") {
      return json(response, 200, canonical(request, { kpis: [], routes }));
    }
    if (request.method === "GET" && url.pathname === "/api/routes/customers/data") {
      return json(response, 200, canonical(request, routeCustomerData(url.searchParams.get("routeId") || "")));
    }
    if (request.method === "GET" && url.pathname === "/api/mcp-settings/session-status") {
      const routeId = url.searchParams.get("routeId") || "";
      const sessions = routeId === "route-active" ? [{ id: "session-active", routeId, routeName: "UI Smoke Active", sessionDate: "2099-12-30", status: "active" }] : [];
      return json(response, 200, canonical(request, { sessions }));
    }
    if (request.method === "GET" && url.pathname === "/api/mcp-day/data") {
      return json(response, 200, canonical(request, dayData()));
    }
    if (request.method === "POST" && url.pathname === "/api/route-customers") {
      const payload = await body(request);
      record(request, url, payload);
      const result = idempotentResult(request, url, payload, () => addRouteCustomer(payload));
      await persistEvidence();
      return json(response, result.status, result.payload);
    }
    if (request.method === "POST" && url.pathname === "/api/mcp-day/session-customer/add") {
      const payload = await body(request);
      record(request, url, payload);
      const result = idempotentResult(request, url, payload, () => addSessionCustomer(payload));
      await persistEvidence();
      return json(response, result.status, result.payload);
    }
    if (request.method === "POST" && url.pathname === "/api/mcp-day/session-customer/checkin") {
      const payload = await body(request);
      record(request, url, payload);
      const result = idempotentResult(request, url, payload, () => {
        const line = state.sessionLines.find((item) => item.sessionCustomerId === payload.sessionCustomerId || item.id === payload.sessionCustomerId);
        if (!line) throw new Error("session_customer_not_found");
        line.checkedIn = payload.checkedIn === true;
        if (line.checkedIn) {
          line.checkinAt = new Date().toISOString();
          line.checkinLat = Number(payload.geoLat);
          line.checkinLng = Number(payload.geoLng);
          line.checkinAccuracy = Number(payload.geoAccuracy);
          line.checkinSource = String(payload.geoSource || "browser_manual");
        } else {
          delete line.checkinAt;
          delete line.checkinLat;
          delete line.checkinLng;
          delete line.checkinAccuracy;
          delete line.checkinSource;
        }
        return {
          sessionCustomerId: line.id,
          checkedIn: line.checkedIn,
          checkinAt: line.checkinAt || null,
          geoLat: line.checkinLat ?? null,
          geoLng: line.checkinLng ?? null,
          geoAccuracy: line.checkinAccuracy ?? null
        };
      });
      await persistEvidence();
      return json(response, result.status, result.payload);
    }

    return json(response, 404, { error: { code: "not_found", message: `${request.method} ${url.pathname}` } });
  } catch (error) {
    return json(response, 500, { error: { code: "mock_error", message: error instanceof Error ? error.message : String(error) } });
  }
});

server.listen(port, "127.0.0.1", async () => {
  await persistEvidence();
  console.log(`F05 UI mock backend listening on 127.0.0.1:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

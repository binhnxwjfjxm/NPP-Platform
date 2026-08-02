import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { createFoundationGateway } from "./gateway.js";
import { handleOrderApi } from "./order-api.js";
import { handleRouteApi } from "./route-api.js";
import { handleTransitionalApi } from "./transitional-api.js";

function listen(server, host = "127.0.0.1") {
  server.listen(0, host);
  return once(server, "listening").then(() => server.address().port);
}

function request(port, path, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, method, headers }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({ status: res.statusCode, headers: res.headers, body: text ? JSON.parse(text) : null });
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

const readyPersistence = Object.freeze({
  async readiness() { return { provider: "postgresql", configured: true, ready: true }; },
  async assertReady() { return { provider: "postgresql", configured: true, ready: true }; },
  async close() {}
});

const legacyHandlers = Object.freeze({
  handleOrderApi,
  handleRouteApi,
  handleTransitionalApi,
  proxyToLegacy: true
});

async function setup(legacyHandler, configOverrides = {}) {
  const legacy = http.createServer(legacyHandler || ((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      path: req.url,
      requestId: req.headers["x-request-id"],
      installationId: req.headers["x-installation-id"],
      nppCode: req.headers["x-npp-code"],
      actorId: req.headers["x-actor-id"],
      idempotencyKey: req.headers["idempotency-key"] || null,
      leakedToken: Boolean(req.headers["x-backend-token"])
    }));
  }));
  const internalPort = await listen(legacy);
  const persistence = configOverrides.persistenceAdapter || readyPersistence;

  const config = {
    service: "mcp-plan-backend",
    publicHost: "127.0.0.1",
    publicPort: 0,
    internalHost: "127.0.0.1",
    internalPort,
    installationId: "installation-a",
    nppCode: "NPP-A",
    legacyActorId: "service:npp-a:mcp-v1",
    backendApiToken: "0123456789abcdef0123456789abcdef",
    authMode: "proxy-service",
    corsOrigins: ["https://app.example.com"],
    upstreamTimeoutMs: 1000,
    persistence: { provider: "postgresql", configured: true, schema: "mcp" },
    legacyRuntime: { enabled: true },
    ...configOverrides
  };

  const gateway = createFoundationGateway(config, { persistence, legacyHandlers });
  const publicPort = await listen(gateway);
  return { legacy, gateway, config, publicPort, persistence };
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

test("health and auth failures use the canonical envelope", async (t) => {
  const state = await setup();
  t.after(async () => { await close(state.gateway); await close(state.legacy); });

  for (const path of ["/", "/health", "/api/health", "/health/live", "/health/ready"]) {
    const health = await request(state.publicPort, path);
    assert.equal(health.status, 200);
    assert.equal(health.body.data.installationConfigured, true);
    assert.equal(health.body.data.installationId, undefined);
    assert.match(health.body.requestId, /^req_/);
    assert.equal(health.body.receivedAt.length > 0, true);
  }

  const unauthorized = await request(state.publicPort, "/api/routes");
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.body.error.code, "BACKEND_AUTH_REQUIRED");
  assert.deepEqual(unauthorized.body.error.details, {});
  assert.equal(unauthorized.body.error.retryable, false);
});

test("backend read API is served through the proxy token boundary", async (t) => {
  const queries = [];
  const persistence = Object.freeze({
    async readiness() { return { provider: "postgresql", configured: true, ready: true }; },
    async assertReady() { return { provider: "postgresql", configured: true, ready: true }; },
    async withTransaction(work) {
      return work({
        async query(sql, values) {
          queries.push({ sql, values });
          if (String(sql).startsWith("SELECT COUNT")) {
            return { rows: [{ count: 2 }] };
          }
          return { rows: [{ id: "route-1", route_name: "Tuyến Trà Sữa" }] };
        }
      });
    },
    async close() {}
  });
  const state = await setup(undefined, { persistenceAdapter: persistence });
  t.after(async () => { await close(state.gateway); await close(state.legacy); });

  const rows = await request(state.publicPort, "/api/read", {
    method: "POST",
    headers: {
      "x-backend-token": state.config.backendApiToken,
      "content-type": "application/json",
      origin: "https://app.example.com"
    },
    body: JSON.stringify({
      table: "mcp_routes",
      select: "id,route_name",
      order: "route_name.asc",
      limit: 1,
      filters: { active: true }
    })
  });

  assert.equal(rows.status, 200);
  assert.deepEqual(rows.body.data, [{ id: "route-1", route_name: "Tuyến Trà Sữa" }]);
  assert.match(queries[0].sql, /SELECT "id", "route_name" FROM "mcp_routes"/);
  assert.match(queries[0].sql, /WHERE "active" = \$1/);
  assert.match(queries[0].sql, /ORDER BY "route_name" ASC/);
  assert.match(queries[0].sql, /LIMIT \$2/);

  const count = await request(state.publicPort, "/api/read", {
    method: "POST",
    headers: {
      "x-backend-token": state.config.backendApiToken,
      "content-type": "application/json",
      origin: "https://app.example.com"
    },
    body: JSON.stringify({
      table: "mcp_session_reports",
      filters: { "raw_payload->>session_id": "session-1" },
      count: true
    })
  });

  assert.equal(count.status, 200);
  assert.equal(count.body.data, 2);
  assert.match(queries[1].sql, /SELECT COUNT\(\*\)::integer AS count FROM "mcp_session_reports"/);
  assert.match(queries[1].sql, /"raw_payload"->>'session_id' = \$1/);
});

test("liveness remains available while readiness fails closed", async (t) => {
  const unavailable = Object.freeze({
    async readiness() { return { provider: "postgresql", configured: false, ready: false, code: "missing_database_url" }; },
    async assertReady() { const error = new Error("missing_database_url"); error.code = "missing_database_url"; error.statusCode = 503; throw error; },
    async close() {}
  });
  const state = await setup(undefined, { persistenceAdapter: unavailable });
  t.after(async () => { await close(state.gateway); await close(state.legacy); });

  const live = await request(state.publicPort, "/health/live");
  assert.equal(live.status, 200);
  assert.equal(live.body.data.status, "live");

  for (const path of ["/health", "/api/health", "/health/ready"]) {
    const ready = await request(state.publicPort, path);
    assert.equal(ready.status, 503);
    assert.equal(ready.body.error.code, "PROVIDER_UNAVAILABLE");
    assert.deepEqual(ready.body.error.details, {});
    assert.equal(JSON.stringify(ready.body).includes("database"), false);
  }
});

test("gateway injects context and wraps legacy success as canonical data", async (t) => {
  const state = await setup();
  t.after(async () => { await close(state.gateway); await close(state.legacy); });

  const result = await request(state.publicPort, "/api/routes?active=true", {
    headers: {
      "x-backend-token": state.config.backendApiToken,
      "x-request-id": "request_12345678",
      "x-installation-id": "attacker",
      "x-actor-id": "attacker",
      "idempotency-key": "route-read-12345678",
      origin: "https://app.example.com"
    }
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.requestId, "request_12345678");
  assert.equal(result.body.data.path, "/api/routes?active=true");
  assert.equal(result.body.data.installationId, "installation-a");
  assert.equal(result.body.data.nppCode, "NPP-A");
  assert.equal(result.body.data.actorId, "service:npp-a:mcp-v1");
  assert.equal(result.body.data.idempotencyKey, "route-read-12345678");
  assert.equal(result.body.data.leakedToken, false);
  assert.equal(result.headers["access-control-allow-origin"], "https://app.example.com");
});

test("session mutation business errors remain canonical through the Gateway", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const target = String(url);
    const message = target.endsWith("/mcp_idempotent_record_session_customer_result")
      ? "session_customer_not_found"
      : target.endsWith("/mcp_idempotent_add_session_customer")
        ? "session_not_found"
        : null;
    if (!message) throw new Error(`unexpected_provider_request:${target}`);
    return new Response(JSON.stringify({ code: "23503", message }), {
      status: 404,
      headers: { "Content-Type": "application/json" }
    });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const state = await setup(undefined, {
    supabaseUrl: "https://project.example.com",
    supabaseServiceRoleKey: "server-only-key"
  });
  t.after(async () => { await close(state.gateway); await close(state.legacy); });

  const headers = {
    "x-backend-token": state.config.backendApiToken,
    "content-type": "application/json",
    "idempotency-key": "gateway-business-error-12345678"
  };

  const result = await request(state.publicPort, "/api/mcp-day/session-customer/result", {
    method: "POST",
    headers: { ...headers, "x-request-id": "request_result_12345678" },
    body: JSON.stringify({ sessionCustomerId: "missing-sc", note: "smoke" })
  });
  assert.equal(result.status, 404);
  assert.equal(result.body.error.code, "SESSION_CUSTOMER_NOT_FOUND");
  assert.deepEqual(result.body.error.details, {});
  assert.equal(result.body.error.retryable, false);

  const add = await request(state.publicPort, "/api/mcp-day/session-customer/add", {
    method: "POST",
    headers: { ...headers, "x-request-id": "request_add_12345678" },
    body: JSON.stringify({ sessionId: "missing-session", customerName: "Khách phát sinh" })
  });
  assert.equal(add.status, 404);
  assert.equal(add.body.error.code, "SESSION_NOT_FOUND");
  assert.deepEqual(add.body.error.details, {});
  assert.equal(add.body.error.retryable, false);
});

test("CORS is deny-by-default with canonical errors", async (t) => {
  const state = await setup();
  t.after(async () => { await close(state.gateway); await close(state.legacy); });

  const denied = await request(state.publicPort, "/api/routes", {
    headers: { "x-backend-token": state.config.backendApiToken, origin: "https://evil.example.com" }
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error.code, "CORS_ORIGIN_DENIED");
});

test("legacy provider diagnostics are removed at the public boundary", async (t) => {
  const state = await setup((_req, res) => {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      ok: false,
      error: "supabase_read_failed",
      detail: "column orders.secret does not exist",
      table: "orders"
    }));
  });
  t.after(async () => { await close(state.gateway); await close(state.legacy); });

  const result = await request(state.publicPort, "/api/routes", {
    headers: { "x-backend-token": state.config.backendApiToken }
  });
  assert.equal(result.status, 502);
  assert.equal(result.body.error.code, "PROVIDER_UNAVAILABLE");
  assert.deepEqual(result.body.error.details, {});
  assert.equal(JSON.stringify(result.body).includes("orders"), false);
  assert.equal(JSON.stringify(result.body).includes("column"), false);
});

test("non-JSON upstream responses fail closed", async (t) => {
  const state = await setup((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("provider stack trace");
  });
  t.after(async () => { await close(state.gateway); await close(state.legacy); });

  const result = await request(state.publicPort, "/api/routes", {
    headers: { "x-backend-token": state.config.backendApiToken }
  });
  assert.equal(result.status, 502);
  assert.equal(result.body.error.code, "UPSTREAM_RESPONSE_INVALID");
  assert.equal(JSON.stringify(result.body).includes("stack trace"), false);
});

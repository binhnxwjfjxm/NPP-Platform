import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { handleRouteApi } from "./route-api.js";

const config = {
  supabaseUrl: "https://project.example.com",
  supabaseServiceRoleKey: "server-only-key"
};

const context = {
  requestId: "request-route-master-12345678",
  idempotencyKey: "route.master.write:abcdefgh",
  receivedAt: "2026-07-19T12:00:00.000Z",
  installation: { id: "installation-a", nppCode: "NPP-A" },
  actor: { id: "service:npp-a:mcp-v1", type: "service", authentication: "backend-token" }
};

function request(method, body) {
  const stream = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
  stream.method = method;
  stream.headers = {};
  return stream;
}

test("route API intercepts route and route-customer writes before legacy fallback", async () => {
  const cases = [
    {
      method: "POST",
      route: "/api/routes",
      rpc: "mcp_idempotent_create_route",
      body: { routeName: "Tuyến A", weekday: 1 }
    },
    {
      method: "PATCH",
      route: "/api/routes/route-1",
      rpc: "mcp_idempotent_update_route",
      body: { routeName: "Tuyến A mới", active: false }
    },
    {
      method: "PATCH",
      route: "/api/route-customers/route-customer-1",
      rpc: "mcp_idempotent_update_route_customer",
      body: { customerName: "Điểm bán A", geoLat: 10.75, geoLng: 106.66 }
    }
  ];

  for (const item of cases) {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({
        data: { id: "result-1", routeId: "route-1" },
        meta: { idempotency: { replayed: false } }
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    };

    const result = await handleRouteApi(
      request(item.method, item.body),
      new URL(`http://local${item.route}`),
      context,
      config,
      { fetchImpl }
    );

    assert.equal(result.statusCode, 200, item.route);
    assert.equal(result.payload.meta.idempotency.replayed, false, item.route);
    assert.equal(calls.length, 1, item.route);
    assert.equal(new URL(calls[0].url).pathname.split("/").at(-1), item.rpc, item.route);
  }
});

test("archive routes are claimed by the cross-system archive intent owner", async () => {
  for (const item of [
    { path: "/api/routes/route-1/archive", targetId: "route-1" },
    { path: "/api/route-customers/route-customer-1/archive", targetId: "route-customer-1" }
  ]) {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({
        mode: "replay",
        intent: {
          id: "mai-replay",
          status: "completed",
          response_payload: {
            targetId: item.targetId,
            deleteJobId: "msdj-replay",
            deleted: true,
            deletedMediaCount: 1
          }
        }
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    };

    const result = await handleRouteApi(
      request("POST"),
      new URL(`http://local${item.path}`),
      context,
      config,
      { fetchImpl }
    );

    assert.equal(result.statusCode, 200, item.path);
    assert.equal(result.payload.data.targetId, item.targetId, item.path);
    assert.equal(result.payload.meta.idempotency.replayed, true, item.path);
    assert.equal(calls.length, 1, item.path);
    assert.equal(new URL(calls[0].url).pathname.split("/").at(-1), "mcp_claim_archive_intent", item.path);
  }
});

test("dynamic route and route-customer ids are decoded once", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({
      data: { id: "result id" },
      meta: { idempotency: { replayed: false } }
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  await handleRouteApi(
    request("PATCH", { active: true }),
    new URL("http://local/api/routes/route%20id"),
    context,
    config,
    { fetchImpl }
  );

  await handleRouteApi(
    request("PATCH", { active: true }),
    new URL("http://local/api/route-customers/route-customer%20id"),
    context,
    config,
    { fetchImpl }
  );

  const routeArgs = JSON.parse(calls[0].init.body);
  const customerArgs = JSON.parse(calls[1].init.body);
  assert.equal(routeArgs.p_route_id, "route id");
  assert.equal(customerArgs.p_route_customer_id, "route-customer id");
});

test("internal F05 fixture inventory pages all routes and returns only exact-prefix rows", async () => {
  const calls = [];
  const pageOne = Array.from({ length: 500 }, (_, index) => ({
    id: `route-${index}`,
    route_name: index === 499 ? "__NPP_F05_RUNTIME_SMOKE__PAGE_ONE" : `Tuyến ${index}`,
    note: ""
  }));
  const pageTwo = [
    { id: "route-500", route_name: "Tuyến 500", note: "" },
    { id: "route-smoke-note", route_name: "Tuyến thường", note: "__NPP_F05_RUNTIME_SMOKE__PAGE_TWO" }
  ];
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    calls.push(parsed);
    const offset = Number(parsed.searchParams.get("offset") || 0);
    return new Response(JSON.stringify(offset === 0 ? pageOne : pageTwo), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  const result = await handleRouteApi(
    request("GET"),
    new URL("http://local/api/internal/f05-smoke-fixtures"),
    context,
    config,
    { fetchImpl }
  );

  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.payload.data.map((row) => row.id), ["route-499", "route-smoke-note"]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].searchParams.get("offset"), "0");
  assert.equal(calls[1].searchParams.get("offset"), "500");
});

test("internal F05 fixture inventory rejects non-service actors before provider access", async () => {
  let providerCalled = false;
  const userContext = {
    ...context,
    actor: { id: "user-1", type: "user", authentication: "session" }
  };

  await assert.rejects(
    handleRouteApi(
      request("GET"),
      new URL("http://local/api/internal/f05-smoke-fixtures"),
      userContext,
      config,
      { fetchImpl: async () => { providerCalled = true; return new Response("[]"); } }
    ),
    (error) => error?.statusCode === 403 && error?.message === "f05_fixture_inventory_forbidden"
  );
  assert.equal(providerCalled, false);
});


test("typed route API serves /api/routes/data from PostgreSQL with installation scope", async () => {
  const queries = [];
  const persistence = {
    async assertReady() {},
    async withTransaction(work) {
      return work({
        async query(sql, values) {
          queries.push({ sql: String(sql), values });
          if (String(sql).includes("FROM mcp.mcp_routes")) {
            return { rows: [
              { id: "route-1", route_name: "Tuyến Bình Đại", area: "Bến Tre", active: true, weekday: 1, note: "Thứ 2", sales: "Sale A", created_at: "2026-09-30T00:00:00Z" },
              { id: "route-2", route_name: "Tuyến tạm dừng", area: "Ba Tri", active: false, weekday: null, note: "", sales: null, created_at: "2026-09-29T00:00:00Z" }
            ] };
          }
          if (String(sql).includes("FROM mcp.mcp_route_customers")) {
            return { rows: [
              { route_id: "route-1", active: true },
              { route_id: "route-1", active: true },
              { route_id: "route-2", active: false }
            ] };
          }
          if (String(sql).includes("FROM mcp.mcp_route_sessions")) {
            return { rows: [
              { id: "session-1", route_id: "route-1", session_date: "2026-09-30", visited_customers: 1, order_count: 2, status: "active", created_at: "2026-09-30T08:00:00Z" }
            ] };
          }
          throw new Error("unexpected query");
        }
      });
    }
  };

  const result = await handleRouteApi(
    request("GET"),
    new URL("http://local/api/routes/data"),
    context,
    { persistence: { provider: "postgresql" } },
    { persistence }
  );

  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.data.routes.length, 2);
  assert.deepEqual(result.payload.data.routes[0], {
    id: "route-1",
    name: "Tuyến Bình Đại",
    area: "Bến Tre",
    salesOwner: "Sale A",
    plannedCustomers: 2,
    visitedCustomers: 1,
    orderCount: 2,
    lastVisitDate: "2026-09-30",
    activeSessionId: "session-1",
    activeSessionDate: "2026-09-30",
    status: "watch",
    weekday: 1,
    note: "Thứ 2"
  });
  assert.equal(result.payload.data.routes[1].status, "paused");
  assert.equal(result.payload.data.kpis[1].value, 2);
  assert.equal(queries.length, 3);
  assert.equal(queries.every((item) => item.values[0] === "installation-a"), true);
});

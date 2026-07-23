import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { handleTransitionalApi } from "./transitional-api.js";

const config = {
  supabaseUrl: "https://project.example.com",
  supabaseServiceRoleKey: "server-only-key"
};

const context = {
  requestId: "request-session-lifecycle-12345678",
  idempotencyKey: "route-session.lifecycle:abcdefgh",
  receivedAt: "2026-07-19T10:00:00.000Z",
  installation: { id: "installation-a", nppCode: "NPP-A" },
  actor: { id: "service:npp-a:mcp-v1", type: "service", authentication: "backend-token" }
};

function request(method, body) {
  const stream = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
  stream.method = method;
  stream.headers = {};
  return stream;
}

const cases = [
  {
    method: "POST",
    route: "/api/mcp-day/open-session",
    rpc: "mcp_idempotent_open_route_session",
    body: { routeId: "route-1", sessionDate: "2026-07-19", owner: "Sale A" }
  },
  {
    method: "POST",
    route: "/api/mcp-day/session-customer/status",
    rpc: "mcp_idempotent_set_session_customer_status",
    body: { sessionCustomerId: "sc-1", visitStatus: "visited" }
  },
  {
    method: "PATCH",
    route: "/api/mcp-sessions/session-1",
    rpc: "mcp_idempotent_update_route_session",
    body: { sessionDate: "2026-07-20", status: "done", note: "Chốt phiên" }
  },
  {
    method: "DELETE",
    route: "/api/mcp-sessions/session-empty",
    rpc: "mcp_idempotent_delete_empty_route_session"
  }
];

test("Foundation intercepts four A5.5.2 session lifecycle routes before legacy proxy", async () => {
  for (const item of cases) {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({
        data: { id: "result-1", deleted: item.method === "DELETE" },
        meta: { idempotency: { replayed: false } }
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    };

    const result = await handleTransitionalApi(
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

test("dynamic session id is decoded once and passed to the typed RPC", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({
      data: { id: "session id" },
      meta: { idempotency: { replayed: false } }
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  await handleTransitionalApi(
    request("PATCH", { status: "cancelled" }),
    new URL("http://local/api/mcp-sessions/session%20id"),
    context,
    config,
    { fetchImpl }
  );

  const args = JSON.parse(calls[0].init.body);
  assert.equal(args.p_session_id, "session id");
});

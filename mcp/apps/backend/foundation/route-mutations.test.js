import test from "node:test";
import assert from "node:assert/strict";
import { createRoute, updateRoute } from "./route-mutations.js";

const config = {
  supabaseUrl: "https://example.supabase.co",
  supabaseServiceRoleKey: "server-only-key"
};

const context = {
  requestId: "request-route-master-12345678",
  idempotencyKey: "route.master.write:12345678",
  receivedAt: "2026-07-19T12:00:00.000Z",
  installation: { id: "installation-a", nppCode: "NPP-A" },
  actor: { id: "service:npp-a:mcp-v1", type: "service", authentication: "backend-token" }
};

function provider(calls, payload = { data: { routeId: "route-1" }, meta: { idempotency: { replayed: false } } }) {
  return async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };
}

test("route create and update call exact typed wrappers with trusted context", async () => {
  const calls = [];
  const fetchImpl = provider(calls);

  await createRoute({
    routeName: "Tuyến Quận 5",
    area: "Quận 5",
    weekday: "5",
    note: "Thứ sáu",
    distributorId: "dist-1"
  }, context, config, { fetchImpl });

  await updateRoute("route-1", {
    routeName: "Tuyến Quận 5 mới",
    area: "Quận 5",
    weekday: 6,
    active: false,
    note: "Thứ bảy"
  }, context, config, { fetchImpl });

  const rpcNames = calls.map((call) => new URL(call.url).pathname.split("/").at(-1));
  assert.deepEqual(rpcNames, ["mcp_idempotent_create_route", "mcp_idempotent_update_route"]);

  for (const call of calls) {
    const args = JSON.parse(call.init.body);
    assert.equal(args.p_context.requestId, context.requestId);
    assert.equal(args.p_context.idempotencyKey, context.idempotencyKey);
    assert.equal(args.p_context.installationId, "installation-a");
    assert.equal(args.p_context.actorId, "service:npp-a:mcp-v1");
  }

  const createArgs = JSON.parse(calls[0].init.body);
  assert.equal(createArgs.p_route_name, "Tuyến Quận 5");
  assert.equal(createArgs.p_weekday, 5);
  assert.equal(createArgs.p_distributor_id, "dist-1");

  const updateArgs = JSON.parse(calls[1].init.body);
  assert.equal(updateArgs.p_route_id, "route-1");
  assert.equal(updateArgs.p_weekday, 6);
  assert.equal(updateArgs.p_active, false);
});

test("route validation rejects bad input before provider access", async () => {
  let providerCalls = 0;
  const fetchImpl = async () => {
    providerCalls += 1;
    throw new Error("provider_must_not_be_called");
  };

  await assert.rejects(
    createRoute({ routeName: "", weekday: 1 }, context, config, { fetchImpl }),
    (error) => error.message === "route_name_required" && error.statusCode === 400
  );

  await assert.rejects(
    createRoute({ routeName: "Tuyến", weekday: 7 }, context, config, { fetchImpl }),
    (error) => error.message === "invalid_weekday" && error.statusCode === 400
  );

  await assert.rejects(
    updateRoute("route-1", { active: "sometimes" }, context, config, { fetchImpl }),
    (error) => error.message === "invalid_active" && error.statusCode === 400
  );

  await assert.rejects(
    updateRoute("", {}, context, config, { fetchImpl }),
    (error) => error.message === "route_id_required" && error.statusCode === 400
  );

  assert.equal(providerCalls, 0);
});

test("route not found is normalized to a public 404 business code", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ message: "route_not_found" }), {
    status: 400,
    headers: { "Content-Type": "application/json" }
  });

  await assert.rejects(
    updateRoute("missing", {}, context, config, { fetchImpl }),
    (error) => error.code === "route_not_found" && error.statusCode === 404
  );
});

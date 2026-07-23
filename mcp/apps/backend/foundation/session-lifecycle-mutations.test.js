import test from "node:test";
import assert from "node:assert/strict";
import {
  deleteEmptyRouteSession,
  openRouteSession,
  setSessionCustomerStatus,
  updateRouteSession
} from "./session-lifecycle-mutations.js";

const config = {
  supabaseUrl: "https://example.supabase.co",
  supabaseServiceRoleKey: "server-only-key"
};

const context = {
  requestId: "request-session-lifecycle-12345678",
  idempotencyKey: "route-session.lifecycle:12345678",
  receivedAt: "2026-07-19T10:00:00.000Z",
  installation: { id: "installation-a", nppCode: "NPP-A" },
  actor: { id: "service:npp-a:mcp-v1", type: "service", authentication: "backend-token" }
};

function provider(calls, payload = { data: { id: "result-1" }, meta: { idempotency: { replayed: false } } }) {
  return async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };
}

test("session lifecycle calls four typed idempotent RPCs with trusted Foundation context", async () => {
  const calls = [];
  const fetchImpl = provider(calls);

  await openRouteSession({
    routeId: "route-1",
    sessionDate: "2026-07-19",
    owner: "Sale A"
  }, context, config, { fetchImpl });

  await setSessionCustomerStatus({
    sessionCustomerId: "sc-1",
    visitStatus: "skipped",
    statusReason: "Khách đóng cửa",
    note: "Ghé lại"
  }, context, config, { fetchImpl });

  await updateRouteSession("session-1", {
    sessionDate: "2026-07-20",
    status: "completed",
    note: "Đã chốt"
  }, context, config, { fetchImpl });

  await deleteEmptyRouteSession("session-empty", context, config, { fetchImpl });

  const rpcNames = calls.map((call) => new URL(call.url).pathname.split("/").at(-1));
  assert.deepEqual(rpcNames, [
    "mcp_idempotent_open_route_session",
    "mcp_idempotent_set_session_customer_status",
    "mcp_idempotent_update_route_session",
    "mcp_idempotent_delete_empty_route_session"
  ]);

  for (const call of calls) {
    const args = JSON.parse(call.init.body);
    assert.equal(args.p_context.requestId, context.requestId);
    assert.equal(args.p_context.idempotencyKey, context.idempotencyKey);
    assert.equal(args.p_context.installationId, "installation-a");
    assert.equal(args.p_context.actorId, "service:npp-a:mcp-v1");
  }

  const openArgs = JSON.parse(calls[0].init.body);
  assert.equal(openArgs.p_route_id, "route-1");
  assert.equal(openArgs.p_session_date, "2026-07-19");
  assert.equal(openArgs.p_owner, "Sale A");

  const statusArgs = JSON.parse(calls[1].init.body);
  assert.equal(statusArgs.p_visit_status, "skipped");
  assert.equal(statusArgs.p_status_reason, "Khách đóng cửa");

  const updateArgs = JSON.parse(calls[2].init.body);
  assert.equal(updateArgs.p_status, "done");
  assert.equal(updateArgs.p_session_date, "2026-07-20");

  const deleteArgs = JSON.parse(calls[3].init.body);
  assert.equal(deleteArgs.p_session_id, "session-empty");
});

test("session lifecycle validation rejects invalid input before provider access", async () => {
  let providerCalls = 0;
  const fetchImpl = async () => {
    providerCalls += 1;
    throw new Error("provider_must_not_be_called");
  };

  await assert.rejects(
    openRouteSession({ routeId: "route-1", sessionDate: "19/07/2026" }, context, config, { fetchImpl }),
    (error) => error.message === "invalid_session_date" && error.statusCode === 400
  );

  await assert.rejects(
    setSessionCustomerStatus({ sessionCustomerId: "sc-1", visitStatus: "skipped" }, context, config, { fetchImpl }),
    (error) => error.message === "status_reason_required" && error.statusCode === 400
  );

  await assert.rejects(
    updateRouteSession("session-1", { status: "archived" }, context, config, { fetchImpl }),
    (error) => error.message === "invalid_session_status" && error.statusCode === 400
  );

  await assert.rejects(
    deleteEmptyRouteSession("", context, config, { fetchImpl }),
    (error) => error.message === "session_id_required" && error.statusCode === 400
  );

  assert.equal(providerCalls, 0);
});

test("business lifecycle conflicts are normalized without leaking provider diagnostics", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    message: "session_has_activity_cancel_instead",
    details: "provider table detail"
  }), {
    status: 400,
    headers: { "Content-Type": "application/json" }
  });

  await assert.rejects(
    deleteEmptyRouteSession("session-1", context, config, { fetchImpl }),
    (error) => {
      assert.equal(error.code, "session_has_activity_cancel_instead");
      assert.equal(error.statusCode, 409);
      return true;
    }
  );
});

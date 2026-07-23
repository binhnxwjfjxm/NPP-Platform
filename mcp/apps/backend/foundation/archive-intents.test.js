import test from "node:test";
import assert from "node:assert/strict";
import { archiveRoute, archiveRouteCustomer } from "./archive-intents.js";

const config = {
  supabaseUrl: "https://project.example.com",
  supabaseServiceRoleKey: "service-role"
};

const context = {
  requestId: "request-archive-intent-12345678",
  idempotencyKey: "route.archive:route-1",
  receivedAt: "2026-07-20T08:00:00.000Z",
  installation: { id: "installation-a", nppCode: "NPP-A" },
  actor: { id: "service:npp-a:mcp-v1", type: "service", authentication: "backend-token" }
};

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function rpcName(input) {
  return new URL(typeof input === "string" ? input : input.url || String(input)).pathname.split("/").at(-1);
}

test("completed archive intent replays without touching the R2 lifecycle", async () => {
  const calls = [];
  const fetchImpl = async (input) => {
    const rpc = rpcName(input);
    calls.push(rpc);
    assert.equal(rpc, "mcp_claim_archive_intent");
    return json({
      mode: "replay",
      intent: {
        id: "mai-route-1",
        status: "completed",
        response_status: 200,
        response_payload: {
          targetType: "route",
          targetId: "route-1",
          deleteJobId: "msdj-route-1",
          deleted: true,
          deletedMediaCount: 2
        },
        raw_payload: { request_context: { requestId: "original-request" } }
      },
      deleteJob: { id: "msdj-route-1", status: "completed" }
    });
  };

  const result = await archiveRoute("route-1", context, config, { fetchImpl });
  assert.deepEqual(calls, ["mcp_claim_archive_intent"]);
  assert.equal(result.data.targetId, "route-1");
  assert.equal(result.data.deletedMediaCount, 2);
  assert.equal(result.meta.idempotency.replayed, true);
  assert.equal(result.meta.idempotency.originalRequestId, "original-request");
});

test("new route archive delegates deletion and hard-delete to the existing outlet-media owner", async () => {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const rpc = rpcName(input);
    calls.push(rpc);
    if (rpc === "mcp_claim_archive_intent") {
      const body = JSON.parse(init.body);
      assert.equal(body.p_operation, "route.archive");
      assert.equal(body.p_target_type, "route");
      assert.equal(body.p_target_id, "route-1");
      assert.equal(body.p_context.idempotencyKey, context.idempotencyKey);
      return json({ mode: "execute", intent: { id: "mai-route-1", status: "processing" } });
    }
    if (rpc === "mcp_claim_route_media_delete") {
      return json({
        deleteJob: { id: "msdj-route-1", target_type: "route", target_id: "route-1" },
        route: { id: "route-1" },
        media: []
      });
    }
    if (rpc === "mcp_delete_route_hard") return json({ routeId: "route-1", deleted: true });
    if (rpc === "mcp_finish_storage_delete_job") return json({ id: "msdj-route-1", status: "completed" });
    if (rpc === "mcp_finish_archive_intent") {
      const body = JSON.parse(init.body);
      assert.equal(body.p_succeeded, true);
      assert.equal(body.p_response_payload.targetId, "route-1");
      assert.equal(body.p_response_payload.deleteJobId, "msdj-route-1");
      return json({
        id: "mai-route-1",
        status: "completed",
        response_payload: body.p_response_payload
      });
    }
    throw new Error(`unexpected_rpc:${rpc}`);
  };

  const result = await archiveRoute("route-1", context, config, { fetchImpl });
  assert.deepEqual(calls, [
    "mcp_claim_archive_intent",
    "mcp_claim_route_media_delete",
    "mcp_delete_route_hard",
    "mcp_finish_storage_delete_job",
    "mcp_finish_archive_intent"
  ]);
  assert.equal(result.data.deleted, true);
  assert.equal(result.data.deleteJobId, "msdj-route-1");
  assert.equal(result.meta.idempotency.replayed, false);
});

test("route-customer archive keeps the exact operation and canonical target owner", async () => {
  const calls = [];
  const customerContext = {
    ...context,
    idempotencyKey: "route-customer.archive:route-customer-1"
  };
  const fetchImpl = async (input, init = {}) => {
    const rpc = rpcName(input);
    calls.push(rpc);
    if (rpc === "mcp_claim_archive_intent") {
      const body = JSON.parse(init.body);
      assert.equal(body.p_operation, "route-customer.archive");
      assert.equal(body.p_target_type, "route_customer");
      return json({ mode: "execute", intent: { id: "mai-customer-1", status: "processing" } });
    }
    if (rpc === "mcp_claim_route_customer_media_delete") {
      return json({
        deleteJob: { id: "msdj-customer-1", target_type: "route_customer", target_id: "route-customer-1" },
        routeCustomer: { id: "route-customer-1" },
        media: []
      });
    }
    if (rpc === "mcp_delete_route_customer_hard") return json({ routeCustomerId: "route-customer-1", deleted: true });
    if (rpc === "mcp_finish_storage_delete_job") return json({ id: "msdj-customer-1", status: "completed" });
    if (rpc === "mcp_finish_archive_intent") {
      const body = JSON.parse(init.body);
      return json({ id: "mai-customer-1", status: "completed", response_payload: body.p_response_payload });
    }
    throw new Error(`unexpected_rpc:${rpc}`);
  };

  const result = await archiveRouteCustomer("route-customer-1", customerContext, config, { fetchImpl });
  assert.deepEqual(calls, [
    "mcp_claim_archive_intent",
    "mcp_claim_route_customer_media_delete",
    "mcp_delete_route_customer_hard",
    "mcp_finish_storage_delete_job",
    "mcp_finish_archive_intent"
  ]);
  assert.equal(result.data.targetType, "route_customer");
  assert.equal(result.data.targetId, "route-customer-1");
});

test("concurrent missing-parent response re-reads the intent and replays the completed job", async () => {
  const calls = [];
  let claimCount = 0;
  const fetchImpl = async (input) => {
    const rpc = rpcName(input);
    calls.push(rpc);
    if (rpc === "mcp_claim_archive_intent") {
      claimCount += 1;
      if (claimCount === 1) {
        return json({
          mode: "execute",
          intent: { id: "mai-route-1", status: "processing", delete_job_id: null },
          deleteJob: null
        });
      }
      return json({
        mode: "replay",
        intent: {
          id: "mai-route-1",
          status: "completed",
          delete_job_id: "msdj-route-1",
          response_payload: {
            targetType: "route",
            targetId: "route-1",
            deleteJobId: "msdj-route-1",
            deleted: true,
            deletedMediaCount: 1
          },
          raw_payload: { request_context: { requestId: "first-concurrent-request" } }
        },
        deleteJob: { id: "msdj-route-1", status: "completed" }
      });
    }
    if (rpc === "mcp_claim_route_media_delete") return json({ message: "route_not_found" }, 400);
    throw new Error(`unexpected_rpc:${rpc}`);
  };

  const result = await archiveRoute("route-1", context, config, { fetchImpl });
  assert.deepEqual(calls, [
    "mcp_claim_archive_intent",
    "mcp_claim_route_media_delete",
    "mcp_claim_archive_intent"
  ]);
  assert.equal(result.data.deleted, true);
  assert.equal(result.data.deleteJobId, "msdj-route-1");
  assert.equal(result.meta.idempotency.replayed, true);
  assert.equal(result.meta.idempotency.originalRequestId, "first-concurrent-request");
});

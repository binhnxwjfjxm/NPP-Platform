import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { handleTransitionalApi } from "./transitional-api.js";

const config = {
  supabaseUrl: "https://project.example.com",
  supabaseServiceRoleKey: "server-only-key"
};

const context = {
  requestId: "request_12345678",
  installation: { id: "installation-a", nppCode: "NPP-A" },
  actor: { id: "service:npp-a:mcp-v1", type: "service", authentication: "proxy-token" }
};

const edgeFunctionPath = ["", "functions", "v1", ""].join("/");

function request(method, body) {
  const stream = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
  stream.method = method;
  stream.headers = {};
  return stream;
}

test("session customer result uses the atomic RPC instead of the public Edge function", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({
      sessionCustomer: { id: "session-customer-1", visit_status: "visited" },
      visit: { id: "visit-1", has_order: true },
      createdVisit: true
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  const result = await handleTransitionalApi(
    request("POST", {
      sessionCustomerId: "session-customer-1",
      resultType: "order",
      orderId: "order-1",
      hasOrder: true,
      note: "Đã chốt đơn"
    }),
    new URL("http://local/api/mcp-day/session-customer/result"),
    context,
    config,
    { fetchImpl }
  );

  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.data.visit.id, "visit-1");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/rest\/v1\/rpc\/mcp_idempotent_record_session_customer_result$/);
  assert.equal(calls[0].url.includes(edgeFunctionPath), false);
  assert.equal(calls[0].init.headers.apikey, "server-only-key");

  const args = JSON.parse(calls[0].init.body);
  assert.equal(args.p_session_customer_id, "session-customer-1");
  assert.equal(args.p_result_type, "order");
  assert.equal(args.p_order_id, "order-1");
  assert.equal(args.p_has_order, true);
  assert.equal(args.p_context.requestId, "request_12345678");
  assert.equal(args.p_context.installationId, "installation-a");
  assert.equal(args.p_context.actorId, "service:npp-a:mcp-v1");
});

test("session customer add requires an explicit session and uses the atomic RPC", async () => {
  let providerCalled = false;
  await assert.rejects(
    handleTransitionalApi(
      request("POST", { customerName: "Khách phát sinh" }),
      new URL("http://local/api/mcp-day/session-customer/add"),
      context,
      config,
      { fetchImpl: async () => { providerCalled = true; } }
    ),
    (error) => error.message === "session_id_required" && error.statusCode === 400
  );
  assert.equal(providerCalled, false);

  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({
      sessionCustomer: { id: "session-customer-added", source: "added" },
      created: true
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  const result = await handleTransitionalApi(
    request("POST", {
      sessionId: "session-1",
      customerName: "Khách phát sinh",
      phone: "0900000000",
      area: "Khu vực A"
    }),
    new URL("http://local/api/mcp-day/session-customer/add"),
    context,
    config,
    { fetchImpl }
  );

  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.data.sessionCustomer.id, "session-customer-added");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/rest\/v1\/rpc\/mcp_idempotent_add_session_customer$/);
  assert.equal(calls[0].url.includes(edgeFunctionPath), false);

  const args = JSON.parse(calls[0].init.body);
  assert.equal(args.p_session_id, "session-1");
  assert.equal(args.p_customer_name, "Khách phát sinh");
  assert.equal(args.p_phone, "0900000000");
  assert.equal(args.p_context.nppCode, "NPP-A");
});

test("closed session provider errors become business conflicts", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    code: "23514",
    message: "session_closed_read_only"
  }), {
    status: 400,
    headers: { "Content-Type": "application/json" }
  });

  await assert.rejects(
    handleTransitionalApi(
      request("POST", { sessionCustomerId: "session-customer-1", note: "Đã ghé" }),
      new URL("http://local/api/mcp-day/session-customer/result"),
      context,
      config,
      { fetchImpl }
    ),
    (error) =>
      error.message === "provider_request_failed" &&
      error.statusCode === 409 &&
      error.code === "session_closed_read_only"
  );
});

test("unrecognized provider failures remain infrastructure errors", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    message: "database connection failed"
  }), {
    status: 500,
    headers: { "Content-Type": "application/json" }
  });

  await assert.rejects(
    handleTransitionalApi(
      request("POST", { sessionCustomerId: "session-customer-1", note: "Đã ghé" }),
      new URL("http://local/api/mcp-day/session-customer/result"),
      context,
      config,
      { fetchImpl }
    ),
    (error) =>
      error.message === "provider_request_failed" &&
      error.statusCode === 502 &&
      error.code === undefined
  );
});

test("field check writes use the typed RPC with mapped status and Foundation context", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ id: "result-1", product_name: "Sản phẩm A", status: "interested" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  const result = await handleTransitionalApi(
    request("POST", {
      resultId: "result-1",
      fileId: "file-1",
      customerId: "customer-1",
      sessionCustomerId: "session-customer-1",
      productName: "Sản phẩm A",
      status: "opportunity"
    }),
    new URL("http://local/api/field-checks/result"),
    context,
    config,
    { fetchImpl }
  );

  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.data.id, "result-1");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/rest\/v1\/rpc\/mcp_idempotent_update_field_check_result$/);
  const args = JSON.parse(calls[0].init.body);
  assert.equal(args.p_result_id, "result-1");
  assert.equal(args.p_status, "interested");
  assert.equal(args.p_context.requestId, "request_12345678");
  assert.equal(args.p_context.installationId, "installation-a");
  assert.equal(args.p_context.actorId, "service:npp-a:mcp-v1");
});

test("field check requires an existing result id before provider access", async () => {
  let providerCalled = false;
  await assert.rejects(
    handleTransitionalApi(
      request("POST", { productName: "Sản phẩm A", status: "normal" }),
      new URL("http://local/api/field-checks/result"),
      context,
      config,
      { fetchImpl: async () => { providerCalled = true; } }
    ),
    (error) => error.message === "result_id_required" && error.statusCode === 400
  );
  assert.equal(providerCalled, false);
});

test("product search runs the canonical RPC behind the boundary", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify([{ id: "product-1" }]), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  const result = await handleTransitionalApi(
    request("GET"),
    new URL("http://local/api/products/search?q=gao&limit=500"),
    context,
    config,
    { fetchImpl }
  );

  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.payload.data, [{ id: "product-1" }]);
  assert.match(calls[0].url, /\/rest\/v1\/rpc\/mcp_search_products$/);
  const args = JSON.parse(calls[0].init.body);
  assert.equal(args.p_q, "gao");
  assert.equal(args.p_limit, 100);
});

test("unknown route is delegated to legacy runtime", async () => {
  const result = await handleTransitionalApi(
    request("GET"),
    new URL("http://local/api/routes"),
    context,
    config,
    { fetchImpl: async () => { throw new Error("must_not_call_provider"); } }
  );
  assert.equal(result, null);
});

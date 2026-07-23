import test from "node:test";
import assert from "node:assert/strict";
import { createOrder } from "./order-mutations.js";

const config = {
  supabaseUrl: "https://example.supabase.co",
  supabaseServiceRoleKey: "server-only-key"
};

const context = {
  requestId: "request-order-12345678",
  idempotencyKey: "order.create:12345678",
  receivedAt: "2026-07-19T12:00:00.000Z",
  installation: { id: "installation-a", nppCode: "NPP-A" },
  actor: { id: "service:npp-a:orders", type: "service", authentication: "backend-token" }
};

function provider(calls) {
  return async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({
      data: { orderId: "order-1", orderCode: "ORD-20260719-ABC123", grandTotal: 20000 },
      meta: { idempotency: { replayed: false } }
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };
}

test("standalone order owner supports an existing route customer", async () => {
  const calls = [];
  const result = await createOrder({
    customerMode: "existing",
    routeCustomerId: "route-customer-1",
    sales: "Sale A",
    status: "confirmed",
    items: [{ productId: "product-1", variantId: "variant-1", productName: "Trà", quantity: 2, unitPrice: 10000 }]
  }, context, config, { fetchImpl: provider(calls) });

  assert.equal(result.data.orderId, "order-1");
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).pathname, "/rest/v1/rpc/mcp_idempotent_create_order");
  const args = JSON.parse(calls[0].init.body);
  assert.equal(args.p_customer_mode, "existing");
  assert.equal(args.p_route_customer_id, "route-customer-1");
  assert.equal(args.p_customer_name, null);
  assert.equal(args.p_items[0].quantity, 2);
  assert.equal(args.p_context.idempotencyKey, context.idempotencyKey);
  assert.equal(args.p_context.actorId, context.actor.id);
});

test("standalone order owner supports manual customer snapshots without creating route master data", async () => {
  const calls = [];
  await createOrder({
    customerMode: "manual",
    customer: { name: "Khách vãng lai", phone: "0909000000", area: "Chợ Gạo", address: "12 Đường A" },
    items: [{ productName: "Sữa", quantity: 1, unitPrice: 15000 }],
    status: "draft"
  }, context, config, { fetchImpl: provider(calls) });

  const args = JSON.parse(calls[0].init.body);
  assert.equal(args.p_customer_mode, "manual");
  assert.equal(args.p_route_customer_id, null);
  assert.equal(args.p_customer_name, "Khách vãng lai");
  assert.equal(args.p_customer_phone, "0909000000");
  assert.equal(args.p_area, "Chợ Gạo");
  assert.equal(args.p_delivery_address, "12 Đường A");
  assert.equal(args.p_status, "draft");
});

test("standalone order validation fails before provider access", async () => {
  let providerCalls = 0;
  const fetchImpl = async () => {
    providerCalls += 1;
    throw new Error("provider_must_not_be_called");
  };

  await assert.rejects(
    createOrder({ customerMode: "existing", items: [{ productName: "Trà", quantity: 1, unitPrice: 1 }] }, context, config, { fetchImpl }),
    (error) => error.message === "route_customer_id_required" && error.statusCode === 400
  );
  await assert.rejects(
    createOrder({ customerMode: "manual", customer: {}, items: [{ productName: "Trà", quantity: 1, unitPrice: 1 }] }, context, config, { fetchImpl }),
    (error) => error.message === "customer_name_required" && error.statusCode === 400
  );
  await assert.rejects(
    createOrder({ customerMode: "manual", customer: { name: "A" }, items: [] }, context, config, { fetchImpl }),
    (error) => error.message === "order_items_required" && error.statusCode === 400
  );
  await assert.rejects(
    createOrder({ customerMode: "manual", customer: { name: "A" }, status: "done", items: [{ productName: "Trà", quantity: 1, unitPrice: 1 }] }, context, config, { fetchImpl }),
    (error) => error.message === "invalid_order_status" && error.statusCode === 400
  );
  assert.equal(providerCalls, 0);
});

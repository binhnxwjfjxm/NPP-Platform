import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { handleOrderApi } from "./order-api.js";

const config = {
  supabaseUrl: "https://example.supabase.co",
  supabaseServiceRoleKey: "server-only-key"
};

const context = {
  requestId: "request-order-api-12345678",
  idempotencyKey: "order.create:api-12345678",
  receivedAt: "2026-07-19T12:00:00.000Z",
  installation: { id: "installation-a", nppCode: "NPP-A" },
  actor: { id: "service:npp-a:orders", type: "service", authentication: "backend-token" }
};

function request(body = {}, method = "POST") {
  const stream = method === "GET" ? Readable.from([]) : Readable.from([JSON.stringify(body)]);
  stream.method = method;
  return stream;
}

test("order API owns POST /api/orders and preserves idempotency metadata", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({
      data: { orderId: "order-1", orderCode: "ORD-1" },
      meta: { idempotency: { replayed: false, originalRequestId: context.requestId } }
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const result = await handleOrderApi(
    request({ customerMode: "manual", customer: { name: "Khách A" }, items: [{ productName: "Trà", quantity: 1, unitPrice: 10000 }] }),
    new URL("http://local/api/orders"),
    context,
    config,
    { fetchImpl }
  );

  assert.equal(result.statusCode, 201);
  assert.equal(result.payload.data.orderId, "order-1");
  assert.equal(result.payload.meta.idempotency.replayed, false);
  assert.equal(calls.length, 1);
});

test("order API owns GET /api/orders/:id and returns persisted line items", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    const href = String(url);
    calls.push(href);
    if (href.includes("/rest/v1/orders?")) {
      return new Response(JSON.stringify([{
        id: "order-1",
        order_code: "ORD-1",
        order_date: "2026-07-21",
        sales: "Sale A",
        customer_name: "Khách A",
        customer_phone: "0909000000",
        area: "Bình Đại",
        delivery_address: "12 Đường A",
        source_type: "orders_tab",
        status: "confirmed",
        subtotal: 230000,
        discount_total: 10000,
        grand_total: 220000,
        note: "Giao buổi sáng",
        raw_payload: { routeName: "Tuyến Thứ 2" }
      }]), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (href.includes("/rest/v1/order_items?")) {
      return new Response(JSON.stringify([
        {
          id: "item-1",
          order_id: "order-1",
          product_id: "product-1",
          variant_id: "variant-1",
          product_name: "Siro Dâu",
          sku: "SIRO-DAU",
          unit: "chai",
          quantity: 2,
          unit_price: 100000,
          discount: 10000,
          line_total: 190000,
          note: "750ml"
        },
        {
          id: "item-2",
          order_id: "order-1",
          product_id: "product-2",
          variant_id: "variant-2",
          product_name: "Trà Lài",
          sku: "TRA-LAI",
          unit: "gói",
          quantity: 1,
          unit_price: 30000,
          discount: 0,
          line_total: 30000,
          note: null
        }
      ]), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`unexpected_url:${href}`);
  };

  const result = await handleOrderApi(
    request({}, "GET"),
    new URL("http://local/api/orders/order-1"),
    context,
    config,
    { fetchImpl }
  );

  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.data.code, "ORD-1");
  assert.equal(result.payload.data.routeName, "Tuyến Thứ 2");
  assert.equal(result.payload.data.customerPhone, "0909000000");
  assert.equal(result.payload.data.items.length, 2);
  assert.equal(result.payload.data.items[0].productName, "Siro Dâu");
  assert.equal(result.payload.data.items[0].unitPrice, 100000);
  assert.equal(result.payload.data.items[0].discount, 10000);
  assert.equal(result.payload.data.items[0].lineTotal, 190000);
  assert.equal(result.payload.data.quantity, 3);
  assert.equal(result.payload.data.totalAmount, 220000);
  assert.equal(calls.length, 2);
});

test("order detail returns 404 when the persisted order does not exist", async () => {
  const fetchImpl = async () => new Response(JSON.stringify([]), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });

  await assert.rejects(
    handleOrderApi(
      request({}, "GET"),
      new URL("http://local/api/orders/missing-order"),
      context,
      config,
      { fetchImpl }
    ),
    (error) => error?.message === "order_not_found" && error?.statusCode === 404
  );
});

test("order API ignores unrelated methods and paths while leaving the order list on the legacy reader", async () => {
  assert.equal(await handleOrderApi(request({}, "GET"), new URL("http://local/api/orders"), context, config), null);
  assert.equal(await handleOrderApi(request({}, "POST"), new URL("http://local/api/actions"), context, config), null);
});

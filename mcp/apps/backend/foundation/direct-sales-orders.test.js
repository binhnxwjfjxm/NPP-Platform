import test from "node:test";
import assert from "node:assert/strict";
import {
  createDirectMcpSalesOrder,
  listDirectMcpSalesOrders
} from "./direct-sales-orders.js";

const employeeId = "11111111-1111-4111-8111-111111111111";
const customerId = "22222222-2222-4222-8222-222222222222";
const addressId = "33333333-3333-4333-8333-333333333333";
const routeCustomerId = "44444444-4444-4444-8444-444444444444";
const variantId = "55555555-5555-4555-8555-555555555555";
const warehouseId = "66666666-6666-4666-8666-666666666666";
const key = "mcp.sales-order.create-77777777-7777-4777-8777-777777777777";
const context = {
  installation: { id: "npp-a" },
  principal: { employeeId }
};
const config = { coreSales: { defaultWarehouseId: warehouseId } };

function persistence(rows) {
  return {
    withTransaction: async (fn) => fn({
      query: async () => ({ rows })
    })
  };
}

function ownedRow(overrides = {}) {
  return {
    route_customer_id: routeCustomerId,
    core_customer_id: customerId,
    core_customer_address_id: addressId,
    ...overrides
  };
}

test("direct MCP order forwards the same canonical key and never sends browser price authority", async () => {
  let captured = null;
  const result = await createDirectMcpSalesOrder({
    customerId,
    customerAddressId: addressId,
    note: "Giao giờ hành chính",
    lines: [{ variantId, quantity: "2", note: "2 gói" }]
  }, context, config, {
    idempotencyKey: key,
    persistence: persistence([ownedRow()]),
    coreClient: {
      create: async (payload, _context, _config, options) => {
        captured = { payload, options };
        return { id: "order-core-1", sourceType: "MCP" };
      }
    }
  });

  assert.equal(result.id, "order-core-1");
  assert.equal(captured.options.idempotencyKey, key);
  assert.equal(captured.payload.sourceId, key);
  assert.equal(captured.payload.sourceOutletId, routeCustomerId);
  assert.equal(captured.payload.customerId, customerId);
  assert.equal(captured.payload.customerAddressId, addressId);
  assert.deepEqual(captured.payload.lines, [{ variantId, quantity: "2", note: "2 gói" }]);
  assert.equal("unitPrice" in captured.payload.lines[0], false);
  assert.equal("salesChannelId" in captured.payload, false);
  assert.equal("employeeId" in captured.payload, false);
});

test("direct MCP order rejects browser commercial fields instead of silently trusting them", async () => {
  await assert.rejects(
    () => createDirectMcpSalesOrder({
      customerId,
      customerAddressId: addressId,
      unitPrice: 1000,
      lines: [{ variantId, quantity: "1", note: null }]
    }, context, config, {
      idempotencyKey: key,
      persistence: persistence([ownedRow()]),
      coreClient: { create: async () => ({}) }
    }),
    (error) => error.code === "browser_commercial_authority_forbidden" && error.statusCode === 400
  );
});

test("direct MCP order fails closed when linked customer is outside trusted employee ownership", async () => {
  await assert.rejects(
    () => createDirectMcpSalesOrder({
      customerId,
      customerAddressId: addressId,
      lines: [{ variantId, quantity: "1", note: null }]
    }, context, config, {
      idempotencyKey: key,
      persistence: persistence([]),
      coreClient: { create: async () => ({}) }
    }),
    (error) => error.code === "core_customer_not_owned" && error.statusCode === 403
  );
});

test("direct MCP order list only exposes canonical MCP orders for owned source outlets", async () => {
  const orders = await listDirectMcpSalesOrders(context, config, {
    persistence: persistence([ownedRow()]),
    coreClient: {
      list: async () => [
        { id: "owned", sourceType: "MCP", sourceOutletId: routeCustomerId },
        { id: "other-mcp", sourceType: "MCP", sourceOutletId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
        { id: "manual", sourceType: "MANUAL", sourceOutletId: routeCustomerId }
      ]
    }
  });
  assert.deepEqual(orders.map((order) => order.id), ["owned"]);
});

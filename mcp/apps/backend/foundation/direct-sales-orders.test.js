import test from "node:test";
import assert from "node:assert/strict";
import {
  createDirectMcpSalesOrder,
  listDirectMcpSalesOrders
} from "./direct-sales-orders.js";

const customerId = "11111111-1111-4111-8111-111111111111";
const customerAddressId = "22222222-2222-4222-8222-222222222222";
const variantId = "33333333-3333-4333-8333-333333333333";
const warehouseId = "44444444-4444-4444-8444-444444444444";
const routeCustomerId = "route_customer_1";

const context = {
  installation: { id: "installation-a" },
  principal: { employeeId: "55555555-5555-4555-8555-555555555555", roles: [] }
};
const config = { coreSales: { defaultWarehouseId: warehouseId } };

function ownedCustomer(overrides = {}) {
  return {
    id: customerId,
    customer_address_id: customerAddressId,
    ...overrides
  };
}

function ownedLink(overrides = {}) {
  return {
    route_customer_id: routeCustomerId,
    core_customer_id: customerId,
    core_customer_address_id: customerAddressId,
    ...overrides
  };
}

function persistence({ customers = [ownedCustomer()], links = [ownedLink()] } = {}) {
  return {
    withTransaction: async (fn) => fn({
      query: async (sql) => {
        if (sql.includes("LEFT JOIN LATERAL") && sql.includes("FROM shared.customers AS customer")) {
          return { rows: customers };
        }
        if (sql.includes("rc.id AS route_customer_id")) return { rows: links };
        throw new Error(`unexpected_query:${sql}`);
      }
    })
  };
}

function orderBody(extra = {}) {
  return {
    customerId,
    customerAddressId,
    lines: [{ variantId, quantity: "2" }],
    ...extra
  };
}

test("direct MCP order keeps linked field outlet as optional provenance", async () => {
  let createCall = null;
  const result = await createDirectMcpSalesOrder(orderBody(), context, config, {
    persistence: persistence(),
    idempotencyKey: "mcp.sales-order.create.test-1",
    coreClient: {
      create: async (payload, passedContext, passedConfig, options) => {
        createCall = { payload, passedContext, passedConfig, options };
        return { id: "order-1" };
      }
    }
  });
  assert.equal(result.id, "order-1");
  assert.equal(createCall.payload.customerId, customerId);
  assert.equal(createCall.payload.customerAddressId, customerAddressId);
  assert.equal(createCall.payload.sourceType, "MCP");
  assert.equal(createCall.payload.sourceOutletId, routeCustomerId);
  assert.equal(createCall.payload.sourceId, "mcp.sales-order.create.test-1");
  assert.equal(createCall.options.idempotencyKey, "mcp.sales-order.create.test-1");
  assert.equal("employeeId" in createCall.payload, false);
  assert.equal("salesChannelId" in createCall.payload, false);
  assert.equal("unitPrice" in createCall.payload.lines[0], false);
});

test("existing Công Ty customer can create an MCP order without reopening or linking a field outlet", async () => {
  let createPayload = null;
  const result = await createDirectMcpSalesOrder(orderBody(), context, config, {
    persistence: persistence({ links: [] }),
    idempotencyKey: "mcp.sales-order.create.existing-customer",
    coreClient: {
      create: async (payload) => {
        createPayload = payload;
        return { id: "order-existing" };
      }
    }
  });
  assert.equal(result.id, "order-existing");
  assert.equal(createPayload.customerId, customerId);
  assert.equal(createPayload.customerAddressId, customerAddressId);
  assert.equal(createPayload.sourceType, "MCP");
  assert.equal(createPayload.sourceId, "mcp.sales-order.create.existing-customer");
  assert.equal("sourceOutletId" in createPayload, false);
});

test("direct MCP order rejects browser commercial authority", async () => {
  await assert.rejects(
    () => createDirectMcpSalesOrder(orderBody({ unitPrice: "1000" }), context, config, {
      persistence: persistence(),
      idempotencyKey: "mcp.sales-order.create.test-2"
    }),
    (error) => error.code === "browser_commercial_authority_forbidden" && error.statusCode === 400
  );
});

test("direct MCP order denies a customer outside the Công Ty employer boundary", async () => {
  await assert.rejects(
    () => createDirectMcpSalesOrder(orderBody(), context, config, {
      persistence: persistence({ customers: [] }),
      idempotencyKey: "mcp.sales-order.create.test-3",
      coreClient: { create: async () => ({ id: "should-not-run" }) }
    }),
    (error) => error.code === "core_customer_not_owned" && error.statusCode === 403
  );
});

test("direct MCP order list follows accessible Công Ty customers even when source outlet is absent", async () => {
  const otherCustomerId = "66666666-6666-4666-8666-666666666666";
  const readIds = [];
  const result = await listDirectMcpSalesOrders(context, config, {
    persistence: persistence({ links: [] }),
    coreClient: {
      list: async () => [
        { id: "owned-linked", sourceType: "MCP", sourceOutletId: routeCustomerId, customerId },
        { id: "owned-canonical", sourceType: "MCP", sourceOutletId: null, customerId },
        { id: "foreign", sourceType: "MCP", sourceOutletId: null, customerId: otherCustomerId },
        { id: "manual", sourceType: "MANUAL", sourceOutletId: null, customerId }
      ],
      read: async (id) => {
        readIds.push(id);
        return { id };
      }
    }
  });
  assert.deepEqual(readIds, ["owned-linked", "owned-canonical"]);
  assert.deepEqual(result, [{ id: "owned-linked" }, { id: "owned-canonical" }]);
});

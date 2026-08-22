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

function customerRow(overrides = {}) {
  return {
    id: customerId,
    customer_code: "KH001",
    name: "Khách A",
    is_active: true,
    responsible_employee_id: employeeId,
    default_address_id: addressId,
    ...overrides
  };
}

function linkRow(overrides = {}) {
  return {
    route_customer_id: routeCustomerId,
    core_customer_id: customerId,
    core_customer_address_id: addressId,
    ...overrides
  };
}

function persistence({ customers = [customerRow()], addresses = [{ id: addressId }], links = [] } = {}) {
  return {
    withTransaction: async (fn) => fn({
      query: async (sql) => {
        if (sql.includes("FROM shared.customers AS customer")) return { rows: customers };
        if (sql.includes("FROM shared.customer_addresses AS address")) return { rows: addresses };
        if (sql.includes("FROM mcp.mcp_route_customers AS rc")) return { rows: links };
        throw new Error(`unexpected query: ${sql}`);
      }
    })
  };
}

function orderBody() {
  return {
    customerId,
    customerAddressId: addressId,
    note: "Giao giờ hành chính",
    lines: [{ variantId, quantity: "2", note: "2 gói" }]
  };
}

test("direct MCP order accepts canonical assigned customer without requiring a linked field outlet", async () => {
  let captured = null;
  const result = await createDirectMcpSalesOrder(orderBody(), context, config, {
    idempotencyKey: key,
    persistence: persistence(),
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
  assert.equal(captured.payload.customerId, customerId);
  assert.equal(captured.payload.customerAddressId, addressId);
  assert.equal("sourceOutletId" in captured.payload, false);
  assert.deepEqual(captured.payload.lines, [{ variantId, quantity: "2", note: "2 gói" }]);
  assert.equal("unitPrice" in captured.payload.lines[0], false);
  assert.equal("salesChannelId" in captured.payload, false);
  assert.equal("employeeId" in captured.payload, false);
});

test("direct MCP order keeps field outlet provenance when exactly one valid link exists", async () => {
  let captured = null;
  await createDirectMcpSalesOrder(orderBody(), context, config, {
    idempotencyKey: key,
    persistence: persistence({ links: [linkRow()] }),
    coreClient: {
      create: async (payload) => {
        captured = payload;
        return { id: "order-core-2", sourceType: "MCP" };
      }
    }
  });
  assert.equal(captured.sourceOutletId, routeCustomerId);
});

test("direct MCP order rejects browser commercial fields instead of silently trusting them", async () => {
  await assert.rejects(
    () => createDirectMcpSalesOrder({
      ...orderBody(),
      unitPrice: 1000
    }, context, config, {
      idempotencyKey: key,
      persistence: persistence(),
      coreClient: { create: async () => ({}) }
    }),
    (error) => error.code === "browser_commercial_authority_forbidden" && error.statusCode === 400
  );
});

test("direct MCP order fails closed when canonical customer is outside trusted employee responsibility", async () => {
  await assert.rejects(
    () => createDirectMcpSalesOrder(orderBody(), context, config, {
      idempotencyKey: key,
      persistence: persistence({ customers: [] }),
      coreClient: { create: async () => ({}) }
    }),
    (error) => error.code === "core_customer_not_owned" && error.statusCode === 403
  );
});

test("direct MCP order list follows canonical customer responsibility even without outlet provenance", async () => {
  const readIds = [];
  const orders = await listDirectMcpSalesOrders(context, config, {
    persistence: persistence(),
    coreClient: {
      list: async () => [
        { id: "owned", sourceType: "MCP", sourceOutletId: null, customerId },
        { id: "other-mcp", sourceType: "MCP", sourceOutletId: routeCustomerId, customerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
        { id: "manual", sourceType: "MANUAL", sourceOutletId: null, customerId }
      ],
      read: async (id) => {
        readIds.push(id);
        return {
          id,
          number: "SO-MCP-0001",
          status: "draft",
          sourceType: "MCP",
          sourceOutletId: null,
          customerId,
          currentVersionNumber: "1",
          versions: [{
            versionNumber: "1",
            total: "385000",
            lines: [{ quantity: "3" }, { quantity: "1" }]
          }]
        };
      }
    }
  });
  assert.deepEqual(readIds, ["owned"]);
  assert.deepEqual(orders.map((order) => order.id), ["owned"]);
  assert.equal(orders[0].versions[0].total, "385000");
});

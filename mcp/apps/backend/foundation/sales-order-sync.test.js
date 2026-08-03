import test from "node:test";
import assert from "node:assert/strict";
import {
  getSalesOrderProjection,
  submitSalesOrder,
  syncSalesOrder
} from "./sales-order-sync.js";

const context = {
  requestId: "req_mcp_sales",
  installation: { id: "installation-a" },
  actor: { id: "employee-a" }
};
const config = {
  coreSales: {
    configured: true,
    defaultWarehouseId: "11111111-1111-4111-8111-111111111111"
  }
};

function baseRow(overrides = {}) {
  return {
    session_customer_id: "session_customer_1",
    route_customer_id: "route_customer_1",
    order_id: "order_1",
    order_code: null,
    note: "Giao buổi sáng",
    customer_onboarding_status: "approved",
    core_customer_id: "33333333-3333-4333-8333-333333333333",
    core_customer_address_id: "44444444-4444-4444-8444-444444444444",
    core_sales_order_id: null,
    core_sales_order_number: null,
    core_sales_order_status: null,
    core_sales_order_version: null,
    core_sales_order_total: null,
    core_sales_order_currency: null,
    core_sales_order_fingerprint: null,
    core_sales_order_submitted_at: null,
    core_sales_order_last_synced_at: null,
    order_updated_at: "2026-08-03T00:00:00.000Z",
    ...overrides
  };
}

function coreOrder(overrides = {}) {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    number: null,
    status: "draft",
    currentVersionNumber: "1",
    sourceType: "MCP",
    sourceId: "order_1",
    sourceOutletId: "route_customer_1",
    customerId: "33333333-3333-4333-8333-333333333333",
    customerAddressId: "44444444-4444-4444-8444-444444444444",
    currency: "VND",
    updatedAt: "2026-08-03T00:01:00.000Z",
    versions: [{ versionNumber: "1", total: "125000", currency: "VND" }],
    ...overrides
  };
}

function persistenceFixture(rowOverrides = {}, itemOverrides = {}) {
  const state = {
    row: baseRow(rowOverrides),
    items: [{
      variant_id: "55555555-5555-4555-8555-555555555555",
      quantity: "2.000000",
      product_name: "Trà xanh NPP",
      sku: "NPP-TRA-XANH",
      note: null,
      ...itemOverrides
    }],
    updates: 0
  };
  return {
    state,
    persistence: {
      async withTransaction(work) {
        return work({
          async query(sql, values) {
            if (sql.includes("FROM mcp.mcp_session_customers")) {
              if (values[1] !== "session_customer_1") return { rows: [] };
              return { rows: [{ ...state.row }] };
            }
            if (sql.includes("FROM mcp.order_items")) return { rows: state.items.map((item) => ({ ...item })) };
            if (sql.includes("UPDATE mcp.orders")) {
              state.updates += 1;
              Object.assign(state.row, {
                core_sales_order_id: values[2],
                core_sales_order_number: values[3],
                core_sales_order_status: values[4],
                core_sales_order_version: values[5],
                core_sales_order_total: values[6],
                core_sales_order_currency: values[7],
                core_sales_order_fingerprint: values[8],
                core_sales_order_submitted_at: values[9],
                core_sales_order_last_synced_at: values[10]
              });
              return { rows: [{ id: state.row.order_id }] };
            }
            throw new Error(`unexpected_sql:${sql}`);
          }
        });
      }
    }
  };
}

test("approved MCP demand creates one Core draft with canonical source and no auto-confirm", async () => {
  const fixture = persistenceFixture();
  const calls = [];
  const projection = await submitSalesOrder(
    { sessionCustomerId: "session_customer_1", orderId: "order_1" },
    context,
    config,
    {
      persistence: fixture.persistence,
      coreClient: {
        async create(payload, _context, _config, options) {
          calls.push({ payload, options });
          return coreOrder();
        },
        async read() { throw new Error("unexpected_read"); }
      }
    }
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.idempotencyKey, "mcp-sales-order-order_1");
  assert.deepEqual(calls[0].payload, {
    customerMode: "EXISTING",
    customerId: "33333333-3333-4333-8333-333333333333",
    customerAddressId: "44444444-4444-4444-8444-444444444444",
    warehouseId: "11111111-1111-4111-8111-111111111111",
    deliveryMode: "DELIVERY",
    collectionPolicy: "COLLECT_ON_DELIVERY",
    currency: "VND",
    sourceType: "MCP",
    sourceId: "order_1",
    sourceOutletId: "route_customer_1",
    note: "Giao buổi sáng",
    lines: [{
      variantId: "55555555-5555-4555-8555-555555555555",
      quantity: "2.000000",
      note: "Trà xanh NPP"
    }]
  });
  assert.equal(projection.status, "draft");
  assert.equal(projection.total, "125000");
  assert.equal(fixture.state.updates, 1);
});

test("same demand retry synchronizes existing Core order without creating another", async () => {
  const fixture = persistenceFixture();
  let creates = 0;
  let reads = 0;
  const client = {
    async create() { creates += 1; return coreOrder(); },
    async read() { reads += 1; return coreOrder({ number: "SO-202608-0001" }); }
  };
  await submitSalesOrder({ sessionCustomerId: "session_customer_1" }, context, config, {
    persistence: fixture.persistence,
    coreClient: client
  });
  await submitSalesOrder({ sessionCustomerId: "session_customer_1" }, context, config, {
    persistence: fixture.persistence,
    coreClient: client
  });
  assert.equal(creates, 1);
  assert.equal(reads, 1);
  assert.equal(fixture.state.updates, 2);
});

test("blocked onboarding, legacy product and changed demand fail closed", async () => {
  const blocked = persistenceFixture({ customer_onboarding_status: "need_more_info" });
  await assert.rejects(
    () => submitSalesOrder({ sessionCustomerId: "session_customer_1" }, context, config, {
      persistence: blocked.persistence,
      coreClient: { async create() { throw new Error("unexpected"); } }
    }),
    (error) => error.code === "core_customer_not_ready" && error.statusCode === 409
  );

  const legacy = persistenceFixture({}, { variant_id: "legacy-mcp-product" });
  await assert.rejects(
    () => submitSalesOrder({ sessionCustomerId: "session_customer_1" }, context, config, {
      persistence: legacy.persistence,
      coreClient: { async create() { throw new Error("unexpected"); } }
    }),
    (error) => error.code === "core_product_reference_required"
  );

  const mismatch = persistenceFixture({
    core_sales_order_id: "22222222-2222-4222-8222-222222222222",
    core_sales_order_status: "draft",
    core_sales_order_version: 1,
    core_sales_order_total: "100000",
    core_sales_order_currency: "VND",
    core_sales_order_fingerprint: "a".repeat(64),
    core_sales_order_submitted_at: "2026-08-03T00:00:00.000Z",
    core_sales_order_last_synced_at: "2026-08-03T00:00:00.000Z"
  });
  await assert.rejects(
    () => submitSalesOrder({ sessionCustomerId: "session_customer_1" }, context, config, {
      persistence: mismatch.persistence,
      coreClient: { async read() { throw new Error("unexpected"); } }
    }),
    (error) => error.code === "core_sales_order_payload_mismatch"
  );
});

test("Core failure preserves MCP demand and projection remains empty", async () => {
  const fixture = persistenceFixture();
  await assert.rejects(
    () => submitSalesOrder({ sessionCustomerId: "session_customer_1" }, context, config, {
      persistence: fixture.persistence,
      coreClient: { async create() { const error = new Error("core_down"); error.code = "core_sales_unavailable"; throw error; } }
    }),
    (error) => error.code === "core_sales_unavailable"
  );
  assert.equal(fixture.state.updates, 0);
  const projection = await getSalesOrderProjection({ sessionCustomerId: "session_customer_1" }, context, config, {
    persistence: fixture.persistence
  });
  assert.equal(projection.coreSalesOrderId, null);
  assert.equal(fixture.state.row.order_id, "order_1");
});

test("sync rejects a Core order from another source", async () => {
  const fixture = persistenceFixture({
    core_sales_order_id: "22222222-2222-4222-8222-222222222222",
    core_sales_order_status: "draft",
    core_sales_order_version: 1,
    core_sales_order_total: "100000",
    core_sales_order_currency: "VND",
    core_sales_order_fingerprint: "b".repeat(64),
    core_sales_order_submitted_at: "2026-08-03T00:00:00.000Z",
    core_sales_order_last_synced_at: "2026-08-03T00:00:00.000Z"
  });
  await assert.rejects(
    () => syncSalesOrder({ sessionCustomerId: "session_customer_1" }, context, config, {
      persistence: fixture.persistence,
      coreClient: { async read() { return coreOrder({ sourceId: "another-order" }); } }
    }),
    (error) => error.code === "core_sales_order_source_mismatch"
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  isInstallationOwner,
  listAccessibleCoreCustomerLinks,
  listAccessibleRouteCustomers,
  loadAccessibleRouteCustomer
} from "./customer-route-access.js";

const employeeId = "11111111-1111-4111-8111-111111111111";
const routeCustomerId = "22222222-2222-4222-8222-222222222222";

function context({ owner = false } = {}) {
  return {
    installation: { id: "installation-a" },
    principal: {
      employeeId,
      roles: owner ? ["mcp.installation-owner"] : []
    }
  };
}

test("installation owner is an explicit trusted MCP role", () => {
  assert.equal(isInstallationOwner(context()), false);
  assert.equal(isInstallationOwner(context({ owner: true })), true);
});

test("single outlet access is decided by route assignment, not route-customer responsible_employee_id", async () => {
  const row = {
    id: routeCustomerId,
    responsible_employee_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    route_sales: "NV001",
    employee_active: true,
    route_employee_match: true,
    route_employee_matches: 1
  };
  const client = { query: async () => ({ rows: [row] }) };
  const result = await loadAccessibleRouteCustomer(client, context(), routeCustomerId);
  assert.equal(result.id, routeCustomerId);
});

test("owner bypasses route assignment while still remaining installation-scoped", async () => {
  const calls = [];
  const client = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return {
        rows: [{
          id: routeCustomerId,
          route_sales: "OTHER",
          employee_active: true,
          route_employee_match: false,
          route_employee_matches: 1
        }]
      };
    }
  };
  const result = await loadAccessibleRouteCustomer(client, context({ owner: true }), routeCustomerId);
  assert.equal(result.id, routeCustomerId);
  assert.equal(calls[0].params[0], "installation-a");
});

test("employee loses access when the route assignment changes", async () => {
  const client = {
    query: async () => ({
      rows: [{
        id: routeCustomerId,
        route_sales: "OTHER",
        employee_active: true,
        route_employee_match: false,
        route_employee_matches: 1
      }]
    })
  };
  await assert.rejects(
    () => loadAccessibleRouteCustomer(client, context(), routeCustomerId),
    (error) => error.code === "route_customer_not_owned" && error.statusCode === 403
  );
});

test("list and linked-customer queries carry the same owner flag and employee route boundary", async () => {
  const calls = [];
  const client = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [] };
    }
  };
  await listAccessibleRouteCustomers(client, context({ owner: true }));
  await listAccessibleCoreCustomerLinks(client, context({ owner: true }));
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.deepEqual(call.params, ["installation-a", employeeId, true]);
    assert.match(call.sql, /\$3::boolean = true/);
    assert.match(call.sql, /route\.sales/);
    assert.doesNotMatch(call.sql, /rc\.responsible_employee_id\s*=/);
  }
});

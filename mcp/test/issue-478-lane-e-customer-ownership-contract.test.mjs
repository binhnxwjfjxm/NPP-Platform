import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("customer ownership is route-derived and opening a Core code never claims an outlet", () => {
  const access = source("apps/backend/foundation/customer-route-access.js");
  const verification = source("apps/backend/foundation/customer-verification.js");
  const directOrders = source("apps/backend/foundation/direct-sales-orders.js");

  assert.match(access, /route\.sales/);
  assert.match(access, /mcp\.installation-owner/);
  assert.doesNotMatch(access, /rc\.responsible_employee_id\s*=/);
  assert.doesNotMatch(verification, /SET responsible_employee_id/);
  assert.doesNotMatch(verification, /responsible_employee_id = \$\d/);
  assert.match(directOrders, /listAccessibleCoreCustomerLinks/);
  assert.doesNotMatch(directOrders, /customer\.responsible_employee_id/);
});

test("Core owner role is propagated as a narrow installation-owner claim", () => {
  const auth = source("src/lib/mcp-auth.ts");
  const loader = source("src/lib/api/customer-onboarding-data.ts");
  const context = source("apps/backend/foundation/request-context.js");

  assert.match(auth, /system:security-owner/);
  assert.match(auth, /system:implementation-owner/);
  assert.match(auth, /"v3"/);
  assert.match(loader, /roles: stringList\(result\.data\.roles\)/);
  assert.match(context, /mcp\.installation-owner/);
  assert.match(context, /new Set\(\["v2", "v3"\]\)/);
});

test("customer page uses the scoped route-customer boundary and stale detail URLs render business UI", () => {
  const accounts = source("src/features/accounts/AccountsPage.tsx");
  const detail = source("src/app/customers/onboarding/[routeCustomerId]/page.tsx");

  assert.match(accounts, /loadOwnedRouteCustomersData/);
  assert.doesNotMatch(accounts, /loadRouteCustomersData/);
  assert.doesNotMatch(detail, /notFound/);
  assert.match(detail, /Không thể mở điểm bán/);
  assert.match(detail, /phân công phụ trách vừa thay đổi/);
});

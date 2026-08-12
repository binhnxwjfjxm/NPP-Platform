import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

test("E6 surfaces open/link customer code under MCP customer context", () => {
  const navigation = read("src/ui/shell/navigation.ts");
  const page = read("src/app/customers/onboarding/page.tsx");

  assert.match(navigation, /const CUSTOMERS_NAV_ITEM:[\s\S]*label: "Khách hàng"/);
  assert.match(navigation, /const CUSTOMER_ONBOARDING_NAV_ITEM:[\s\S]*href: "\/customers\/onboarding"/);
  assert.match(navigation, /id: "customers",\s*label: "Khách hàng",\s*items: \[CUSTOMER_DIRECTORY_NAV_ITEM, CUSTOMER_ONBOARDING_NAV_ITEM\]/);
  assert.doesNotMatch(navigation, /\/management\/customer-onboarding/);
  assert.match(page, /loadCustomerOnboardingQueue\(\)/);
  assert.match(page, /CustomerOnboardingClientPage/);
});

test("E6 management view reuses the existing MCP onboarding request lifecycle", () => {
  const loader = read("src/lib/api/customer-onboarding-data.ts");
  const client = read("src/features/accounts/CustomerOnboardingClientPage.tsx");

  assert.match(loader, /backendReadRows<Row>\("orders"/);
  assert.match(loader, /filters: \{ source_type: "session_customer" \}/);
  assert.match(loader, /backendReadRows<Row>\("mcp_session_customers"/);
  assert.match(loader, /backendReadRows<Row>\("mcp_route_sessions"/);
  assert.match(loader, /const sessionCustomerId = text\(order\.source_id\)/);

  assert.match(client, /\/api\/backend\/mcp-day\/session-customer\/customer-onboarding\/\$\{mutation\}/);
  assert.match(client, /session-customer\.customer-onboarding\.submit/);
  assert.match(client, /session-customer\.customer-onboarding\.sync/);
  assert.match(client, /JSON\.stringify\(\{ sessionCustomerId: item\.sessionCustomerId, orderId: item\.orderId \}\)/);
  assert.match(client, /\/visits\/order-intent\?/);
  assert.doesNotMatch(client, /\/management\/customer-onboarding/);
  assert.doesNotMatch(client, /\/api\/customers\/onboarding/);
});

test("E6 never bypasses the purchase-demand prerequisite", () => {
  const client = read("src/features/accounts/CustomerOnboardingClientPage.tsx");
  const loader = read("src/lib/api/customer-onboarding-data.ts");

  assert.match(client, /Chỉ hiện nhu cầu mua đã có trong MCP/);
  assert.match(client, /Đề nghị mở mã chỉ xuất hiện sau khi đã có nhu cầu mua/);
  assert.match(loader, /orderId/);
  assert.match(loader, /sessionCustomerId/);
  assert.doesNotMatch(client, /createCustomer|newCustomer|customer-onboarding-requests/);
});

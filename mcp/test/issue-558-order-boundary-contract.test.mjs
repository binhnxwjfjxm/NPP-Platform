import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const clientUrl = new URL("../src/features/orders/McpCoreOrdersClient.tsx", import.meta.url);
const serviceUrl = new URL("../apps/backend/foundation/direct-sales-orders.js", import.meta.url);
const accessUrl = new URL("../apps/backend/foundation/customer-route-access.js", import.meta.url);

test("Issue #558 phase 2 uses direct Công Ty Sales Order boundary without order-intent authority", async () => {
  const [client, service, access] = await Promise.all([
    readFile(clientUrl, "utf8"),
    readFile(serviceUrl, "utf8"),
    readFile(accessUrl, "utf8")
  ]);

  assert.match(client, /\/api\/backend\/core-sales\/orders/);
  assert.match(client, /createIdempotencyKey\("mcp\.sales-order\.create"\)/);
  assert.match(client, /key: submissionRef\.current\.key/);
  assert.doesNotMatch(client, /sessionCustomerId|order-intent|customerMode:\s*"manual"|unitPrice:/);

  assert.match(service, /sourceType:\s*"MCP"/);
  assert.match(service, /sourceId:\s*idempotencyKey/);
  assert.match(service, /sourceOutletId:\s*source\.routeCustomerId/);
  assert.match(service, /listAccessibleCoreCustomers/);
  assert.match(access, /customer\.responsible_employee_id = \$2::uuid/);
  assert.match(access, /customer_address\.is_active = true/);
  assert.match(service, /browser_commercial_authority_forbidden/);
  assert.doesNotMatch(service, /mcp-sales-order-\$\{|unitPrice|manualUnitPrice/);
});

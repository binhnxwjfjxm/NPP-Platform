import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const clientUrl = new URL("../src/features/orders/McpCoreOrdersClient.tsx", import.meta.url);
const serviceUrl = new URL("../apps/backend/foundation/direct-sales-orders.js", import.meta.url);

test("Issue #558 phase 2 uses direct Core Sales Order boundary without order-intent authority", async () => {
  const [client, service] = await Promise.all([
    readFile(clientUrl, "utf8"),
    readFile(serviceUrl, "utf8")
  ]);

  assert.match(client, /\/api\/backend\/core-sales\/orders/);
  assert.match(client, /createIdempotencyKey\("mcp\.sales-order\.create"\)/);
  assert.match(client, /key: submissionRef\.current\.key/);
  assert.doesNotMatch(client, /sessionCustomerId|order-intent|customerMode:\s*"manual"|unitPrice:/);

  assert.match(service, /sourceType:\s*"MCP"/);
  assert.match(service, /sourceId:\s*idempotencyKey/);
  assert.match(service, /sourceOutletId:\s*String\(link\.route_customer_id\)/);
  assert.match(service, /customer\.responsible_employee_id = \$2::uuid/);
  assert.match(service, /address\.customer_id = customer\.id/);
  assert.match(service, /browser_commercial_authority_forbidden/);
  assert.doesNotMatch(service, /mcp-sales-order-\$\{|unitPrice|manualUnitPrice/);
});

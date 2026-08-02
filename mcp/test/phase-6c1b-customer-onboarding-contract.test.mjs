import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Phase 6C.1B keeps add-customer field-only and requires an explicit order-flow action", () => {
  const addButton = source("src/features/mcp/McpSessionAddCustomerButton.tsx");
  const addProxy = source("src/app/api/backend/mcp-day/session-customer/add/route.ts");
  const orderUi = source("src/features/mcp/McpSessionCompactViewFinal2.tsx");
  for (const marker of ["customer-onboarding", "CORE_ONBOARDING", "approvedCustomerId"]) {
    assert.equal(addButton.includes(marker), false, `add-customer button must not contain ${marker}`);
    assert.equal(addProxy.includes(marker), false, `add-customer proxy must not contain ${marker}`);
  }
  assert.match(orderUi, /Gửi đề nghị xác minh \/ mở mã/);
  assert.match(orderUi, /Đã lưu nhu cầu mua trong MCP\. Chưa gửi đề nghị sang Core\./);
  assert.match(orderUi, /customer-onboarding\/submit/);
  assert.match(orderUi, /customer-onboarding\/sync/);
});

test("browser calls MCP proxy only; server adapter owns canonical Core calls", () => {
  const orderUi = source("src/features/mcp/McpSessionCompactViewFinal2.tsx");
  const coreClient = source("apps/backend/foundation/core-customer-onboarding-client.js");
  const submitProxy = source("src/app/api/backend/mcp-day/session-customer/customer-onboarding/submit/route.ts");
  assert.equal(orderUi.includes("CORE_ONBOARDING_API_BASE_URL"), false);
  assert.equal(orderUi.includes("/api/customer-onboarding-requests"), false);
  assert.match(submitProxy, /\/api\/mcp-day\/session-customer\/customer-onboarding\/submit/);
  assert.match(coreClient, /\/api\/customer-onboarding-requests/);
  for (const privilegedPath of ["/review", "/approve", "/link-existing", "/reject"]) {
    assert.equal(coreClient.includes(privilegedPath), false, `MCP Core client must not call ${privilegedPath}`);
  }
});

test("MCP projects all Core statuses and never treats blocked statuses as order-ready", () => {
  const ui = source("src/features/mcp/McpSessionCompactViewFinal2.tsx");
  const client = source("apps/backend/foundation/core-customer-onboarding-client.js");
  for (const status of ["submitted", "under_review", "need_more_info", "approved", "linked_existing", "rejected", "cancelled"]) {
    assert.match(ui, new RegExp(status));
    assert.match(client, new RegExp(status));
  }
  assert.match(client, /status === "approved" \|\| status === "linked_existing"/);
});

test("MCP app and PWA use the NPP logo asset", () => {
  const manifest = source("src/app/manifest.ts");
  const layout = source("src/app/layout.tsx");
  const shell = source("src/ui/shell/AppShell.tsx");
  assert.match(manifest, /\/npp-app-icon\.png/);
  assert.match(layout, /\/npp-app-icon\.png/);
  assert.match(shell, /\/npp-app-icon\.png/);
});


test("MCP stores Core request status and references in structured order columns", () => {
  const migration = source("apps/backend/foundation/migrations/sql/006_mcp_customer_onboarding_sync.sql");
  const sync = source("apps/backend/foundation/customer-onboarding-sync.js");
  for (const column of [
    "customer_onboarding_request_id",
    "customer_onboarding_status",
    "customer_onboarding_fingerprint",
    "core_customer_id",
    "core_customer_address_id"
  ]) {
    assert.match(migration, new RegExp(column));
    assert.match(sync, new RegExp(column));
  }
  assert.equal(sync.includes("raw_payload = jsonb_set"), false);
});

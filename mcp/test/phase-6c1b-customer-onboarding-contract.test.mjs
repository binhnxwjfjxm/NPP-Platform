import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("MCP add-customer stays field-only while standalone verification no longer depends on order intent", () => {
  const addButton = source("src/features/mcp/McpSessionAddCustomerButton.tsx");
  const addProxy = source("src/app/api/backend/mcp-day/session-customer/add/route.ts");
  const verificationUi = source("src/features/accounts/CustomerOnboardingClientPage.tsx");
  const verificationService = source("apps/backend/foundation/customer-verification.js");
  for (const marker of ["customer-onboarding", "CORE_ONBOARDING", "approvedCustomerId"]) {
    assert.equal(addButton.includes(marker), false, `add-customer button must not contain ${marker}`);
    assert.equal(addProxy.includes(marker), false, `add-customer proxy must not contain ${marker}`);
  }
  assert.match(verificationUi, /\/api\/backend\/customer-verifications\/\$\{mutation\}/);
  assert.equal(verificationUi.includes("sessionCustomerId"), false);
  assert.equal(verificationUi.includes("orderId"), false);
  assert.match(verificationService, /FIELD_PROFILE_VERIFICATION/);
  assert.match(verificationService, /orderRequired: false/);
  assert.equal(verificationService.includes("FROM mcp.orders"), false);
});

test("browser calls MCP proxy only; MCP adapter owns canonical Core submit/read and trusted employee forwarding", () => {
  const verificationUi = source("src/features/accounts/CustomerOnboardingClientPage.tsx");
  const coreClient = source("apps/backend/foundation/core-customer-onboarding-client.js");
  assert.equal(verificationUi.includes("CORE_ONBOARDING_API_BASE_URL"), false);
  assert.equal(verificationUi.includes("/api/customer-onboarding-requests"), false);
  assert.match(coreClient, /\/api\/customer-onboarding-requests/);
  assert.match(coreClient, /X-NPP-MCP-Employee-Id/);
  for (const privilegedPath of ["/review", "/approve", "/link-existing", "/reject"]) {
    assert.equal(coreClient.includes(privilegedPath), false, `MCP Core client must not call ${privilegedPath}`);
  }
});

test("MCP projects all Core statuses and never treats blocked statuses as linked", () => {
  const ui = source("src/features/accounts/CustomerOnboardingClientPage.tsx");
  const client = source("apps/backend/foundation/core-customer-onboarding-client.js");
  for (const status of ["submitted", "under_review", "need_more_info", "approved", "linked_existing", "rejected", "cancelled"]) {
    assert.match(ui, new RegExp(status));
    assert.match(client, new RegExp(status));
  }
  assert.match(client, /status === "approved" \|\| status === "linked_existing"/);
});

test("MCP shell and generated PWA icons use the existing NPP logo asset", () => {
  const manifest = source("src/app/manifest.ts");
  const iconRoute = source("src/app/api/pwa-icon/route.ts");
  const layout = source("src/app/layout.tsx");
  const shell = source("src/ui/shell/AppShell.tsx");
  assert.match(manifest, /\/api\/pwa-icon\?size=192/);
  assert.match(manifest, /\/api\/pwa-icon\?size=512/);
  assert.match(manifest, /maskable=1/);
  assert.match(iconRoute, /\/npp-app-icon\.png/);
  assert.match(layout, /\/api\/pwa-icon\?size=192/);
  assert.match(shell, /\/npp-app-icon\.png/);
});

test("standalone verification persists on route customer and uses canonical idempotency generation", () => {
  const migration = source("apps/backend/foundation/migrations/sql/010_mcp_customer_verification.sql");
  const verification = source("apps/backend/foundation/customer-verification.js");
  for (const marker of [
    "responsible_employee_id",
    "customer_verification_operation_id",
    "customer_verification_idempotency_key",
    "customer_verification_payload",
    "customer_verification_fingerprint"
  ]) assert.match(migration, new RegExp(marker));
  assert.match(verification, /createIdempotencyKey\("mcp\.customer-verification\.submit"/);
  assert.match(verification, /customer_verification_idempotency_key/);
  assert.equal(verification.includes("mcp-customer-onboarding-${"), false);
});

test("legacy order projection remains isolated for the later order-boundary cutover", () => {
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
  assert.match(sync, /createIdempotencyKey\(/);
});

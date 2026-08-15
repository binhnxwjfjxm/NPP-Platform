import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path) { return readFileSync(new URL(`../${path}`, import.meta.url), "utf8"); }

test("MCP add-customer stays field-only while standalone verification no longer depends on order intent", () => {
  const addButton = source("src/features/mcp/McpSessionAddCustomerButton.tsx");
  const addProxy = source("src/app/api/backend/mcp-day/session-customer/add/route.ts");
  const verificationUi = source("src/features/accounts/CustomerOnboardingClientPage.tsx");
  const verificationService = source("apps/backend/foundation/customer-verification.js");
  for (const marker of ["customer-onboarding", "CORE_ONBOARDING", "approvedCustomerId"]) { assert.equal(addButton.includes(marker), false); assert.equal(addProxy.includes(marker), false); }
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
  for (const privilegedPath of ["/review", "/approve", "/link-existing", "/reject"]) assert.equal(coreClient.includes(privilegedPath), false);
});

test("server customer reads recover trusted employee context from the canonical MCP session", () => {
  const loader = source("src/lib/api/customer-onboarding-data.ts");
  assert.match(loader, /readMcpSessionToken/);
  assert.match(loader, /requestMcpInternalAuth<WorkforceMePayload>\("\/api\/internal-auth\/me"/);
  assert.match(loader, /encodeMcpInternalAuthorization/);
  assert.match(loader, /incoming\.get\("authorization"\) \|\| await workforceAuthorizationFromSession\(\)/);
  assert.doesNotMatch(loader, /employeeId\s*=\s*headers\(\)\.get/);
});

test("MCP projects all Core statuses and never treats blocked statuses as linked", () => {
  const ui = source("src/features/accounts/CustomerOnboardingClientPage.tsx");
  const client = source("apps/backend/foundation/core-customer-onboarding-client.js");
  for (const status of ["submitted", "under_review", "need_more_info", "approved", "linked_existing", "rejected", "cancelled"]) { assert.match(ui, new RegExp(status)); assert.match(client, new RegExp(status)); }
  assert.match(client, /status === "approved" \|\| status === "linked_existing"/);
});

test("standalone verification persists on route customer and uses canonical idempotency generation", () => {
  const migration = source("apps/backend/foundation/migrations/sql/010_mcp_customer_verification.sql");
  const verification = source("apps/backend/foundation/customer-verification.js");
  for (const marker of ["responsible_employee_id", "customer_verification_operation_id", "customer_verification_idempotency_key", "customer_verification_payload", "customer_verification_fingerprint"]) assert.match(migration, new RegExp(marker));
  assert.match(verification, /createIdempotencyKey\("mcp\.customer-verification\.submit"/);
  assert.match(verification, /customer_verification_idempotency_key/);
});

test("legacy session-order onboarding is retired from the active MCP runtime", () => {
  const transitionalApi = source("apps/backend/foundation/transitional-api.js");
  const visitSession = source("src/features/mcp/McpSessionCompactViewFinal2.tsx");
  const lineCard = source("src/features/mcp/McpLineCard.tsx");
  const legacyPage = source("src/app/visits/order-intent/page.tsx");
  assert.doesNotMatch(transitionalApi, /\/api\/mcp-day\/session-customer\/customer-onboarding/);
  assert.doesNotMatch(visitSession, /customer-onboarding\/submit|customer-onboarding\/sync|getCustomerOnboarding|CustomerOnboardingStatusCard|Ghi nhận nhu cầu mua|Lưu nhu cầu mua/);
  assert.match(lineCard, /\/api\/backend\/mcp-day\/session-customer\/result/);
  assert.match(lineCard, /line\.hasOrder \? "Đã có đơn" : "Có đơn"/);
  assert.match(legacyPage, /redirect\("\/orders"\)/);
});

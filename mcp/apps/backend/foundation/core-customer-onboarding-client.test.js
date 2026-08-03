import test from "node:test";
import assert from "node:assert/strict";
import {
  coreOnboardingProjection,
  readCoreCustomerOnboarding,
  submitCoreCustomerOnboarding
} from "./core-customer-onboarding-client.js";

const context = { requestId: "request_core_onboarding_12345678" };
const config = {
  coreOnboarding: {
    configured: true,
    baseUrl: "https://core.example.com",
    apiToken: "core-onboarding-token-0123456789",
    timeoutMs: 1000
  }
};

function coreResponse(overrides = {}) {
  return {
    data: {
      customerOnboardingRequest: {
        id: "onboarding-1",
        status: "submitted",
        version: 1,
        ...overrides
      }
    }
  };
}

test("MCP Core onboarding client exposes submit/read only with server credentials", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(coreResponse()), {
      status: init.method === "POST" ? 201 : 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  await submitCoreCustomerOnboarding(
    { sourceSystem: "MCP", sourceDemandReference: "order-1" },
    context,
    config,
    { fetchImpl, idempotencyKey: "mcp-customer-onboarding-order-1" }
  );
  await readCoreCustomerOnboarding("onboarding-1", context, config, { fetchImpl });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://core.example.com/api/customer-onboarding-requests");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, "Bearer core-onboarding-token-0123456789");
  assert.equal(calls[0].init.headers["Idempotency-Key"], "mcp-customer-onboarding-order-1");
  assert.equal(calls[1].url, "https://core.example.com/api/customer-onboarding-requests/onboarding-1");
  assert.equal(calls[1].init.method, "GET");
  assert.equal(calls.some((call) => /review|approve|link-existing|reject/.test(call.url)), false);
});

test("Core projection allows an official order only after approved or linked_existing", () => {
  assert.equal(coreOnboardingProjection(coreResponse().data.customerOnboardingRequest).officialOrderAllowed, false);
  assert.equal(coreOnboardingProjection(coreResponse({ status: "approved", approvedCustomerId: "customer-1" }).data.customerOnboardingRequest).officialOrderAllowed, true);
  assert.equal(coreOnboardingProjection(coreResponse({ status: "linked_existing", approvedCustomerId: "customer-2" }).data.customerOnboardingRequest).officialOrderAllowed, true);
  const needsInfo = coreOnboardingProjection(coreResponse({ status: "need_more_info", reviewReason: "Bổ sung địa chỉ" }).data.customerOnboardingRequest);
  assert.equal(needsInfo.officialOrderAllowed, false);
  assert.equal(needsInfo.reviewReason, "Bổ sung địa chỉ");
});

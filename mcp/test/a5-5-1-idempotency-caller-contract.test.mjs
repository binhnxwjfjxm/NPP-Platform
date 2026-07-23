import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("mutation helper creates one key and reuses it across network retries", async () => {
  const helper = await source("src/lib/api/idempotent-fetch.ts");

  assert.match(helper, /const idempotencyKey = options\.key \|\| createIdempotencyKey\(options\.operation\);/);
  assert.match(helper, /headers\.set\("Idempotency-Key", idempotencyKey\);/);
  assert.match(helper, /for \(let attempt = 0; attempt <= retries; attempt \+= 1\)/);
  assert.doesNotMatch(
    helper,
    /for \(let attempt[\s\S]*?createIdempotencyKey\(/,
    "retry loop must not mint a new key"
  );
});

test("session-customer result and add callers use stable idempotency while legacy follow-up is not retried", async () => {
  const apiClient = await source("src/lib/api/api-client.ts");
  const addCustomerButton = await source("src/features/mcp/McpSessionAddCustomerButton.tsx");

  assert.match(
    apiClient,
    /createMcpDayResult\(payload\)[\s\S]*?postIdempotentJson[\s\S]*?session-customer\.result\.record/
  );
  assert.match(
    apiClient,
    /addMcpDayCustomer\(payload\)[\s\S]*?postIdempotentJson[\s\S]*?session-customer\.add/
  );
  assert.match(
    addCustomerButton,
    /idempotentMutationFetch\([\s\S]*?\/api\/backend\/mcp-day\/session-customer\/add[\s\S]*?operation: "session-customer\.add"/
  );
  assert.doesNotMatch(
    addCustomerButton,
    /fetch\("\/api\/backend\/mcp-day\/session-customer\/add"/,
    "session add-customer UI must not bypass the idempotent mutation helper"
  );
  assert.match(
    apiClient,
    /createMcpDayFollowup\(payload\)[\s\S]*?postJson<[^>]+>\([^\n]+\/followup/
  );
  assert.doesNotMatch(
    apiClient,
    /createMcpDayFollowup\(payload\)[\s\S]{0,240}?postIdempotentJson/
  );
});

test("session manager keeps snapshot and lifecycle mutations on stable idempotency", async () => {
  const manager = await source("src/features/mcp/McpSessionsManagerSafe.tsx");
  const callApiStart = manager.indexOf("async function callApi(");
  const callIdempotentStart = manager.indexOf("async function callIdempotentApi(");

  assert.notEqual(callApiStart, -1);
  assert.notEqual(callIdempotentStart, -1);
  const callApiBody = manager.slice(callApiStart, callIdempotentStart);

  assert.match(callApiBody, /idempotentMutationFetch\(/);
  assert.match(callApiBody, /sessionMutationOperation\(init\.method\)/);
  assert.doesNotMatch(callApiBody, /await fetch\(/);
  assert.match(manager, /method === "PATCH"\) return "route-session\.update"/);
  assert.match(manager, /method === "DELETE"\) return "route-session\.delete-empty"/);
  assert.match(manager, /async function callIdempotentApi[\s\S]*?idempotentMutationFetch\(/);
  assert.match(
    manager,
    /callIdempotentApi\([\s\S]*?"\/api\/mcp-session-report"[\s\S]*?"session-report\.snapshot\.create"/
  );
  assert.match(manager, /await callApi\(actionUrl\(editing\.id\)/);
  assert.match(manager, /await callApi\(actionUrl\(deleting\.id\)/);
});

test("AI analysis keeps the same caller key when persisting the AI result", async () => {
  const page = await source("src/features/market-reports/MarketReportsClientPage.tsx");
  const route = await source("src/app/api/mcp-session-report/analyze/route.ts");
  const proxy = await source("src/lib/api/backend-proxy.ts");

  assert.match(page, /idempotentMutationFetch\([\s\S]*?\/api\/mcp-session-report\/analyze/);
  assert.match(page, /operation: "session-report\.analyze"/);
  assert.match(route, /request\.headers\.get\("idempotency-key"\)/);
  assert.match(route, /IDEMPOTENCY_KEY_REQUIRED/);
  assert.match(route, /persistAgentResult\([\s\S]*?idempotencyKey/);
  assert.match(route, /idempotencyKey\n\s*}\);/);
  assert.match(proxy, /idempotencyKey\?: string;/);
  assert.match(proxy, /options\.idempotencyKey \|\| request\?\.headers\.get\("idempotency-key"\)/);
});

test("field-check and report-setting callers send stable mutation keys", async () => {
  const fieldCheck = await source("src/features/market-checks/MarketChecksClientPage.tsx");
  const groups = await source("src/app/mcp-setting/groups/page.tsx");
  const items = await source("src/features/mcp-settings/McpReportSettingsPage.tsx");

  assert.match(fieldCheck, /idempotentMutationFetch\([\s\S]*?\/api\/field-checks\/result/);
  assert.match(fieldCheck, /operation: "field-check\.result\.update"/);

  assert.match(groups, /idempotentMutationFetch\(/);
  assert.match(groups, /operation: `report-setting-group\.\$\{method\.toLowerCase\(\)\}`/);
  assert.match(groups, /method: editId \? "PATCH" : "POST"/);

  assert.match(items, /idempotentMutationFetch\(/);
  assert.match(items, /operation: `report-setting-item\.\$\{method\.toLowerCase\(\)\}`/);
  assert.match(items, /function saveNewItem\(\)[\s\S]*?method: "POST"/);
  assert.match(items, /function saveEditedItem\(\)[\s\S]*?method: "PATCH"/);
  assert.match(items, /function toggleItem\(item: SettingItem\)[\s\S]*?method: "PATCH"/);
  assert.doesNotMatch(items, /method: editId \? "PATCH" : "POST"/);
});

test("A5.5.1 exposes exactly nine typed Foundation idempotent wrappers", async () => {
  const migration = await source("supabase/migrations/20260717091000_foundation_idempotent_mutations.sql");
  const wrappers = migration.match(/create or replace function public\.mcp_idempotent_[a-z0-9_]+\(/gi) || [];

  assert.equal(wrappers.length, 9);
  assert.equal((migration.match(/mcp_idempotency_begin\(/g) || []).length, 9);
  assert.equal((migration.match(/mcp_idempotency_complete\(/g) || []).length, 9);
});

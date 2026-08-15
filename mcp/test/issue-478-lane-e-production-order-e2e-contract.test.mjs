import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = (await readFile(
  new URL("../../.github/workflows/issue-478-lane-e-production-order-e2e.yml", import.meta.url),
  "utf8"
)).replace(/\r\n/g, "\n");

const script = (await readFile(
  new URL("../../.github/scripts/issue-478-lane-e-production-order-e2e.mjs", import.meta.url),
  "utf8"
)).replace(/\r\n/g, "\n");

test("Issue 478 production order smoke is exact-command and owner-guarded", () => {
  assert.match(workflow, /github\.event\.issue\.number == 478/);
  assert.match(workflow, /github\.event\.comment\.body == '\/smoke-issue-478-lane-e-order-production'/);
  assert.match(workflow, /github\.actor == 'binhnxwjfjxm'/);
  assert.match(workflow, /github\.actor == 'khuongbinhinfo-a11y'/);
  assert.match(workflow, /actions: read/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /MCP_APP_NAME: hung-phat-mcp/);
  assert.match(workflow, /CORE_APP_NAME: hung-phat/);
  assert.match(workflow, /Install pinned Heroku CLI[\s\S]*working-directory: mcp[\s\S]*npm install --global --ignore-scripts heroku@11\.0\.0/);
  assert.doesNotMatch(workflow, /deploy-vercel|container:push|container:release|git push/);
});

test("container runtime preflight uses verified GitHub deploy evidence, never slug metadata", () => {
  assert.match(workflow, /EXPECTED_MCP_RUNTIME_SHA: 219327e91579e5a6addd11b828cd7eefdedda887/);
  assert.match(workflow, /EXPECTED_MCP_DEPLOY_RUN_ID: '31897853364'/);
  assert.match(workflow, /actions\/runs\/\$EXPECTED_MCP_DEPLOY_RUN_ID/);
  assert.match(workflow, /Manual Heroku MCP production deploy/);
  assert.match(workflow, /heroku-mcp-backend-manual\.yml\/runs\?status=success&branch=main&per_page=1/);
  assert.match(workflow, /test "\$latest_successful_run_id" = "\$EXPECTED_MCP_DEPLOY_RUN_ID"/);
  assert.match(workflow, /git merge-base --is-ancestor "\$EXPECTED_MCP_RUNTIME_SHA" "\$SOURCE_SHA"/);
  assert.match(workflow, /git diff --quiet "\$EXPECTED_MCP_RUNTIME_SHA" "\$SOURCE_SHA" -- mcp\/apps\/backend packages\/contracts/);
  assert.match(workflow, /MCP_RUNTIME_SOURCE_SHA=\$EXPECTED_MCP_RUNTIME_SHA/);
  assert.match(workflow, /MCP_RUNTIME_DEPLOY_RUN_ID=\$EXPECTED_MCP_DEPLOY_RUN_ID/);
  assert.doesNotMatch(workflow, /deployed_sha\(\)/);
  assert.doesNotMatch(workflow, /\.slug\.id|\/slugs\//);
  assert.doesNotMatch(workflow, /CORE_DEPLOYED_SHA/);
});

test("smoke uses canonical keys and exercises MCP create -> Core read -> MCP reload", () => {
  assert.match(script, /createIdempotencyKey\(CREATE_OPERATION, randomUUID\(\)\)/);
  assert.match(script, /createIdempotencyKey\(CANCEL_OPERATION, randomUUID\(\)\)/);
  assert.match(script, /CREATE_OPERATION = "mcp\.sales-order\.create"/);
  assert.match(script, /CANCEL_OPERATION = "core\.sales-order\.cancel"/);
  assert.match(script, /\/api\/core-sales\/orders/);
  assert.match(script, /\/api\/sales-orders\/\$\{encodeURIComponent\(orderId\)\}/);
  assert.match(script, /mcp_reload_orders/);
  assert.match(script, /mcp_reload_order_missing/);
  assert.match(script, /core_receive_source_id_mismatch/);
  assert.match(script, /mcp_reload_source_id_mismatch/);
});

test("smoke never confirms or fulfills and always attempts cancellation cleanup", () => {
  assert.match(script, /finally \{/);
  assert.match(script, /\/cancel`/);
  assert.match(script, /Issue #478 Lane E production E2E cleanup/);
  assert.match(script, /cleanup_final_status_mismatch/);
  assert.match(script, /persistedTestOrder: cancelled \? "cancelled_audit_record"/);
  assert.doesNotMatch(script, /\/confirm/);
  assert.doesNotMatch(script, /\/api\/(?:fulfillment|sales-fulfillment)|\/allocate\b|\/pick\b|\/pack\b/i);
});

test("retry keeps the same generated keys instead of minting per attempt", () => {
  assert.equal((script.match(/createIdempotencyKey\(/g) || []).length, 2);
  assert.match(script, /headers: mcpHeaders\(\{ idempotencyKey: createKey, json: true \}\)/);
  assert.match(script, /headers: coreHeaders\(bootstrapToken, \{ idempotencyKey: cancelKey, json: true \}\)/);
  assert.match(script, /\{ retry: true \}/);
  assert.match(script, /retryableFailure = !status \|\| status >= 500/);
  assert.match(script, /linkCounts/);
});

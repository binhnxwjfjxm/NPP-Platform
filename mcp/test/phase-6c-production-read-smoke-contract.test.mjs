import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = (await readFile(
  new URL("../../.github/workflows/phase-6c-production-read-smoke.yml", import.meta.url),
  "utf8"
)).replace(/\r\n/g, "\n");

test("Phase 6C production smoke is exact-command, read-only and secret-safe", () => {
  assert.match(workflow, /github\.event\.issue\.number == 5/);
  assert.match(workflow, /github\.event\.comment\.body == '\/smoke-phase-6c-production-read'/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /git rev-parse --is-shallow-repository/);
  assert.match(workflow, /HEROKU_API_KEY: \$\{\{ secrets\.HEROKU_API_KEY \}\}/);
  assert.match(workflow, /::add-mask::/);
  assert.match(workflow, /\/api\/customer-onboarding-requests\?limit=1&offset=0/);
  assert.match(workflow, /\/api\/sales-orders\/sku-search\?search=&limit=1&offset=0/);
  assert.match(workflow, /\/api\/sales-orders\?limit=1&offset=0/);
  assert.match(workflow, /\/api\/core-sales\/products\/search\?q=&limit=1/);
  assert.match(workflow, /"table":"orders","select":"id","limit":1/);
  assert.match(workflow, /MCP_ONBOARDING_EXISTING_PROJECTION/);
  assert.match(workflow, /MCP_SALES_ORDER_EXISTING_PROJECTION/);
  assert.match(workflow, /PRODUCTION_WRITE_SMOKE=not_exercised_no_owner_approved_fixture/);
  assert.doesNotMatch(workflow, /\/customer-onboarding\/submit/);
  assert.doesNotMatch(workflow, /\/customer-onboarding\/sync/);
  assert.doesNotMatch(workflow, /\/sales-order\/submit/);
  assert.doesNotMatch(workflow, /\/sales-order\/sync/);
  assert.doesNotMatch(workflow, /container:(?:push|release)/);
  assert.doesNotMatch(workflow, /git push/);
  assert.doesNotMatch(workflow, /vercel\s+(?:deploy|--prod)/i);
  assert.doesNotMatch(workflow, /echo\s+.*\$(?:mcp_backend_token|onboarding_token|sales_token)/i);
});

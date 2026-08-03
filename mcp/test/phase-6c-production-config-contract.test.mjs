import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const workflowPath = new URL(".github/workflows/phase-6c-production-config.yml", root);
const scriptPath = new URL("mcp/apps/backend/scripts/phase-6c-production-config.sh", root);
const workflow = (await readFile(workflowPath, "utf8")).replace(/\r\n/g, "\n");
const script = (await readFile(scriptPath, "utf8")).replace(/\r\n/g, "\n");
const contract = `${workflow}\n${script}`;

test("Phase 6C production config script is valid shell", () => {
  execFileSync("bash", ["-n", fileURLToPath(scriptPath)]);
});

test("config workflow is exact-command, exact-main and never automatic", () => {
  assert.match(workflow, /issue_comment:/);
  assert.match(workflow, /github\.event\.issue\.number == 5/);
  assert.match(workflow, /github\.event\.comment\.body == '\/configure-phase-6c-production'/);
  assert.match(workflow, /github\.actor == 'binhnxwjfjxm'/);
  assert.match(workflow, /github\.actor == 'khuongbinhinfo-a11y'/);
  assert.match(workflow, /DEPLOY_REF: main/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /git rev-parse origin\/main/);
  assert.match(workflow, /node-version: 20/);
  assert.match(workflow, /secrets\.HEROKU_API_KEY/);
  assert.doesNotMatch(workflow, /^\s{2}(?:push|pull_request|schedule):\s*$/m);
  assert.doesNotMatch(workflow, /workflow_dispatch/);
});

test("config operation uses provider data and fails closed on warehouse ambiguity", () => {
  assert.match(script, /CORE_APP_NAME/);
  assert.match(script, /MCP_APP_NAME/);
  assert.match(script, /shared\.warehouses/);
  assert.match(script, /installation_id = :'installation_id'/);
  assert.match(script, /is_active = true/);
  assert.match(script, /Multiple active warehouses exist and no reviewed default is configured/);
  assert.match(script, /Configured default warehouse is not active/);
  assert.match(script, /core_and_mcp_database_targets_differ/);
  assert.doesNotMatch(script, /00000000-0000-4000-8000-000000000001/);
});

test("tokens and database identifiers remain absent from logs and summaries", () => {
  assert.match(script, /openssl rand -hex 32/);
  assert.match(script, /choose_shared_token/);
  assert.match(script, /test "\$onboarding_token" != "\$sales_token"/);
  assert.match(script, /::add-mask::/);
  assert.match(script, /mask_database_parts/);
  assert.match(script, /parsed\.username/);
  assert.match(script, /parsed\.password/);
  assert.match(script, /parsed\.hostname/);
  assert.match(script, /MCP_ONBOARDING_API_TOKEN/);
  assert.match(script, /MCP_SALES_API_TOKEN/);
  assert.match(script, /CORE_ONBOARDING_API_TOKEN/);
  assert.match(script, /CORE_SALES_API_TOKEN/);
  assert.doesNotMatch(contract, /(?:TOKEN|DATABASE_URL)=\$[a-z_]+.*GITHUB_STEP_SUMMARY/);
  assert.doesNotMatch(workflow, /CORE_(?:ONBOARDING|SALES)_API_TOKEN:/);
  assert.doesNotMatch(workflow, /MCP_(?:ONBOARDING|SALES)_API_TOKEN:/);
});

test("provider mutation is scoped, reversible and health-gated", () => {
  assert.match(script, /--request PATCH/);
  assert.match(script, /restore_original_config/);
  assert.match(script, /core_original_payload/);
  assert.match(script, /mcp_original_payload/);
  assert.match(script, /mutation_started="true"/);
  assert.match(script, /\[ "\$mutation_started" = "true" \]/);
  assert.match(script, /\[ "\$rollback_attempted" != "true" \]/);
  assert.match(script, /restore_original_config \|\| true/);
  assert.match(script, /smoke_health "\$core_url" \/health\/live/);
  assert.match(script, /smoke_health "\$core_url" \/health\/ready/);
  assert.match(script, /smoke_health "\$mcp_url" \/health\/live/);
  assert.match(script, /smoke_health "\$mcp_url" \/health\/ready/);
  assert.match(script, /ROLLBACK_HEALTHY/);
  assert.doesNotMatch(script, /heroku config:set/);
  assert.doesNotMatch(script, /container:(?:push|release)/);
  assert.doesNotMatch(script, /git push/);
  assert.doesNotMatch(script, /migration:(?:migrate|verify|status)/);
  assert.doesNotMatch(script, /pg_dump|pg_restore/);
});

test("minimum Phase 6C service permissions and warehouse scope are additive", () => {
  assert.match(script, /mcp\.sales-order\.read,mcp\.sales-order\.create/);
  assert.match(script, /mcp:warehouse:\$warehouse_id/);
  assert.match(script, /csv_union "\$existing_permissions"/);
  assert.match(script, /csv_union "\$existing_scopes"/);
  assert.match(script, /MCP_SALES_WAREHOUSE_IDS/);
  assert.match(script, /CORE_SALES_DEFAULT_WAREHOUSE_ID/);
});

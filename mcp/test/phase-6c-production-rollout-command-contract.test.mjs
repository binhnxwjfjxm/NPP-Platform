import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const coreWorkflow = (await readFile(
  new URL(".github/workflows/heroku-npp-backend-manual.yml", root),
  "utf8"
)).replace(/\r\n/g, "\n");
const mcpWorkflow = (await readFile(
  new URL(".github/workflows/heroku-mcp-backend-manual.yml", root),
  "utf8"
)).replace(/\r\n/g, "\n");

test("Core production deploy remains manual and gains one exact Issue 5 command", () => {
  assert.match(coreWorkflow, /workflow_dispatch:/);
  assert.match(coreWorkflow, /issue_comment:/);
  assert.match(coreWorkflow, /github\.event\.issue\.number == 5/);
  assert.match(coreWorkflow, /github\.event\.comment\.body == '\/deploy-heroku-core-production'/);
  assert.match(coreWorkflow, /github\.actor == 'binhnxwjfjxm'/);
  assert.match(coreWorkflow, /github\.actor == 'khuongbinhinfo-a11y'/);
  assert.match(coreWorkflow, /HEROKU_APP_NAME: hung-phat/);
  assert.match(coreWorkflow, /HEROKU_FORBIDDEN_APP_NAME: hung-phat-mcp/);
  assert.match(coreWorkflow, /DEPLOY_REF: main/);
  assert.match(coreWorkflow, /fetch-depth: 0/);
  assert.match(coreWorkflow, /persist-credentials: false/);
  assert.match(coreWorkflow, /git fetch --prune --no-tags origin/);
  assert.match(coreWorkflow, /refs\/heads\/main:refs\/remotes\/origin\/main/);
  assert.match(coreWorkflow, /git rev-parse --is-shallow-repository/);
  assert.doesNotMatch(coreWorkflow, /git fetch origin main --depth=1/);
  assert.match(coreWorkflow, /git rev-parse origin\/main/);
  assert.match(coreWorkflow, /name: Setup Node 20/);
  assert.match(coreWorkflow, /node-version: 20/);
  assert.match(coreWorkflow, /npm --workspace npp-core-api run start/);
  assert.doesNotMatch(coreWorkflow, /npm --workspace npp-core-api start"/);
  assert.match(coreWorkflow, /https:\/\/api\.heroku\.com\/apps\/\$HEROKU_APP_NAME/);
  assert.match(coreWorkflow, /Accept: application\/vnd\.heroku\+json; version=3/);
  assert.match(coreWorkflow, /Authorization: Bearer \$HEROKU_API_KEY/);
  assert.doesNotMatch(coreWorkflow, /heroku apps:info[^\n]*--json/);
  assert.match(coreWorkflow, /app_url="\$\{app_url%\/\}"/);
  assert.match(coreWorkflow, /app_url="\$\{APP_URL%\/\}"/);
  assert.match(coreWorkflow, /"\$app_url\$path"/);
  assert.doesNotMatch(coreWorkflow, /app_url="\$APP_URL"/);
  assert.match(coreWorkflow, /requested_action="\$\{REQUESTED_ACTION:-deploy\}"/);
  assert.match(coreWorkflow, /GITHUB_EVENT_NAME" = "issue_comment/);
  assert.doesNotMatch(coreWorkflow, /^\s{2}(?:push|pull_request|schedule):\s*$/m);
});

test("MCP production keeps separate exact migration and deploy commands", () => {
  assert.match(mcpWorkflow, /workflow_dispatch:/);
  assert.match(mcpWorkflow, /issue_comment:/);
  assert.match(mcpWorkflow, /github\.event\.issue\.number == 5/);
  assert.match(mcpWorkflow, /github\.event\.comment\.body == '\/deploy-heroku-mcp-production'/);
  assert.match(mcpWorkflow, /github\.event\.comment\.body == '\/migrate-heroku-mcp-production'/);
  assert.match(mcpWorkflow, /\/deploy-heroku-mcp-production\) action="deploy"/);
  assert.match(mcpWorkflow, /\/migrate-heroku-mcp-production\) action="migrate"/);
  assert.match(mcpWorkflow, /HEROKU_APP_NAME: hung-phat-mcp/);
  assert.match(mcpWorkflow, /HEROKU_DB_OWNER_APP_NAME: hung-phat/);
  assert.match(mcpWorkflow, /MCP_MIGRATION_CREDENTIAL_MODE: essential_owner/);
  assert.match(mcpWorkflow, /MCP_MIGRATION_ESSENTIAL_OWNER_CONFIRM: I_ACKNOWLEDGE_OWNER_CREDENTIAL_IS_NOT_LEAST_PRIVILEGE/);
  assert.match(mcpWorkflow, /persist-credentials: false/);
  assert.match(mcpWorkflow, /REQUESTED_ACTION="\$action" bash mcp\/apps\/backend\/scripts\/manual-production-deploy\.sh/);
  assert.doesNotMatch(mcpWorkflow, /^\s{2}(?:push|pull_request|schedule):\s*$/m);
});

test("both backend workflows publish only sanitized summaries to Issue 189", () => {
  for (const workflow of [coreWorkflow, mcpWorkflow]) {
    assert.match(workflow, /contents: read/);
    assert.match(workflow, /issues: write/);
    assert.match(workflow, /cat "\$GITHUB_STEP_SUMMARY"/);
    assert.match(workflow, /issues\/189\/comments/);
    assert.match(workflow, /GITHUB_RUN_ID/);
    assert.doesNotMatch(workflow, /cat .*config/i);
    assert.doesNotMatch(workflow, /echo\s+"?DATABASE_URL=/i);
    assert.doesNotMatch(workflow, /echo\s+"?[A-Z0-9_]*API_TOKEN=/i);
    assert.doesNotMatch(workflow, /echo\s+.*\$DATABASE_URL/i);
    assert.doesNotMatch(workflow, /echo\s+.*\$[A-Z0-9_]*API_TOKEN/i);
  }
  assert.match(coreWorkflow, /Core production rollout/);
  assert.match(mcpWorkflow, /MCP production rollout/);
});

test("Core and MCP release boundaries remain separate", () => {
  assert.doesNotMatch(coreWorkflow, /container:(?:push|release)/);
  assert.doesNotMatch(coreWorkflow, /HEROKU_APP_NAME: hung-phat-mcp/);
  assert.doesNotMatch(mcpWorkflow, /git push --force heroku HEAD:main/);
  assert.doesNotMatch(mcpWorkflow, /HEROKU_APP_NAME: hung-phat\s*$/m);
  assert.doesNotMatch(`${coreWorkflow}\n${mcpWorkflow}`, /vercel\s+(?:deploy|--prod)/i);
});

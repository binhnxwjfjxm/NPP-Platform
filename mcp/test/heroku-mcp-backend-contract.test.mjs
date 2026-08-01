import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);

async function read(relativePath) {
  return readFile(new URL(relativePath, root), "utf8");
}

const manualWorkflow = await read(".github/workflows/heroku-mcp-backend-manual.yml");
const ciWorkflow = await read(".github/workflows/heroku-mcp-backend-contract-ci.yml");
const dockerfile = await read("mcp/apps/backend/Dockerfile");
const packageJson = JSON.parse(await read("mcp/apps/backend/package.json"));
const rootProcfile = (await read("Procfile")).trim();

test("MCP backend runtime stays on bootstrap.js and binds externally in the container", () => {
  assert.equal(packageJson.scripts.start, "node bootstrap.js");
  assert.match(dockerfile, /FROM node:20-alpine/);
  assert.match(dockerfile, /ENV HOST=0\.0\.0\.0/);
  assert.match(dockerfile, /USER node/);
  assert.match(dockerfile, /CMD \["node", "bootstrap\.js"\]/);
  assert.ok(dockerfile.includes("COPY package.json bootstrap.js server.js ./"));
  assert.match(dockerfile, /COPY foundation \.\/foundation/);
  assert.doesNotMatch(dockerfile, /npp-core/i);
  assert.doesNotMatch(dockerfile, /Procfile/i);
  assert.doesNotMatch(dockerfile, /vercel/i);
});

test("manual Heroku MCP workflow performs provider preflight and isolated rollback", () => {
  assert.match(manualWorkflow, /workflow_dispatch/);
  assert.match(manualWorkflow, /issue_comment/);
  assert.match(manualWorkflow, /\/deploy-heroku-mcp-production/);
  assert.match(manualWorkflow, /hung-phat-mcp/);
  assert.match(manualWorkflow, /hung-phat/);
  assert.match(manualWorkflow, /heroku apps:info -a "\$HEROKU_APP_NAME" --json/);
  assert.match(manualWorkflow, /heroku stack -a "\$HEROKU_APP_NAME"/);
  assert.match(manualWorkflow, /heroku config -a "\$HEROKU_APP_NAME" --json/);
  assert.match(manualWorkflow, /HEROKU_REQUIRED_CONFIG_NAMES/);
  assert.match(manualWorkflow, /heroku releases --json -a "\$HEROKU_APP_NAME"/);
  assert.match(manualWorkflow, /previous_active_release_version/);
  assert.match(manualWorkflow, /failed_release_version/);
  assert.match(manualWorkflow, /rollback_target_version/);
  assert.match(manualWorkflow, /DATABASE_URL must stay absent/);
  assert.match(manualWorkflow, /heroku container:login/);
  assert.match(manualWorkflow, /heroku container:push web -a "\$HEROKU_APP_NAME"/);
  assert.match(manualWorkflow, /heroku container:release web -a "\$HEROKU_APP_NAME"/);
  assert.match(manualWorkflow, /heroku releases:rollback "\$previous_active_release_version"/);
  assert.match(manualWorkflow, /health\/live/);
  assert.match(manualWorkflow, /health\/ready/);
  assert.match(manualWorkflow, /HEROKU_RELEASE_VERSION/);
  assert.match(manualWorkflow, /DEPLOYED_SHA/);
  assert.doesNotMatch(manualWorkflow, /stack:set/);
  assert.doesNotMatch(manualWorkflow, /vercel/i);
  assert.doesNotMatch(manualWorkflow, /npp-core\//);
  assert.doesNotMatch(manualWorkflow, /Procfile/);
  assert.doesNotMatch(manualWorkflow, /^\s{2}(?:push|pull_request):\s*$/m);
  assert.equal(rootProcfile, "web: npm run start:core-api");
});

test("deploy failure remains a failed workflow after rollback evidence is recorded", () => {
  const caseIndex = manualWorkflow.indexOf('case "$action" in');
  const deployIndex = manualWorkflow.indexOf("deploy)", caseIndex);
  const rollbackIndex = manualWorkflow.indexOf("rollback)", deployIndex);
  const defaultIndex = manualWorkflow.indexOf("*)", rollbackIndex);
  const loginIndex = manualWorkflow.indexOf("heroku container:login");
  const summaryIndex = manualWorkflow.indexOf("- name: Summarize release evidence");
  const outcomeGateIndex = manualWorkflow.indexOf("- name: Enforce release outcome");

  assert.ok(caseIndex >= 0);
  assert.ok(deployIndex > caseIndex);
  assert.ok(rollbackIndex > deployIndex);
  assert.ok(defaultIndex > rollbackIndex);
  assert.ok(loginIndex > deployIndex && loginIndex < rollbackIndex);
  assert.doesNotMatch(manualWorkflow.slice(rollbackIndex, defaultIndex), /container:login/);

  assert.match(manualWorkflow, /deployment_failed="true"/);
  assert.match(manualWorkflow, /rollback_failed="true"/);
  assert.match(manualWorkflow, /rollback_health_failed="true"/);
  assert.match(manualWorkflow, /echo "deployment_failed=\$deployment_failed"/);
  assert.match(manualWorkflow, /echo "rollback_failed=\$rollback_failed"/);
  assert.match(manualWorkflow, /echo "rollback_health_failed=\$rollback_health_failed"/);

  assert.ok(summaryIndex >= 0);
  assert.ok(outcomeGateIndex > summaryIndex);
  assert.match(manualWorkflow, /- name: Summarize release evidence\n\s+if: always\(\)/);
  assert.match(manualWorkflow, /- name: Enforce release outcome\n\s+if: always\(\)/);
  assert.match(manualWorkflow, /steps\.release\.outcome/);
  assert.match(manualWorkflow, /steps\.release\.outputs\.deployment_failed/);
  assert.match(manualWorkflow, /steps\.release\.outputs\.rollback_failed/);
  assert.match(manualWorkflow, /steps\.release\.outputs\.rollback_health_failed/);
  assert.match(manualWorkflow, /The requested deployment failed health checks and was rolled back/);
});

test("Heroku MCP CI builds and smokes the backend container with fixture env", () => {
  assert.match(ciWorkflow, /pull_request:/);
  assert.match(ciWorkflow, /push:/);
  assert.match(ciWorkflow, /workflow_dispatch/);
  assert.match(ciWorkflow, /docker build -f mcp\/apps\/backend\/Dockerfile mcp\/apps\/backend/);
  assert.match(ciWorkflow, /docker run -d --rm/);
  assert.match(ciWorkflow, /\/health\/live/);
  assert.match(ciWorkflow, /\/health\/ready/);
  assert.match(ciWorkflow, /npm --workspace mcp run test:heroku-mcp-backend-contract/);
  assert.match(ciWorkflow, /npm --workspace mcp run test:heroku-mcp-backend-runtime/);
  assert.match(ciWorkflow, /docker stop "\$container_id"/);
  assert.doesNotMatch(ciWorkflow, /vercel/i);
  assert.doesNotMatch(ciWorkflow, /stack:set/);
  assert.doesNotMatch(ciWorkflow, /hung-phat\b/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);

async function read(relativePath) {
  return (await readFile(new URL(relativePath, root), "utf8")).replace(/\r\n/g, "\n");
}

const manualWorkflow = await read(".github/workflows/heroku-mcp-backend-manual.yml");
const ciWorkflow = await read(".github/workflows/heroku-mcp-backend-contract-ci.yml");
const dockerfile = await read("mcp/apps/backend/Dockerfile");
const packageJson = JSON.parse(await read("mcp/apps/backend/package.json"));
const backendLock = JSON.parse(await read("mcp/apps/backend/package-lock.json"));
const rootProcfile = (await read("Procfile")).trim();

test("MCP backend runtime stays on bootstrap.js with locked PostgreSQL dependencies", () => {
  assert.equal(packageJson.scripts.start, "node bootstrap.js");
  assert.equal(packageJson.dependencies.pg, "^8.12.0");
  assert.equal(backendLock.packages[""].dependencies.pg, "^8.12.0");
  assert.ok(backendLock.packages["node_modules/pg"]);
  assert.match(dockerfile, /FROM node:20-alpine/);
  assert.match(dockerfile, /ENV HOST=0\.0\.0\.0/);
  assert.match(dockerfile, /USER node/);
  assert.match(dockerfile, /CMD \["node", "bootstrap\.js"\]/);
  assert.ok(dockerfile.includes("COPY package.json package-lock.json ./"));
  assert.ok(dockerfile.includes("RUN npm ci --omit=dev --ignore-scripts"));
  assert.ok(dockerfile.includes("COPY bootstrap.js server.js ./"));
  assert.match(dockerfile, /COPY foundation \.\/foundation/);
  assert.doesNotMatch(dockerfile, /SUPABASE_/i);
  assert.doesNotMatch(dockerfile, /npp-core/i);
  assert.doesNotMatch(dockerfile, /Procfile/i);
  assert.doesNotMatch(dockerfile, /vercel/i);
});

test("manual Heroku MCP workflow performs PostgreSQL preflight and isolated rollback", () => {
  assert.match(manualWorkflow, /workflow_dispatch/);
  assert.match(manualWorkflow, /issue_comment/);
  assert.match(manualWorkflow, /\/deploy-heroku-mcp-production/);
  assert.match(manualWorkflow, /hung-phat-mcp/);
  assert.match(manualWorkflow, /hung-phat/);
  assert.match(manualWorkflow, /heroku apps:info -a "\$HEROKU_APP_NAME" --json/);
  assert.match(manualWorkflow, /heroku stack -a "\$HEROKU_APP_NAME"/);
  assert.match(manualWorkflow, /heroku config -a "\$HEROKU_APP_NAME" --json/);
  assert.match(manualWorkflow, /HEROKU_REQUIRED_CONFIG_NAMES/);
  assert.match(manualWorkflow, /DATABASE_URL/);
  assert.match(manualWorkflow, /MCP_DB_SCHEMA/);
  assert.match(manualWorkflow, /MCP_DB_ROLE/);
  assert.match(manualWorkflow, /PERSISTENCE_PROVIDER/);
  assert.match(manualWorkflow, /test "\$persistence_provider" = "postgresql"/);
  assert.match(manualWorkflow, /MCP_LEGACY_RUNTIME_ENABLED must be false/);
  assert.doesNotMatch(manualWorkflow, /DATABASE_URL must stay absent/);
  assert.doesNotMatch(manualWorkflow.match(/HEROKU_REQUIRED_CONFIG_NAMES:.*$/m)?.[0] || "", /SUPABASE_/);
  assert.match(manualWorkflow, /heroku releases --json -a "\$HEROKU_APP_NAME"/);
  assert.match(manualWorkflow, /previous_active_release_version/);
  assert.match(manualWorkflow, /failed_release_version/);
  assert.match(manualWorkflow, /rollback_target_version/);
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

test("Heroku MCP CI builds, verifies and smokes backend without Supabase env", () => {
  assert.match(ciWorkflow, /pull_request:/);
  assert.match(ciWorkflow, /push:/);
  assert.match(ciWorkflow, /workflow_dispatch/);
  assert.match(ciWorkflow, /npm ci --prefix mcp\/apps\/backend/);
  assert.match(ciWorkflow, /npm --workspace mcp\/apps\/backend run verify/);
  assert.match(ciWorkflow, /npm --workspace mcp run test:heroku-mcp-backend-contract/);
  assert.match(ciWorkflow, /npm --workspace mcp run test:heroku-mcp-backend-runtime/);
  assert.match(ciWorkflow, /phase-6c0b-persistence-boundary\.test\.mjs/);
  assert.match(ciWorkflow, /npm --workspace mcp run test:vercel-deployment-control/);
  assert.match(ciWorkflow, /npm --workspace mcp run typecheck/);
  assert.match(ciWorkflow, /npm --workspace mcp run build/);
  assert.match(ciWorkflow, /docker build -f mcp\/apps\/backend\/Dockerfile mcp\/apps\/backend/);
  assert.match(ciWorkflow, /docker run -d --rm/);
  assert.match(ciWorkflow, /PERSISTENCE_PROVIDER=postgresql/);
  assert.match(ciWorkflow, /smoke \/health\/live 200/);
  assert.match(ciWorkflow, /smoke \/health\/ready 503/);
  assert.match(ciWorkflow, /docker stop "\$container_id"/);
  assert.doesNotMatch(ciWorkflow, /SUPABASE_URL/);
  assert.doesNotMatch(ciWorkflow, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(ciWorkflow, /VERCEL_TOKEN|vercel\s+(?:deploy\b|--prod)|mcp-field/i);
  assert.doesNotMatch(ciWorkflow, /stack:set/);
  assert.doesNotMatch(ciWorkflow, /hung-phat\b/);
});

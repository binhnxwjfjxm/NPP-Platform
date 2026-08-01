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

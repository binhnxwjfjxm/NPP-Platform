import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);

async function read(relativePath) {
  return readFile(new URL(relativePath, root), "utf8");
}

const workflow = await read(".github/workflows/heroku-mcp-backend-manual.yml");
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

test("manual Heroku MCP workflow targets only hung-phat-mcp and packages the backend subtree", () => {
  assert.match(workflow, /workflow_dispatch/);
  assert.match(workflow, /action:/);
  assert.match(workflow, /release_version:/);
  assert.match(workflow, /hung-phat-mcp/);
  assert.match(workflow, /hung-phat/);
  assert.match(workflow, /mcp\/apps\/backend/);
  assert.match(workflow, /Verify exact origin\/main SHA/);
  assert.match(workflow, /heroku container:login/);
  assert.match(workflow, /heroku container:push web -a "\$HEROKU_APP_NAME"/);
  assert.match(workflow, /heroku container:release web -a "\$HEROKU_APP_NAME"/);
  assert.match(workflow, /heroku releases:rollback "\$REQUESTED_RELEASE_VERSION"/);
  assert.match(workflow, /heroku apps:info -a "\$HEROKU_APP_NAME" --json/);
  assert.match(workflow, /health\/live/);
  assert.match(workflow, /health\/ready/);
  assert.match(workflow, /DEPLOYED_SHA/);
  assert.match(workflow, /HEROKU_RELEASE_VERSION/);
  assert.match(workflow, /HEROKU_APP_URL/);
  assert.doesNotMatch(workflow, /vercel/i);
  assert.doesNotMatch(workflow, /npp-core\//);
  assert.doesNotMatch(workflow, /Procfile/);
  assert.doesNotMatch(workflow, /DATABASE_URL/);
  assert.doesNotMatch(workflow, /^\s{2}(?:push|pull_request):\s*$/m);
  assert.equal(rootProcfile, "web: npm run start:core-api");
});

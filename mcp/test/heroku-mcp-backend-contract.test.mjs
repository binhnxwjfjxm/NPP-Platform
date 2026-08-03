import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = new URL("../../", import.meta.url);

async function read(relativePath) {
  return (await readFile(new URL(relativePath, root), "utf8")).replace(/\r\n/g, "\n");
}

const manualWorkflow = await read(".github/workflows/heroku-mcp-backend-manual.yml");
const deployScriptPath = new URL("mcp/apps/backend/scripts/manual-production-deploy.sh", root);
const deployScript = await read("mcp/apps/backend/scripts/manual-production-deploy.sh");
const rolloutScriptPath = new URL("mcp/apps/backend/scripts/production-rollout-gate.sh", root);
const rolloutScript = await read("mcp/apps/backend/scripts/production-rollout-gate.sh");
const credentialSafety = await read("mcp/apps/backend/foundation/migrations/credential-safety.js");
const manualContract = `${manualWorkflow}\n${deployScript}\n${rolloutScript}\n${credentialSafety}`;
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

test("manual Heroku MCP workflow is loadable and owns only the approved command", () => {
  assert.match(manualWorkflow, /workflow_dispatch/);
  assert.match(manualWorkflow, /issue_comment/);
  assert.match(manualWorkflow, /github\.event\.comment\.body == '\/deploy-heroku-mcp-production'/);
  assert.match(manualWorkflow, /github\.actor == 'binhnxwjfjxm'/);
  assert.match(manualWorkflow, /github\.actor == 'khuongbinhinfo-a11y'/);
  assert.match(manualWorkflow, /HEROKU_APP_NAME: hung-phat-mcp/);
  assert.match(manualWorkflow, /HEROKU_DB_OWNER_APP_NAME: hung-phat/);
  assert.match(manualWorkflow, /image: postgres:17/);
  assert.match(manualWorkflow, /persist-credentials: false/);
  assert.match(manualWorkflow, /MCP_MIGRATION_CREDENTIAL_MODE: essential_owner/);
  assert.match(manualWorkflow, /MCP_MIGRATION_ESSENTIAL_OWNER_CONFIRM: I_ACKNOWLEDGE_OWNER_CREDENTIAL_IS_NOT_LEAST_PRIVILEGE/);
  assert.match(manualWorkflow, /MCP_RUNTIME_DATABASE_URL_FILE: \/tmp\/mcp-runtime-database-url/);
  assert.match(manualWorkflow, /MCP_MIGRATION_DATABASE_URL_FILE: \/tmp\/mcp-migration-database-url/);
  assert.match(manualWorkflow, /MCP_DB_ROLE_FILE: \/tmp\/mcp-db-role/);
  assert.doesNotMatch(manualWorkflow, /\$\{\{\s*runner\.temp\s*\}\}/);
  assert.match(manualWorkflow, /bash mcp\/apps\/backend\/scripts\/manual-production-deploy\.sh/);
  assert.doesNotMatch(manualWorkflow, /^\s{2}(?:push|pull_request):\s*$/m);
  assert.doesNotMatch(manualWorkflow, /vercel/i);
  assert.doesNotMatch(manualWorkflow, /npp-core\//);
  assert.doesNotMatch(manualWorkflow, /Procfile/);
});

test("manual MCP deploy scripts are valid shell", () => {
  execFileSync("bash", ["-n", fileURLToPath(deployScriptPath)]);
  execFileSync("bash", ["-n", fileURLToPath(rolloutScriptPath)]);
});

test("manual Heroku MCP deployment performs PostgreSQL preflight, backup, migration and isolated rollback", () => {
  assert.match(manualContract, /hung-phat-mcp/);
  assert.match(manualContract, /hung-phat/);
  assert.match(deployScript, /https:\/\/api\.heroku\.com\/apps\/\$HEROKU_APP_NAME/);
  assert.match(deployScript, /Authorization: Bearer \$HEROKU_API_KEY/);
  assert.match(deployScript, /heroku stack -a "\$HEROKU_APP_NAME"/);
  assert.match(deployScript, /heroku config -a "\$HEROKU_APP_NAME" --json/);
  assert.match(deployScript, /HEROKU_REQUIRED_CONFIG_NAMES/);
  assert.match(deployScript, /PERSISTENCE_PROVIDER/);
  assert.match(deployScript, /postgresql/);
  assert.match(deployScript, /MCP_LEGACY_RUNTIME_ENABLED must be false/);
  assert.match(credentialSafety, /runtime_and_migrator_target_different_databases/);
  assert.match(credentialSafety, /migration_runtime_credential_not_separated/);
  assert.match(credentialSafety, /essential_owner_migration_not_authorized/);
  assert.match(credentialSafety, /leastPrivilege: false/);
  assert.match(deployScript, /MCP_MIGRATION_CREDENTIAL_MODE/);
  assert.match(deployScript, /MCP_MIGRATION_LEAST_PRIVILEGE/);
  assert.match(deployScript, /umask 077/);
  assert.match(deployScript, /heroku pg:backups:capture DATABASE_URL -a "\$HEROKU_DB_OWNER_APP_NAME"/);
  assert.match(deployScript, /heroku pg:backups:info "\$production_backup_id"/);
  assert.match(deployScript, /heroku maintenance:on -a "\$HEROKU_APP_NAME"/);
  assert.match(deployScript, /production-rollout-gate\.sh/);
  assert.match(rolloutScript, /pg_dump/);
  assert.match(rolloutScript, /pg_restore/);
  assert.match(rolloutScript, /run migration:migrate/);
  assert.match(rolloutScript, /run migration:verify/);
  assert.match(rolloutScript, /if \[ "\$credential_mode" = "separated" \]/);
  assert.match(rolloutScript, /shared\.grant_mcp_runtime_access/);
  assert.match(rolloutScript, /runtime_grant="skipped_essential_owner"/);
  assert.match(deployScript, /heroku container:login/);
  assert.match(deployScript, /heroku container:push web -a "\$HEROKU_APP_NAME"/);
  assert.match(deployScript, /heroku container:release web -a "\$HEROKU_APP_NAME"/);
  assert.match(deployScript, /previous_active_release_version/);
  assert.match(deployScript, /previous_release_healthy/);
  assert.match(deployScript, /heroku releases:rollback "\$previous_active_release_version"/);
  assert.match(deployScript, /Previous release was already unhealthy; automatic rollback is intentionally skipped/);
  assert.match(deployScript, /health\/live/);
  assert.match(deployScript, /health\/ready/);
  assert.match(deployScript, /DEPLOYED_SHA/);
  assert.doesNotMatch(manualContract, /(?:^|\n)\s*(?:export\s+)?SUPABASE_[A-Z0-9_]*\s*=/i);
  assert.doesNotMatch(manualContract, /\$\{\{\s*(?:secrets|vars|env)\.SUPABASE_/i);
  assert.doesNotMatch(manualContract, /stack:set/);
  assert.doesNotMatch(manualContract, /npp-core\//);
  assert.doesNotMatch(manualContract, /vercel/i);
  assert.equal(rootProcfile, "web: npm run start:core-api");
});

test("deploy failure remains failed and never rolls back to an already unhealthy release", () => {
  const deployIndex = deployScript.indexOf("deploy)");
  const healthFailureIndex = deployScript.indexOf("if ! smoke_health /health/live || ! smoke_health /health/ready; then", deployIndex);
  const rollbackGuardIndex = deployScript.indexOf('if [ "$previous_release_healthy" = "true" ]; then', healthFailureIndex);
  const rollbackCommandIndex = deployScript.indexOf('heroku releases:rollback "$previous_active_release_version"', rollbackGuardIndex);
  const skipIndex = deployScript.indexOf("Previous release was already unhealthy", rollbackCommandIndex);
  const failureExitIndex = deployScript.indexOf("exit 1", rollbackCommandIndex);

  assert.ok(deployIndex >= 0);
  assert.ok(healthFailureIndex > deployIndex);
  assert.ok(rollbackGuardIndex > healthFailureIndex);
  assert.ok(rollbackCommandIndex > rollbackGuardIndex);
  assert.ok(skipIndex > rollbackCommandIndex);
  assert.ok(failureExitIndex > rollbackCommandIndex);
  assert.match(deployScript, /trap cleanup EXIT/);
  assert.match(deployScript, /heroku maintenance:off -a "\$HEROKU_APP_NAME"/);
});

test("Heroku MCP CI builds, verifies and smokes backend with frontend build fixtures", () => {
  assert.match(ciWorkflow, /pull_request:/);
  assert.match(ciWorkflow, /push:/);
  assert.match(ciWorkflow, /workflow_dispatch/);
  assert.match(ciWorkflow, /npm ci --prefix mcp\/apps\/backend/);
  assert.match(ciWorkflow, /npm --workspace mcp\/apps\/backend run verify/);
  assert.match(ciWorkflow, /npm --workspace mcp run test:heroku-mcp-backend-contract/);
  assert.match(ciWorkflow, /npm --workspace mcp run test:heroku-mcp-backend-runtime/);
  assert.match(ciWorkflow, /npm --workspace mcp run typecheck/);
  assert.match(ciWorkflow, /npm --workspace mcp run build/);
  assert.match(ciWorkflow, /docker build -f mcp\/apps\/backend\/Dockerfile mcp\/apps\/backend/);
  assert.match(ciWorkflow, /docker run -d --rm/);
  assert.match(ciWorkflow, /PERSISTENCE_PROVIDER=postgresql/);
  assert.match(ciWorkflow, /smoke \/health\/live 200/);
  assert.match(ciWorkflow, /smoke \/health\/ready 503/);
  assert.match(ciWorkflow, /docker stop "\$container_id"/);
  assert.doesNotMatch(ciWorkflow, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(ciWorkflow, /VERCEL_TOKEN|vercel\s+(?:deploy\b|--prod)|mcp-field/i);
  assert.doesNotMatch(ciWorkflow, /stack:set/);
  assert.doesNotMatch(ciWorkflow, /hung-phat\b/);
});

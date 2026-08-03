import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const workflowPath = new URL(".github/workflows/heroku-mcp-backend-manual.yml", root);
const deployScriptPath = new URL("mcp/apps/backend/scripts/manual-production-deploy.sh", root);
const rolloutScriptPath = new URL("mcp/apps/backend/scripts/production-rollout-gate.sh", root);
const credentialSafetyPath = new URL("mcp/apps/backend/foundation/migrations/credential-safety.js", root);
const workflow = (await readFile(workflowPath, "utf8")).replace(/\r\n/g, "\n");
const deployScript = (await readFile(deployScriptPath, "utf8")).replace(/\r\n/g, "\n");
const rolloutScript = (await readFile(rolloutScriptPath, "utf8")).replace(/\r\n/g, "\n");
const credentialSafety = (await readFile(credentialSafetyPath, "utf8")).replace(/\r\n/g, "\n");
const deployment = `${workflow}\n${deployScript}\n${rolloutScript}\n${credentialSafety}`;

test("production rollout scripts are valid shell", () => {
  execFileSync("bash", ["-n", fileURLToPath(deployScriptPath)]);
  execFileSync("bash", ["-n", fileURLToPath(rolloutScriptPath)]);
});

test("MCP migration and deploy commands share the complete database gate", () => {
  assert.match(workflow, /\/deploy-heroku-mcp-production/);
  assert.match(workflow, /\/migrate-heroku-mcp-production/);
  assert.match(workflow, /action="migrate"/);
  assert.match(workflow, /HEROKU_APP_NAME: hung-phat-mcp/);
  assert.match(workflow, /HEROKU_DB_OWNER_APP_NAME: hung-phat/);
  assert.match(workflow, /image: postgres:17/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /MCP_RUNTIME_DATABASE_URL_FILE: \/tmp\/mcp-runtime-database-url/);
  assert.match(workflow, /MCP_MIGRATION_DATABASE_URL_FILE: \/tmp\/mcp-migration-database-url/);
  assert.match(workflow, /MCP_DB_ROLE_FILE: \/tmp\/mcp-db-role/);
  assert.match(workflow, /MCP_MIGRATION_CREDENTIAL_MODE: essential_owner/);
  assert.match(workflow, /MCP_MIGRATION_ESSENTIAL_OWNER_CONFIRM: I_ACKNOWLEDGE_OWNER_CREDENTIAL_IS_NOT_LEAST_PRIVILEGE/);
  for (const requiredName of [
    "CORE_ONBOARDING_TIMEOUT_MS",
    "CORE_SALES_TIMEOUT_MS",
    "MCP_SERVICE_PERMISSIONS",
    "MCP_SERVICE_SCOPES"
  ]) {
    assert.match(workflow, new RegExp(requiredName));
  }
  assert.doesNotMatch(workflow, /\$\{\{\s*runner\.temp\s*\}\}/);
  assert.match(workflow, /bash mcp\/apps\/backend\/scripts\/manual-production-deploy\.sh/);
  assert.match(deployScript, /test "\$HEROKU_APP_NAME" != "\$HEROKU_DB_OWNER_APP_NAME"/);
  assert.match(deployScript, /umask 077/);
  assert.match(deployScript, /run_production_migration_gate\(\)/);
  assert.match(deployScript, /heroku pg:backups:capture DATABASE_URL -a "\$HEROKU_DB_OWNER_APP_NAME"/);
  assert.match(deployScript, /heroku pg:backups:info "\$production_backup_id"/);
  assert.match(deployScript, /heroku maintenance:on -a "\$HEROKU_APP_NAME"/);
  assert.match(deployScript, /bash mcp\/apps\/backend\/scripts\/production-rollout-gate\.sh/);
  assert.match(deployScript, /heroku container:push web -a "\$HEROKU_APP_NAME"/);
  assert.match(deployScript, /heroku maintenance:off -a "\$HEROKU_APP_NAME"/);

  const migrateCase = deployScript.match(/migrate\)\n([\s\S]*?)\n\s*;;/);
  assert.ok(migrateCase, "missing migrate action");
  assert.match(migrateCase[1], /run_production_migration_gate/);
  assert.match(migrateCase[1], /smoke_health \/health\/live/);
  assert.match(migrateCase[1], /smoke_health \/health\/ready/);
  assert.doesNotMatch(migrateCase[1], /container:(?:push|release)/);

  const deployCase = deployScript.match(/deploy\)\n([\s\S]*?)\n\s*;;/);
  assert.ok(deployCase, "missing deploy action");
  assert.match(deployCase[1], /run_production_migration_gate/);
  assert.match(deployCase[1], /container:push web/);
  assert.match(deployCase[1], /container:release web/);
  assert.doesNotMatch(deployment, /container:(?:push|release)[^\n]+HEROKU_DB_OWNER_APP_NAME/);
});

test("database gate proves backup restore, idempotency, verification and reconciliation", () => {
  assert.match(rolloutScript, /pg_dump/);
  assert.match(rolloutScript, /pg_restore/);
  assert.match(rolloutScript, /snapshot_counts/);
  assert.match(rolloutScript, /assert_existing_counts_unchanged/);
  assert.match(credentialSafety, /runtime_and_migrator_target_different_databases/);
  assert.match(credentialSafety, /migration_runtime_credential_not_separated/);
  assert.match(credentialSafety, /essential_owner_migration_not_authorized/);
  assert.match(credentialSafety, /leastPrivilege: false/);
  assert.match(rolloutScript, /MCP_MIGRATION_ALLOW_PRODUCTION=true/);
  assert.match(rolloutScript, /MCP_MIGRATION_PRODUCTION_CONFIRM=I_UNDERSTAND_THIS_TARGETS_PRODUCTION/);
  assert.equal((rolloutScript.match(/run migration:migrate/g) || []).length, 4);
  assert.equal((rolloutScript.match(/run migration:verify/g) || []).length, 2);
  assert.match(rolloutScript, /if \[ "\$credential_mode" = "separated" \]/);
  assert.match(rolloutScript, /shared\.grant_mcp_runtime_access/);
  assert.match(rolloutScript, /runtime_grant="skipped_essential_owner"/);
  assert.match(rolloutScript, /MCP_RESTORE_REHEARSAL=success/);
  assert.match(rolloutScript, /MCP_PRODUCTION_RECONCILIATION=success/);
  assert.match(deployment, /MCP_MIGRATION_CREDENTIAL_MODE/);
  assert.match(deployment, /MCP_MIGRATION_LEAST_PRIVILEGE/);
  assert.doesNotMatch(deployment, /(?:^|\n)\s*(?:export\s+)?SUPABASE_[A-Z0-9_]*\s*=/i);
  assert.doesNotMatch(deployment, /\$\{\{\s*(?:secrets|vars|env)\.SUPABASE_/i);
});

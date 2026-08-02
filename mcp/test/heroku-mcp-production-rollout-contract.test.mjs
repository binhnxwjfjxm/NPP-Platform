import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const workflowPath = new URL(".github/workflows/heroku-mcp-backend-manual.yml", root);
const scriptPath = new URL("mcp/apps/backend/scripts/production-rollout-gate.sh", root);
const workflow = (await readFile(workflowPath, "utf8")).replace(/\r\n/g, "\n");
const script = (await readFile(scriptPath, "utf8")).replace(/\r\n/g, "\n");

test("production rollout script is valid shell", () => {
  execFileSync("bash", ["-n", scriptPath.pathname]);
});

test("the existing MCP deploy command owns the complete database gate", () => {
  assert.match(workflow, /\/deploy-heroku-mcp-production/);
  assert.match(workflow, /HEROKU_APP_NAME: hung-phat-mcp/);
  assert.match(workflow, /HEROKU_DB_OWNER_APP_NAME: hung-phat/);
  assert.match(workflow, /test "\$HEROKU_APP_NAME" != "\$HEROKU_DB_OWNER_APP_NAME"/);
  assert.match(workflow, /image: postgres:17/);
  assert.match(workflow, /heroku pg:backups:capture DATABASE_URL -a "\$HEROKU_DB_OWNER_APP_NAME"/);
  assert.match(workflow, /heroku pg:backups:info "\$production_backup_id"/);
  assert.match(workflow, /heroku maintenance:on -a "\$HEROKU_APP_NAME"/);
  assert.match(workflow, /bash mcp\/apps\/backend\/scripts\/production-rollout-gate\.sh/);
  assert.match(workflow, /heroku container:push web -a "\$HEROKU_APP_NAME"/);
  assert.match(workflow, /heroku maintenance:off -a "\$HEROKU_APP_NAME"/);
  assert.doesNotMatch(workflow, /container:(?:push|release)[^\n]+HEROKU_DB_OWNER_APP_NAME/);
});

test("database gate proves backup restore, migration idempotency and reconciliation", () => {
  assert.match(script, /pg_dump/);
  assert.match(script, /pg_restore/);
  assert.match(script, /snapshot_counts/);
  assert.match(script, /assert_existing_counts_unchanged/);
  assert.match(script, /runtime_and_migrator_target_different_databases/);
  assert.match(script, /runtime_and_migrator_credentials_not_separated/);
  assert.match(script, /MCP_MIGRATION_ALLOW_PRODUCTION=true/);
  assert.match(script, /MCP_MIGRATION_PRODUCTION_CONFIRM=I_UNDERSTAND_THIS_TARGETS_PRODUCTION/);
  assert.equal((script.match(/run migration:migrate/g) || []).length, 4);
  assert.equal((script.match(/run migration:verify/g) || []).length, 2);
  assert.match(script, /shared\.grant_mcp_runtime_access/);
  assert.match(script, /MCP_RESTORE_REHEARSAL=success/);
  assert.match(script, /MCP_PRODUCTION_RECONCILIATION=success/);
  assert.doesNotMatch(script, /SUPABASE_/i);
});

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const rolloutPath = new URL("mcp/apps/backend/scripts/production-rollout-gate.sh", root);
const packagePath = new URL("mcp/package.json", root);
const rollout = (await readFile(rolloutPath, "utf8")).replace(/\r\n/g, "\n");
const packageJson = JSON.parse(await readFile(packagePath, "utf8"));

test("report settings rollout reconciliation permits only bounded seed growth", () => {
  execFileSync("bash", ["-n", fileURLToPath(rolloutPath)]);

  assert.match(rollout, /assert_existing_counts_unchanged \"\$production_before\" \"\$restore_before\" \"backup restore\"/);
  assert.match(rollout, /assert_non_report_settings_counts_unchanged\(\)/);
  assert.match(rollout, /mcp_report_setting_groups\|mcp_report_settings\) continue/);
  assert.match(rollout, /assert_report_settings_seed_growth_bounded\(\)/);
  assert.match(rollout, /mcp_report_setting_groups\) maximum_growth=7/);
  assert.match(rollout, /mcp_report_settings\) maximum_growth=53/);
  assert.match(rollout, /assert_legacy_report_settings_seed\(\)/);

  assert.match(rollout, /90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b/);
  assert.match(rollout, /legacy_snapshot_sha256/);
  assert.match(rollout, /7\|53\|0/);
  assert.doesNotMatch(rollout, /legacy_items WHERE active|legacy_items WHERE NOT active/);

  assert.match(
    rollout,
    /assert_legacy_report_settings_seed \"\$restore_database_url\" \"restore migration rehearsal\"/
  );
  assert.match(
    rollout,
    /assert_legacy_report_settings_seed \"\$migration_database_url\" \"production migration\"/
  );
  assert.match(rollout, /MCP_LEGACY_REPORT_SETTINGS=7_groups_53_items_reconciled/);
});

test("report settings reconciliation keeps the database URL out of docker process arguments", () => {
  assert.match(rollout, /docker exec -i[\s\S]*?-e DATABASE_URL=\"\$database_url\"/);
  assert.match(rollout, /psql \"\$DATABASE_URL\" -XAt/);
  assert.doesNotMatch(rollout, /docker exec \"\$service_id\"[\s\\\n]+psql \"\$database_url\"/);
});

test("report settings rollout contract is executed by the Heroku MCP CI script", () => {
  assert.match(
    packageJson.scripts["test:heroku-mcp-backend-contract"],
    /test\/heroku-mcp-report-settings-rollout-contract\.test\.mjs/
  );
});
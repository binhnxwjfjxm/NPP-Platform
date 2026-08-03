import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const rolloutPath = new URL("mcp/apps/backend/scripts/production-rollout-gate.sh", root);
const rollout = (await readFile(rolloutPath, "utf8")).replace(/\r\n/g, "\n");

test("report settings rollout reconciliation permits only the intentional seed growth", () => {
  execFileSync("bash", ["-n", fileURLToPath(rolloutPath)]);

  assert.match(rollout, /assert_existing_counts_unchanged \"\$production_before\" \"\$restore_before\" \"backup restore\"/);
  assert.match(rollout, /assert_non_report_settings_counts_unchanged\(\)/);
  assert.match(rollout, /mcp_report_setting_groups\|mcp_report_settings\) continue/);
  assert.match(rollout, /assert_report_settings_counts_not_decreased\(\)/);
  assert.match(rollout, /assert_legacy_report_settings_seed\(\)/);

  assert.match(rollout, /90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b/);
  assert.match(rollout, /legacy_snapshot_sha256/);
  assert.match(rollout, /7\|53\|52\|1\|0/);

  assert.match(
    rollout,
    /assert_legacy_report_settings_seed \"\$restore_database_url\" \"restore migration rehearsal\"/
  );
  assert.match(
    rollout,
    /assert_legacy_report_settings_seed \"\$migration_database_url\" \"production migration\"/
  );
  assert.match(rollout, /MCP_LEGACY_REPORT_SETTINGS=7_groups_53_items_52_active_1_inactive/);
});

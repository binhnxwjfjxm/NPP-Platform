import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const migrationPath = fileURLToPath(new URL(
  "../../../supabase/migrations/20260716213000_report_setting_mutations.sql",
  import.meta.url
));
const sql = await readFile(migrationPath, "utf8");

const functions = [
  "mcp_create_report_setting_group",
  "mcp_update_report_setting_group",
  "mcp_create_report_setting_item",
  "mcp_update_report_setting_item"
];

test("migration defines four specific report-setting RPC owners", () => {
  for (const name of functions) {
    assert.match(sql, new RegExp(`create or replace function public\\.${name}\\(`, "i"));
  }
  assert.doesNotMatch(sql, /generic.*table|p_table_name/i);
});

test("update RPCs lock existing rows and fail closed on zero rows", () => {
  assert.match(sql, /from public\.mcp_setting_groups[\s\S]*?where id = p_group_id[\s\S]*?for update;/i);
  assert.match(sql, /raise exception 'report_setting_group_not_found'/i);
  assert.match(sql, /from public\.mcp_setting_items[\s\S]*?where id = p_item_id[\s\S]*?for update;/i);
  assert.match(sql, /raise exception 'report_setting_item_not_found'/i);
  assert.match(sql, /for key share;/i);
});

test("RPCs preserve metadata, record Foundation context, and normalize conflicts", () => {
  assert.match(sql, /jsonb_build_object\('foundation_context'/i);
  assert.match(sql, /coalesce\(v_group\.raw_payload, '\{\}'::jsonb\)/i);
  assert.match(sql, /coalesce\(v_item\.raw_payload, '\{\}'::jsonb\)/i);
  assert.match(sql, /report_setting_group_key_conflict/i);
  assert.match(sql, /report_setting_item_key_conflict/i);
});

test("all report-setting mutation RPCs are service-role-only", () => {
  for (const name of functions) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${name}\\([\\s\\S]*?from public, anon, authenticated;`, "i"));
    assert.match(sql, new RegExp(`grant execute on function public\\.${name}\\([\\s\\S]*?to service_role;`, "i"));
  }
});

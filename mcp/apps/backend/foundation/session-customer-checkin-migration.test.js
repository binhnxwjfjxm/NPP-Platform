import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const migrationPath = fileURLToPath(new URL(
  "../../../supabase/migrations/20260717124500_session_customer_checkin.sql",
  import.meta.url
));
const sql = await readFile(migrationPath, "utf8");

test("session customer check-in has dedicated persisted location fields", () => {
  for (const column of ["checkin_lat", "checkin_lng", "checkin_accuracy", "checkin_at", "checkin_source"]) {
    assert.match(sql, new RegExp(`add column if not exists ${column}`, "i"));
  }
  assert.match(sql, /mcp_session_customers_checkin_pair_check/i);
  assert.match(sql, /checkin_lat between -90 and 90/i);
  assert.match(sql, /checkin_lng between -180 and 180/i);
  assert.match(sql, /checkin_accuracy is null or checkin_accuracy >= 0/i);
});

test("check-in and undo are one locked transactional mutation", () => {
  assert.match(sql, /create or replace function public\.mcp_set_session_customer_checkin\(/i);
  assert.match(sql, /where id = p_session_customer_id\s+for update;/i);
  assert.match(sql, /perform public\.mcp_assert_session_mutable\(v_sc\.session_id\);/i);
  assert.match(sql, /case when p_checked_in then p_geo_lat else null end/i);
  assert.match(sql, /case when p_checked_in then v_now else null end/i);
  assert.match(sql, /sales_checkin_last_action/i);
  assert.match(sql, /case when p_checked_in then 'checked_in' else 'removed' end/i);
});

test("check-in requires manual coordinates but undo does not accept stale coordinates", () => {
  assert.match(sql, /checkin_coordinates_required/i);
  assert.match(sql, /checkin_coordinates_not_allowed/i);
  assert.match(sql, /coalesce\(v_source, 'browser_manual'\)/i);
});

test("check-in wrapper is idempotent, audited and service-role-only", () => {
  assert.match(sql, /create or replace function public\.mcp_idempotent_set_session_customer_checkin\(/i);
  assert.match(sql, /mcp_idempotency_begin\([\s\S]*?'session-customer\.checkin\.set'/i);
  assert.match(sql, /case when p_checked_in then 'checkin' else 'remove_checkin' end/i);
  assert.match(sql, /mcp_idempotency_complete\(/i);
  assert.match(sql, /revoke all on function public\.mcp_set_session_customer_checkin[\s\S]*?service_role;/i);
  assert.match(sql, /grant execute on function public\.mcp_idempotent_set_session_customer_checkin[\s\S]*?to service_role;/i);
});

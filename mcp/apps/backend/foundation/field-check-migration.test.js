import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const rpcSql = await readFile(
  new URL("../../../supabase/migrations/20260716234500_field_check_mutation_owner.sql", import.meta.url),
  "utf8"
);
const accessSql = await readFile(
  new URL("../../../supabase/migrations/20260716234600_close_field_check_public_writes.sql", import.meta.url),
  "utf8"
);

test("RPC migration defines one locked service-role field-check update owner", () => {
  assert.match(rpcSql, /create or replace function public\.mcp_update_field_check_result\(/i);
  assert.match(rpcSql, /for update;/i);
  assert.match(rpcSql, /deleted_at is null/i);
  assert.match(rpcSql, /field_check_result_not_found/i);
  assert.match(rpcSql, /field_check_session_customer_mismatch/i);
  assert.match(rpcSql, /grant execute on function public\.mcp_update_field_check_result[\s\S]+to service_role;/i);
  assert.match(rpcSql, /revoke execute on function public\.mcp_update_field_check_result[\s\S]+from public, anon, authenticated;/i);
  assert.doesNotMatch(rpcSql, /revoke all on function public\.mcp_update_field_check_result/i);
});

test("RPC migration preserves raw payload and stores Foundation context", () => {
  assert.match(rpcSql, /coalesce\(v_existing\.raw_payload, '\{\}'::jsonb\)/i);
  assert.match(rpcSql, /'field_check_update'/i);
  assert.match(rpcSql, /'foundation_context'/i);
  assert.doesNotMatch(rpcSql, /raw_payload\s*=\s*p_input_meta/i);
});

test("access migration closes direct mutation grants and permissive policies", () => {
  for (const policy of [
    "anon insert test customer results",
    "anon update test customer results",
    "anon insert market reports",
    "anon update market reports"
  ]) {
    assert.match(accessSql, new RegExp(`drop policy if exists "${policy}"`, "i"));
  }
  assert.match(accessSql, /revoke insert, update, truncate on table public\.test_customer_results from anon, authenticated;/i);
  assert.match(accessSql, /revoke insert, update, truncate on table public\.market_reports from anon, authenticated;/i);
  assert.doesNotMatch(accessSql, /revoke select/i);
});

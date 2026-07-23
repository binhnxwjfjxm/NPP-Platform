import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const coreSql = await readFile(
  new URL("../../../supabase/migrations/20260717090000_idempotency_audit_core.sql", import.meta.url),
  "utf8"
);
const wrapperSql = await readFile(
  new URL("../../../supabase/migrations/20260717091000_foundation_idempotent_mutations.sql", import.meta.url),
  "utf8"
);

const wrappers = [
  "mcp_idempotent_record_session_customer_result",
  "mcp_idempotent_add_session_customer",
  "mcp_idempotent_create_session_report_snapshot",
  "mcp_idempotent_save_session_report_ai_result",
  "mcp_idempotent_update_field_check_result",
  "mcp_idempotent_create_report_setting_group",
  "mcp_idempotent_update_report_setting_group",
  "mcp_idempotent_create_report_setting_item",
  "mcp_idempotent_update_report_setting_item"
];

test("core migration creates scoped persisted idempotency state", () => {
  assert.match(coreSql, /create table if not exists public\.mcp_idempotency_records/i);
  assert.match(coreSql, /unique \(installation_id, operation, idempotency_key\)/i);
  assert.match(coreSql, /status in \('processing', 'completed', 'failed'\)/i);
  assert.match(coreSql, /request_hash ~ '\^\[0-9a-f\]\{64\}\$'/i);
  assert.match(coreSql, /mcp_idempotency_records_status_lease_idx/i);
  assert.match(coreSql, /mcp_idempotency_records_expires_at_idx/i);
  assert.match(coreSql, /expires_at = now\(\) \+ interval '30 days'/i);
  assert.equal((coreSql.match(/extensions\.digest\(/g) || []).length, 3);
});

test("audit ledger is service-owned and append-only", () => {
  assert.match(coreSql, /create table if not exists public\.mcp_audit_events/i);
  assert.match(coreSql, /outcome in \('succeeded', 'rejected', 'failed', 'replayed'\)/i);
  assert.match(coreSql, /before update or delete on public\.mcp_audit_events/i);
  assert.match(coreSql, /raise exception 'audit_events_append_only'/i);
  assert.match(
    coreSql,
    /revoke select, insert, update, delete, truncate, references, trigger on table public\.mcp_audit_events from public, anon, authenticated;/i
  );
  assert.match(coreSql, /grant select on table public\.mcp_audit_events to service_role;/i);
  assert.doesNotMatch(coreSql, /grant (?:insert|update|delete) on table public\.mcp_audit_events to (?:anon|authenticated)/i);
  assert.doesNotMatch(coreSql, /revoke all on table public\.mcp_audit_events/i);
});

test("claim helper implements hash, replay, conflict, lease and reclaim semantics", () => {
  assert.match(coreSql, /digest\([\s\S]*?p_operation[\s\S]*?p_payload[\s\S]*?'sha256'/i);
  assert.match(coreSql, /on conflict \(installation_id, operation, idempotency_key\) do nothing/i);
  assert.match(coreSql, /set_config\('lock_timeout', '2000ms', true\)/i);
  assert.match(coreSql, /raise exception 'idempotency_key_conflict'/i);
  assert.match(coreSql, /raise exception 'idempotency_in_progress'/i);
  assert.match(coreSql, /if v_record\.status = 'completed'/i);
  assert.match(coreSql, /'mode', 'replay'/i);
  assert.match(coreSql, /attempt_count = attempt_count \+ 1/i);
  assert.match(coreSql, /locked_until = now\(\) \+ make_interval/i);
});

test("completion stores response and audit success in the same SQL function", () => {
  const start = coreSql.indexOf("create or replace function public.mcp_idempotency_complete(");
  assert.notEqual(start, -1);
  const body = coreSql.slice(start);
  assert.match(body, /where id = p_record_id\s+for update;/i);
  assert.match(body, /status = 'completed'/i);
  assert.match(body, /response_payload = v_payload/i);
  assert.match(body, /perform public\.mcp_append_audit_event\(/i);
  assert.match(body, /'succeeded'/i);
  assert.match(body, /'data', v_payload/i);
  assert.match(body, /'replayed', false/i);
});

test("generic idempotency helpers are not callable through service role", () => {
  for (const name of [
    "mcp_idempotency_request_hash",
    "mcp_append_audit_event",
    "mcp_idempotency_begin",
    "mcp_idempotency_complete"
  ]) {
    assert.match(
      coreSql,
      new RegExp(`revoke execute on function public\\.${name}\\([\\s\\S]*?service_role;`, "i")
    );
  }
  assert.doesNotMatch(coreSql, /revoke all on function public\.mcp_(?:idempotency|append_audit)/i);
});

test("nine Foundation mutation routes have typed wrappers", () => {
  for (const name of wrappers) {
    assert.match(wrapperSql, new RegExp(`create or replace function public\\.${name}\\(`, "i"));
    assert.match(wrapperSql, new RegExp(`grant execute on function public\\.${name}\\([\\s\\S]*?to service_role;`, "i"));
  }
  assert.equal((wrapperSql.match(/mcp_idempotency_begin\(/g) || []).length, 9);
  assert.equal((wrapperSql.match(/mcp_idempotency_complete\(/g) || []).length, 9);
  assert.equal((wrapperSql.match(/->> 'mode' = 'replay'/g) || []).length, 9);
});

test("typed wrappers delegate to existing business owners instead of copying table writes", () => {
  for (const businessOwner of [
    "mcp_record_session_customer_result",
    "mcp_add_session_customer",
    "mcp_create_session_report_snapshot",
    "mcp_save_session_report_ai_result",
    "mcp_update_field_check_result",
    "mcp_create_report_setting_group",
    "mcp_update_report_setting_group",
    "mcp_create_report_setting_item",
    "mcp_update_report_setting_item"
  ]) {
    assert.match(wrapperSql, new RegExp(`public\\.${businessOwner}\\(`, "i"));
  }
  assert.doesNotMatch(wrapperSql, /p_table_name|generic_table|execute format/i);
});

test("session report snapshot wrapper persists Foundation context", () => {
  const start = wrapperSql.indexOf("create or replace function public.mcp_idempotent_create_session_report_snapshot(");
  const end = wrapperSql.indexOf("create or replace function public.mcp_idempotent_save_session_report_ai_result(", start);
  const body = wrapperSql.slice(start, end);
  assert.match(body, /update public\.mcp_session_reports as report/i);
  assert.match(body, /'\{foundation_context\}'/i);
  assert.match(body, /coalesce\(p_context, '\{\}'::jsonb\)/i);
  assert.match(body, /returning to_jsonb\(report\) into v_data;/i);
});

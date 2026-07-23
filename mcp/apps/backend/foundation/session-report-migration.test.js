import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const migrationPath = fileURLToPath(new URL(
  "../../../supabase/migrations/20260716193000_save_session_report_ai_result.sql",
  import.meta.url
));
const sql = await readFile(migrationPath, "utf8");

test("AI result RPC locks and updates exactly one existing session report", () => {
  assert.match(sql, /create or replace function public\.mcp_save_session_report_ai_result/i);
  assert.match(sql, /where session_id = p_session_id\s+for update;/i);
  assert.match(sql, /raise exception 'session_report_not_found'/i);
  assert.match(sql, /update public\.mcp_session_reports/i);
  assert.match(sql, /where id = v_report\.id\s+returning \* into v_report;/i);
});

test("AI result RPC preserves report payload and records foundation context", () => {
  assert.match(sql, /ai_result = p_ai_result/i);
  assert.match(sql, /ai_analyzed_at = v_analyzed_at/i);
  assert.match(sql, /jsonb_set\([\s\S]*?'\{aiResultContext\}'/i);
  assert.match(sql, /coalesce\(raw_payload, '\{\}'::jsonb\)/i);
});

test("AI result RPC remains service-role-only", () => {
  assert.match(sql, /revoke all on function public\.mcp_save_session_report_ai_result\([\s\S]*?from public, anon, authenticated;/i);
  assert.match(sql, /grant execute on function public\.mcp_save_session_report_ai_result\([\s\S]*?to service_role;/i);
});

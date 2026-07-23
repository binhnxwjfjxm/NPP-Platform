import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(
  new URL("../../../supabase/migrations/20260719200000_a5_5_2_session_lifecycle_idempotency.sql", import.meta.url),
  "utf8"
);

const wrappers = [
  "mcp_idempotent_open_route_session",
  "mcp_idempotent_set_session_customer_status",
  "mcp_idempotent_update_route_session",
  "mcp_idempotent_delete_empty_route_session"
];

const owners = [
  "mcp_open_route_session",
  "mcp_set_session_customer_status",
  "mcp_update_route_session",
  "mcp_delete_empty_route_session"
];

const operations = [
  ["route-session.open", "POST", "/api/mcp-day/open-session"],
  ["session-customer.status.update", "POST", "/api/mcp-day/session-customer/status"],
  ["route-session.update", "PATCH", "/api/mcp-sessions/:id"],
  ["route-session.delete-empty", "DELETE", "/api/mcp-sessions/:id"]
];

test("A5.5.2 session lifecycle adds four typed persisted-idempotent wrappers", () => {
  for (const wrapper of wrappers) {
    assert.match(sql, new RegExp(`create or replace function public\\.${wrapper}\\(`, "i"));
    assert.match(sql, new RegExp(`revoke execute on function public\\.${wrapper}\\([\\s\\S]*?from public, anon, authenticated;`, "i"));
    assert.match(sql, new RegExp(`grant execute on function public\\.${wrapper}\\([\\s\\S]*?to service_role;`, "i"));
  }
  assert.equal((sql.match(/mcp_idempotency_begin\(/g) || []).length, 4);
  assert.equal((sql.match(/mcp_idempotency_complete\(/g) || []).length, 4);
  assert.equal((sql.match(/->> 'mode' = 'replay'/g) || []).length, 4);
});

test("wrappers preserve canonical PostgreSQL business owners", () => {
  for (const owner of owners) {
    assert.match(sql, new RegExp(`v_data := public\\.${owner}\\(`, "i"));
  }
  assert.doesNotMatch(sql, /execute\s+format|p_table_name|generic_table/i);
});

test("operation inventory locks method and route for all four user intents", () => {
  for (const [operation, method, route] of operations) {
    const pattern = [operation, method, route]
      .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("[\\s\\S]*?");
    assert.match(sql, new RegExp(pattern));
  }
});

test("trusted Foundation context is persisted on surviving lifecycle aggregates", () => {
  assert.match(sql, /update public\.mcp_route_sessions[\s\S]*?'\{foundation_context\}'/i);
  assert.match(sql, /update public\.mcp_session_customers[\s\S]*?'\{foundation_context\}'/i);
  assert.match(sql, /update public\.mcp_visits[\s\S]*?'\{foundation_context\}'/i);
  assert.match(sql, /update public\.mcp_session_reports[\s\S]*?'\{foundation_context\}'/i);
  assert.equal((sql.match(/coalesce\(p_context, '\{\}'::jsonb\)/g) || []).length >= 4, true);
});

test("destructive wrapper only delegates to the guarded empty-session owner", () => {
  const start = sql.indexOf("create or replace function public.mcp_idempotent_delete_empty_route_session(");
  assert.notEqual(start, -1);
  const body = sql.slice(start, sql.indexOf("revoke execute", start));
  assert.match(body, /public\.mcp_delete_empty_route_session\(/i);
  assert.match(body, /session_delete_not_applied/i);
  assert.doesNotMatch(body, /delete\s+from\s+public\.mcp_route_sessions/i);
});

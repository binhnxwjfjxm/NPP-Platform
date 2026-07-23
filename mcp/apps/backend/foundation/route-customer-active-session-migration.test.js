import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(
  new URL("../../../supabase/migrations/20260717160000_route_active_session_explicit_sync.sql", import.meta.url),
  "utf8"
);

function functionBody(name) {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const next = sql.indexOf("create or replace function public.", start + 1);
  return sql.slice(start, next === -1 ? undefined : next);
}

test("route customer explicit sync is one typed persisted-idempotent transaction", () => {
  const body = functionBody("mcp_idempotent_add_route_customer");
  assert.match(body, /mcp_idempotency_begin\([\s\S]*?'route-customer\.add'[\s\S]*?'\/api\/route-customers'/i);
  assert.match(body, /->> 'mode' = 'replay'/i);
  assert.match(body, /mcp_idempotency_complete\(/i);
  assert.match(body, /'routeCustomerId'/i);
  assert.match(body, /'sessionCustomerId'/i);
});

test("active-session inclusion locks and validates the exact session before the route", () => {
  const body = functionBody("mcp_idempotent_add_route_customer");
  const sessionLock = body.indexOf("from public.mcp_route_sessions");
  const routeLock = body.indexOf("from public.mcp_routes");
  assert.ok(sessionLock >= 0 && routeLock > sessionLock, "session lock must precede route lock to match the existing session-add flow");
  assert.match(body, /where id = v_active_session_id[\s\S]*?for update;/i);
  assert.match(body, /active_session_route_mismatch/i);
  assert.match(body, /perform public\.mcp_assert_session_mutable\(v_session\.id\)/i);
  assert.match(body, /if v_include_active_session then/i);
});

test("added snapshot carries the exact explicit session context required by the existing trigger", () => {
  const body = functionBody("mcp_idempotent_add_route_customer");
  assert.match(body, /jsonb_build_object\([\s\S]*?'source', 'route_customer_explicit_sync'[\s\S]*?'session_id', v_session\.id[\s\S]*?'route_customer_id', v_route_customer\.id/i);
});

test("duplicate route and session customers are resolved without rewriting operational state", () => {
  const body = functionBody("mcp_idempotent_add_route_customer");
  assert.match(body, /regexp_replace\(coalesce\(phone, ''\), '\[\^0-9\]\+', '', 'g'\)/i);
  assert.match(body, /lower\(btrim\(customer_name\)\) = lower\(v_customer_name\)/i);
  assert.match(body, /where session_id = v_session\.id[\s\S]*?and route_customer_id = v_route_customer\.id[\s\S]*?for update;/i);
  assert.match(body, /if v_session_customer\.id is null then[\s\S]*?insert into public\.mcp_session_customers/i);
  assert.match(body, /'pending'/i);
  assert.doesNotMatch(body, /delete from public\.mcp_session_customers/i);
  assert.doesNotMatch(body, /update public\.mcp_session_customers[\s\S]*?visit_status/i);
});

test("route lock serializes logical duplicate creation and wrapper stays service-role only", () => {
  const body = functionBody("mcp_idempotent_add_route_customer");
  assert.match(body, /select \* into v_route[\s\S]*?from public\.mcp_routes[\s\S]*?for update;/i);
  assert.match(body, /insert into public\.mcp_route_customers/i);
  assert.match(sql, /revoke all on function public\.mcp_idempotent_add_route_customer\([\s\S]*?from public, anon, authenticated;/i);
  assert.match(sql, /grant execute on function public\.mcp_idempotent_add_route_customer\([\s\S]*?to service_role;/i);
  assert.doesNotMatch(sql, /grant execute on function public\.mcp_idempotent_add_route_customer\([\s\S]*?to (?:anon|authenticated)/i);
});
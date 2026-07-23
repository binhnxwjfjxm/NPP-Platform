import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const migrationPath = fileURLToPath(new URL(
  "../../../supabase/migrations/20260716133000_add_route_customer_from_active_session.sql",
  import.meta.url
));
const sql = await readFile(migrationPath, "utf8");

function functionBody() {
  const start = sql.indexOf("create or replace function public.mcp_add_session_customer(");
  const end = sql.indexOf("revoke all on function public.mcp_add_session_customer(", start + 1);
  assert.notEqual(start, -1, "mcp_add_session_customer must be redefined");
  assert.notEqual(end, -1, "mcp_add_session_customer boundary must exist");
  return sql.slice(start, end);
}

test("session add locks the explicit session and its route before creating data", () => {
  const body = functionBody();
  assert.match(body, /from public\.mcp_route_sessions[\s\S]*?where id = p_session_id[\s\S]*?for update;/i);
  assert.match(body, /perform public\.mcp_assert_session_mutable\(v_session\.id\);/i);
  assert.match(body, /from public\.mcp_routes[\s\S]*?where id = v_session\.route_id[\s\S]*?for update;/i);
});

test("route master customer is matched or created before the session snapshot", () => {
  const body = functionBody();
  assert.match(body, /regexp_replace\(coalesce\(phone, ''\), '\[\^0-9\]\+', '', 'g'\)/i);
  assert.match(body, /lower\(btrim\(customer_name\)\) = lower\(v_customer_name\)/i);

  const routeInsert = body.indexOf("insert into public.mcp_route_customers");
  const sessionInsert = body.indexOf("insert into public.mcp_session_customers");
  assert.ok(routeInsert >= 0, "route customer insert must exist");
  assert.ok(sessionInsert > routeInsert, "route customer must be persisted before session snapshot");
});

test("session snapshot always references the route master customer", () => {
  const body = functionBody();
  assert.match(body, /where session_id = v_session\.id\s+and route_customer_id = v_route_customer_id;/i);
  assert.match(body, /v_session\.route_id,\s+v_route_customer\.id,\s+v_route_customer\.customer_id,/i);
  assert.match(body, /'createdRouteCustomer', v_route_customer_created/i);
  assert.match(body, /'createdSessionCustomer', true/i);
});

test("route and session creation stay inside the same RPC boundary", () => {
  const body = functionBody();
  assert.doesNotMatch(body, /functions\/v1/i);
  assert.doesNotMatch(body, /http_post|net\.http/i);
  assert.match(body, /foundation_context/i);
});

test("updated RPC remains service-role-only", () => {
  assert.match(
    sql,
    /revoke all on function public\.mcp_add_session_customer\([\s\S]*?from public, anon, authenticated;/i
  );
  assert.match(
    sql,
    /grant execute on function public\.mcp_add_session_customer\([\s\S]*?to service_role;/i
  );
});

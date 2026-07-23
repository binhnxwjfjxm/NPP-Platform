import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(
  new URL("../../../supabase/migrations/20260719190000_add_standalone_order_create.sql", import.meta.url),
  "utf8"
);

function functionBody(name, nextMarker) {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const end = nextMarker ? sql.indexOf(nextMarker, start + 1) : sql.length;
  assert.notEqual(end, -1, `${name} boundary must exist`);
  return sql.slice(start, end);
}

test("standalone order business owner writes order and items in one PostgreSQL transaction", () => {
  const body = functionBody("mcp_create_order", "create or replace function public.mcp_idempotent_create_order(");
  assert.match(body, /v_mode not in \('existing', 'manual'\)/i);
  assert.match(body, /from public\.mcp_route_customers rc[\s\S]*for share of rc;/i);
  assert.match(body, /insert into public\.orders/i);
  assert.match(body, /insert into public\.order_items/i);
  assert.match(body, /'orders_tab'/i);
  assert.doesNotMatch(body, /insert into public\.mcp_route_customers/i);
});

test("standalone order wrapper provides persisted idempotency, audit context and exact operation inventory", () => {
  const body = functionBody("mcp_idempotent_create_order", "revoke execute on function public.mcp_create_order(");
  assert.match(body, /mcp_idempotency_begin\([\s\S]*?'order\.create'[\s\S]*?'\/api\/orders'/i);
  assert.match(body, /->> 'mode' = 'replay'/i);
  assert.match(body, /public\.mcp_create_order\(/i);
  assert.match(body, /'\{foundation_context\}'/i);
  assert.match(body, /mcp_idempotency_complete\(/i);
});

test("both standalone order RPCs are service-role-only", () => {
  for (const name of ["mcp_create_order", "mcp_idempotent_create_order"]) {
    assert.match(sql, new RegExp(`revoke execute on function public\\.${name}\\([\\s\\S]*?from public, anon, authenticated;`, "i"));
    assert.match(sql, new RegExp(`grant execute on function public\\.${name}\\([\\s\\S]*?to service_role;`, "i"));
  }
});

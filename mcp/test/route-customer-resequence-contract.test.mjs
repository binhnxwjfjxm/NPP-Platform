import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const sql = await readFile(
  new URL("../supabase/migrations/20260723120000_route_customer_resequence.sql", import.meta.url),
  "utf8"
);

test("route customer ordering is serialized before mutation and normalized afterward", () => {
  assert.match(sql, /create or replace function public\.mcp_route_customer_order_lock_trigger\(/i);
  assert.match(sql, /before insert or delete or update of route_id, sort_order/i);
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\('mcp_route_customer_order:' \|\| new\.route_id, 0\)\)/i);
  assert.match(sql, /create or replace function public\.mcp_resequence_route_customers\(/i);
  assert.match(sql, /row_number\(\) over \(/i);
  assert.match(sql, /set sort_order = ranked\.next_order/i);
  assert.match(sql, /target\.sort_order is distinct from ranked\.next_order/i);
});

test("insert, move and delete all trigger automatic resequencing", () => {
  assert.match(sql, /after insert or delete or update of route_id, sort_order/i);
  assert.match(sql, /if tg_op = 'DELETE'[\s\S]*?mcp_resequence_route_customers\(old\.route_id, null, null, 0\)/i);
  assert.match(sql, /when coalesce\(new\.sort_order, 0\) > coalesce\(old\.sort_order, 0\) then 1/i);
  assert.match(sql, /case when tg_op = 'INSERT' then -1 else v_direction end/i);
  assert.match(sql, /pg_trigger_depth\(\) > 1/i);
});

test("moving up inserts before the occupied slot and moving down ends after it", () => {
  assert.match(sql, /when row\.id = p_moved_id and p_move_direction > 0 then 1/i);
  assert.match(sql, /when row\.id = p_moved_id then -1/i);
  assert.match(sql, /when coalesce\(row\.sort_order, 2147483647\) = v_target and p_move_direction > 0 then -1/i);
  assert.match(sql, /when coalesce\(row\.sort_order, 2147483647\) = v_target then 1/i);
});

test("database forbids duplicate route order at commit while allowing transactional shifts", () => {
  assert.match(sql, /unique \(route_id, sort_order\)/i);
  assert.match(sql, /deferrable initially deferred/i);
  assert.match(sql, /repair every existing route/i);
  assert.match(sql, /select distinct route_id[\s\S]*?mcp_resequence_route_customers/i);
});

test("migration removes only standalone orders with the exact reserved smoke prefix", () => {
  assert.match(sql, /left\(coalesce\(note, ''\), length\('__NPP_F05_RUNTIME_SMOKE__'\)\) = '__NPP_F05_RUNTIME_SMOKE__'/i);
  assert.match(sql, /delete from public\.order_items/i);
  assert.match(sql, /delete from public\.orders/i);
  assert.doesNotMatch(sql, /delete from public\.mcp_routes/i);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(
  new URL("../../../supabase/migrations/20260719220000_a5_5_2_route_customer_update_idempotency.sql", import.meta.url),
  "utf8"
);

test("route-customer update adds one persisted-idempotent service-role wrapper", () => {
  assert.match(sql, /create or replace function public\.mcp_idempotent_update_route_customer\(/i);
  assert.equal((sql.match(/mcp_idempotency_begin\(/g) || []).length, 1);
  assert.equal((sql.match(/mcp_idempotency_complete\(/g) || []).length, 1);
  assert.equal((sql.match(/->> 'mode' = 'replay'/g) || []).length, 1);
  assert.match(sql, /revoke execute on function public\.mcp_idempotent_update_route_customer\([\s\S]*?from public, anon, authenticated;/i);
  assert.match(sql, /grant execute on function public\.mcp_idempotent_update_route_customer\([\s\S]*?to service_role;/i);
});

test("wrapper locks exact public operation and route", () => {
  assert.match(sql, /'route-customer\.update'[\s\S]*?'PATCH'[\s\S]*?'\/api\/route-customers\/:id'/);
});

test("wrapper selects the 13-parameter canonical business overload explicitly", () => {
  const start = sql.indexOf("v_data := public.mcp_update_route_customer(");
  const end = sql.indexOf(");", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const call = sql.slice(start, end);
  for (const argument of [
    "p_route_customer_id",
    "p_customer_name",
    "p_phone",
    "p_area",
    "p_address",
    "p_sort_order",
    "p_note",
    "p_active",
    "p_geo_lat",
    "p_geo_lng",
    "p_geo_accuracy",
    "p_geo_source",
    "p_google_maps_url"
  ]) {
    assert.match(call, new RegExp(`${argument}\\s*=>`));
  }
  assert.equal((call.match(/=>/g) || []).length, 13);
});

test("trusted Foundation context is persisted on the surviving aggregate", () => {
  assert.match(sql, /update public\.mcp_route_customers as row[\s\S]*?'\{foundation_context\}'/i);
  assert.match(sql, /coalesce\(p_context, '\{\}'::jsonb\)/i);
  assert.doesNotMatch(sql, /execute\s+format|p_table_name|generic_table/i);
});

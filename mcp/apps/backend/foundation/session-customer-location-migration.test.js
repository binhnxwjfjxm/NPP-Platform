import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const migrationPath = fileURLToPath(new URL(
  "../../../supabase/migrations/20260716144500_add_session_customer_gps.sql",
  import.meta.url
));
const sql = await readFile(migrationPath, "utf8");

test("GPS RPC keeps old inputs and appends optional location inputs", () => {
  assert.match(sql, /drop function if exists public\.mcp_add_session_customer\([\s\S]*?jsonb[\s\S]*?\);/i);
  assert.match(sql, /p_context jsonb default '\{\}'::jsonb,\s*p_geo_lat double precision default null,\s*p_geo_lng double precision default null/i);
  assert.match(sql, /p_geo_accuracy double precision default null/i);
  assert.match(sql, /p_geo_source text default null/i);
  assert.match(sql, /p_google_maps_url text default null/i);
});

test("GPS validation and persistence stay inside the same PostgreSQL transaction", () => {
  assert.match(sql, /geo_coordinates_incomplete/i);
  assert.match(sql, /invalid_geo_lat/i);
  assert.match(sql, /invalid_geo_lng/i);
  assert.match(sql, /where id = p_session_id\s+for update;/i);
  assert.match(sql, /where id = v_session\.route_id\s+for update;/i);
  assert.match(sql, /geo_lat = case when p_geo_lat is not null then p_geo_lat else geo_lat end/i);
  assert.match(sql, /geo_captured_at = case when p_geo_lat is not null then v_now else geo_captured_at end/i);
  assert.match(sql, /insert into public\.mcp_route_customers[\s\S]*?geo_lat,[\s\S]*?geo_lng,[\s\S]*?geo_accuracy/i);
  assert.match(sql, /insert into public\.mcp_session_customers/i);
});

test("GPS-enabled RPC remains service-role-only", () => {
  assert.match(sql, /revoke all on function public\.mcp_add_session_customer\([\s\S]*?from public, anon, authenticated;/i);
  assert.match(sql, /grant execute on function public\.mcp_add_session_customer\([\s\S]*?to service_role;/i);
});

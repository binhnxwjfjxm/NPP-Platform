import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(
  new URL("../../../supabase/migrations/20260719210000_a5_5_2_route_master_write_idempotency.sql", import.meta.url),
  "utf8"
);

const wrappers = ["mcp_idempotent_create_route", "mcp_idempotent_update_route"];
const owners = ["mcp_create_route", "mcp_update_route"];

test("route master slice adds two typed persisted-idempotent wrappers", () => {
  for (const wrapper of wrappers) {
    assert.match(sql, new RegExp(`create or replace function public\\.${wrapper}\\(`, "i"));
    assert.match(sql, new RegExp(`revoke execute on function public\\.${wrapper}\\([\\s\\S]*?from public, anon, authenticated;`, "i"));
    assert.match(sql, new RegExp(`grant execute on function public\\.${wrapper}\\([\\s\\S]*?to service_role;`, "i"));
  }
  assert.equal((sql.match(/mcp_idempotency_begin\(/g) || []).length, 2);
  assert.equal((sql.match(/mcp_idempotency_complete\(/g) || []).length, 2);
  assert.equal((sql.match(/->> 'mode' = 'replay'/g) || []).length, 2);
});

test("wrappers preserve canonical route owners and exact public operations", () => {
  for (const owner of owners) assert.match(sql, new RegExp(`v_data := public\\.${owner}\\(`, "i"));
  assert.match(sql, /'route\.create'[\s\S]*?'POST'[\s\S]*?'\/api\/routes'/);
  assert.match(sql, /'route\.update'[\s\S]*?'PATCH'[\s\S]*?'\/api\/routes\/:id'/);
  assert.doesNotMatch(sql, /execute\s+format|p_table_name|generic_table/i);
});

test("trusted context is persisted on route aggregates before completion", () => {
  assert.equal((sql.match(/update public\.mcp_routes as row/g) || []).length, 2);
  assert.equal((sql.match(/'\{foundation_context\}'/g) || []).length, 2);
  assert.equal((sql.match(/coalesce\(p_context, '\{\}'::jsonb\)/g) || []).length >= 2, true);
});

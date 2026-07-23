import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const migrationPath = fileURLToPath(new URL(
  "../../../supabase/migrations/20260715101500_add_atomic_session_customer_mutations.sql",
  import.meta.url
));
const sql = await readFile(migrationPath, "utf8");

function functionBody(name, nextMarker) {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const end = nextMarker ? sql.indexOf(nextMarker, start + 1) : sql.length;
  assert.notEqual(end, -1, `${name} boundary must exist`);
  return sql.slice(start, end);
}

test("result mutation is one locked PostgreSQL transaction", () => {
  const body = functionBody(
    "mcp_record_session_customer_result",
    "create or replace function public.mcp_add_session_customer("
  );

  assert.match(body, /where id = p_session_customer_id\s+for update;/i);
  assert.match(body, /perform public\.mcp_assert_session_mutable\(v_session\.id\);/i);
  assert.match(body, /insert into public\.mcp_visits/i);
  assert.match(body, /update public\.mcp_visits/i);
  assert.match(body, /update public\.mcp_session_customers/i);
  assert.match(body, /perform public\.mcp_recalc_route_session_counters\(v_sc\.session_id\);/i);
  assert.match(body, /foundation_context/i);
});

test("added customer is bound to an explicit locked session", () => {
  const body = functionBody(
    "mcp_add_session_customer",
    "revoke all on function public.mcp_record_session_customer_result("
  );

  assert.match(body, /session_id_required/i);
  assert.match(body, /where id = p_session_id\s+for update;/i);
  assert.doesNotMatch(body, /order by\s+session_date\s+desc/i);
  assert.match(body, /route_customer_route_mismatch/i);
  assert.match(body, /'session_id', v_session\.id/i);
  assert.match(body, /'created', false/i);
  assert.match(body, /mcp_session_customers_session_route_customer_uidx|unique partial index/i);
});

test("add duplicate read avoids reverse row-lock order", () => {
  const body = functionBody(
    "mcp_add_session_customer",
    "revoke all on function public.mcp_record_session_customer_result("
  );
  const duplicateRead = body.match(
    /select \* into v_existing[\s\S]*?where session_id = v_session\.id[\s\S]*?route_customer_id = v_route_customer_id;/i
  );

  assert.ok(duplicateRead, "duplicate snapshot read must exist");
  assert.doesNotMatch(duplicateRead[0], /for update/i);
});

test("both mutation RPCs are service-role-only", () => {
  for (const name of ["mcp_record_session_customer_result", "mcp_add_session_customer"]) {
    assert.match(
      sql,
      new RegExp(`revoke all on function public\\.${name}\\([\\s\\S]*?from public, anon, authenticated;`, "i")
    );
    assert.match(
      sql,
      new RegExp(`grant execute on function public\\.${name}\\([\\s\\S]*?to service_role;`, "i")
    );
  }
});
